import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import createMemoryStore from "memorystore";
import type { Express, RequestHandler } from "express";
import type { User } from "../shared/schema.js";
import { storage } from "./storage.js";
import { pool } from "./db.js";

const SALT_ROUNDS = 12;

// Precomputed dummy hash used to equalize bcrypt timing when a user is not found.
// Generated once at module load against a random throwaway value.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  "this-is-a-dummy-value-used-only-for-timing-equalization",
  SALT_ROUNDS,
);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      displayName: string;
      isAdmin: boolean;
      bio: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
  }
}

// Exposed for WebSocket upgrade handlers that need to re-authenticate
// the session cookie before accepting a connection.
export let sessionMiddleware: RequestHandler | undefined;

export function setupAuth(app: Express): void {
  let sessionStore: session.Store;

  if (process.env.NODE_ENV === "production") {
    const PgStore = connectPgSimple(session);
    sessionStore = new PgStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    });
  } else {
    const MemoryStore = createMemoryStore(session);
    sessionStore = new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    });
  }

  let sessionSecret = process.env.SESSION_SECRET;
  const MIN_SECRET_LEN = 32;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET is required in production. Refusing to start.",
      );
    }
    console.warn(
      "[security] SESSION_SECRET not set — using insecure dev fallback. DO NOT USE IN PRODUCTION.",
    );
    sessionSecret = "socrates-dev-secret";
  } else if (
    sessionSecret.length < MIN_SECRET_LEN &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_LEN} characters in production. Refusing to start.`,
    );
  }

  sessionMiddleware = session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "strict",
    },
  });

  app.use(sessionMiddleware);
  app.use(passport.initialize() as RequestHandler);
  app.use(passport.session() as RequestHandler);

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            // Equalize timing: still run a bcrypt compare against a dummy hash.
            await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
            return done(null, false, { message: "Invalid email or password" });
          }
          const isValid = await comparePassword(password, user.password);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }
          return done(null, sanitizeUser(user));
        } catch (err) {
          return done(err);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, sanitizeUser(user));
    } catch (err) {
      done(err);
    }
  });
}

/** Strip password from user object before sending to client / storing in session */
function sanitizeUser(user: User): Express.User {
  const { password: _, ...safe } = user;
  return safe as Express.User;
}

export { sanitizeUser };
