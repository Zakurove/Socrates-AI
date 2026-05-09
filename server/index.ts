import express from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import { setupAuth } from "./auth.js";
import { registerRoutes } from "./routes/index.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { generalLimiter } from "./middleware/rate-limit.js";
import { attachGeminiWebSocket } from "./routes/gemini.js";

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const isDev = process.env.NODE_ENV !== "production";
const debugErrors = process.env.DEBUG_ERRORS === "1";

// Trust proxy so req.ip works behind a reverse proxy / Replit edge.
app.set("trust proxy", 1);

// ─── Canonical host redirect ─────────────────────────────
// Bounce any non-canonical host (legacy railway.app URL, www variant) to the
// canonical APP_URL host. Production-only; opts out for the health probe so
// platform health checks against the railway.app hostname keep passing.
if (!isDev) {
  try {
    const canonicalHost = new URL(
      process.env.APP_URL || "https://trysocrates.app",
    ).hostname;
    app.use((req, res, next) => {
      if (req.path === "/api/health") return next();
      const host = req.hostname;
      if (host && host !== canonicalHost) {
        const target = `https://${canonicalHost}${req.originalUrl}`;
        return res.redirect(301, target);
      }
      next();
    });
  } catch {
    // Bad APP_URL — skip redirect rather than crash.
  }
}

// ─── Global middleware ────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: isDev ? false : undefined,
  }),
);

// ─── CORS allow-list ─────────────────────────────────────
const corsOriginEnv = process.env.CORS_ORIGIN;
if (!isDev && !corsOriginEnv) {
  throw new Error(
    "CORS_ORIGIN must be set in production (comma-separated allow-list).",
  );
}
const corsAllowList = (corsOriginEnv ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin / non-browser requests (no Origin header).
      if (!origin) return callback(null, true);
      if (isDev) return callback(null, true);
      if (corsAllowList.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use((req, res, next) => {
  if (req.path === "/api/ai/transcribe") return next();
  // Practice transcribe takes a raw audio body — skip json parser.
  if (/^\/api\/practice\/\d+\/transcribe$/.test(req.path)) return next();
  // Image upload is multipart — multer handles it.
  if (req.path === "/api/uploads/image") return next();
  return express.json({ limit: "500kb" })(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

// ─── Auth (sessions + passport) ──────────────────────────
setupAuth(app);

// ─── Global rate limit (after auth so user id is populated) ──
app.use(generalLimiter);

// ─── Static uploads (item images) ───────────────────────
// Narrowed mount: only /uploads/items/* is publicly served, so any other
// subdirectory under server/uploads remains private to the server.
app.use(
  "/uploads/items",
  express.static(path.resolve(process.cwd(), "server", "uploads", "items"), {
    fallthrough: true,
    maxAge: "7d",
    index: false,
    dotfiles: "deny",
  }),
);

// ─── API Routes ──────────────────────────────────────────
registerRoutes(app);

// ─── Error handling middleware ────────────────────────────
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = (err as any).status || 500;
    const showDetails = !isDev ? false : debugErrors;
    // Minimal log: never include request bodies.
    console.error(
      `[error] ${req.method} ${req.path} -> ${status}: ${err.message}` +
        (showDetails && err.stack ? `\n${err.stack}` : ""),
    );
    res.status(status).json({
      message:
        showDetails
          ? err.message
          : status === 500
            ? "Internal server error"
            : err.message,
    });
  },
);

// ─── Vite (dev) or Static (prod) ─────────────────────────
(async () => {
  if (isDev) {
    await setupVite(app);
  } else {
    serveStatic(app);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    log(`Server running on port ${PORT} (${isDev ? "development" : "production"})`);
    const corsDesc = isDev ? "dev-any" : corsAllowList.join("|") || "none";
    log(
      `[security] rate-limit=on csrf=samesite-strict cors=${corsDesc} env=${isDev ? "dev" : "prod"}`,
    );
  });

  // Attach Gemini Live WebSocket handler to the HTTP server
  attachGeminiWebSocket(server);
})();
