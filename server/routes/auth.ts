import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { hashPassword, comparePassword, sanitizeUser } from "../auth.js";
import { storage } from "../storage.js";
import { authLimiter } from "../middleware/rate-limit.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../services/email.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(72, "Password must be at most 72 characters"),
  displayName: z.string().min(1).max(100),
});

// POST /api/auth/register
router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { email, password, displayName } = parsed.data;

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      // Do not leak existence via 409. Return a generic success-shaped
      // response without creating or logging in anyone. Log server-side.
      console.warn(
        `[auth] register attempt for existing email suppressed`,
      );
      // Use the same 201 status as a real registration so the client's
      // mutation resolves identically and doesn't get stuck. Flag `pending`
      // so the client can show a generic "check your email" style notice
      // without confirming whether the email exists.
      return res
        .status(201)
        .json({ pending: true, message: "Registration received" });
    }

    const hashedPassword = await hashPassword(password);
    const user = await storage.createUser({
      email,
      password: hashedPassword,
      displayName,
    });

    // Admins are promoted by explicit SQL only. Do NOT auto-promote on
    // registration — if the DB is ever reset, first-register-wins would
    // grant admin to whoever signs up with the founder email first.

    // Generate + send verification email (best-effort — errors must not block
    // registration or auto-login).
    try {
      const rawToken = randomBytes(32).toString("hex");
      const digest = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h
      await storage.createEmailVerification({
        userId: user.id,
        token: digest,
        expiresAt,
      });
      await sendVerificationEmail({ to: user.email, token: rawToken });
    } catch (emailErr) {
      // Non-fatal: log and continue. User can resend from the banner.
      console.error("[auth] verification email failed on register", emailErr);
    }

    // Auto-login after registration — regenerate session to prevent fixation.
    const safeUser = sanitizeUser(user);
    req.session.regenerate((regenErr) => {
      if (regenErr) return next(regenErr);
      req.login(safeUser, (loginErr) => {
        if (loginErr) return next(loginErr);
        const { password: _pw, ...resp } = user;
        return res.status(201).json(resp);
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post("/login", authLimiter, (req, res, next) => {
  passport.authenticate(
    "local",
    (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        return res
          .status(401)
          .json({ message: info?.message || "Invalid credentials" });
      }
      // Regenerate session to prevent session fixation.
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          return res.json(user);
        });
      });
    },
  )(req, res, next);
});

// POST /api/auth/logout
router.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.json({ message: "Logged out" });
  });
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  return res.json(req.user);
});

// PUT /api/auth/profile
const profileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  oldPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(72, "Password must be at most 72 characters")
    .optional(),
});

router.put("/profile", async (req, res, next) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { displayName, bio, oldPassword, newPassword } = parsed.data;

    // Must provide both or neither password fields
    if ((oldPassword && !newPassword) || (!oldPassword && newPassword)) {
      return res.status(400).json({
        message: "Both oldPassword and newPassword are required to change password",
      });
    }

    const updates: {
      displayName?: string;
      password?: string;
      bio?: string | null;
    } = {};

    if (displayName) {
      updates.displayName = displayName;
    }

    // Bio: empty string is treated as "clear" (null).
    if (bio !== undefined) {
      updates.bio = bio.length === 0 ? null : bio;
    }

    if (oldPassword && newPassword) {
      const fullUser = await storage.getUser(req.user.id);
      if (!fullUser) {
        return res.status(404).json({ message: "User not found" });
      }
      const valid = await comparePassword(oldPassword, fullUser.password);
      if (!valid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      updates.password = await hashPassword(newPassword);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No updates provided" });
    }

    const updatedUser = await storage.updateUser(req.user.id, updates);
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const safeUser = sanitizeUser(updatedUser);
    // Update session user data
    req.login(safeUser, (err) => {
      if (err) return next(err);
      return res.json(safeUser);
    });
  } catch (err) {
    next(err);
  }
});

// ─── Forgot / reset password ──────────────────────────────
// Strategy: server hashes the raw token (SHA-256) before storing. The raw
// token goes to the user's email only; the DB holds the digest. A leaked DB
// dump therefore cannot be used to reset anyone's password.

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(32).max(128),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(72, "Password must be at most 72 characters"),
});

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// POST /api/auth/forgot-password
router.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      // Always 200 — never leak whether the email parsed.
      return res.json({ ok: true });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const user = await storage.getUserByEmail(email);

    // Respond identically whether or not the account exists.
    if (!user) {
      return res.json({ ok: true });
    }

    const rawToken = randomBytes(32).toString("hex");
    const digest = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await storage.createPasswordReset({
      userId: user.id,
      token: digest,
      expiresAt,
      requestedIp: (req.ip ?? "").slice(0, 64) || null,
    });

    await sendPasswordResetEmail({ to: user.email, token: rawToken });

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const digest = hashToken(parsed.data.token);
    const record = await storage.getPasswordResetByToken(digest);

    if (!record) {
      return res.status(400).json({ message: "Invalid or expired link" });
    }
    if (record.usedAt) {
      return res.status(400).json({ message: "This link has already been used" });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "This link has expired" });
    }

    // Constant-time compare vs. stored digest (defense in depth — the query
    // already matched on digest, but this guards any future path that fetches
    // the record by id).
    const a = Buffer.from(digest, "hex");
    const b = Buffer.from(record.token, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(400).json({ message: "Invalid link" });
    }

    const hashed = await hashPassword(parsed.data.password);
    await storage.updateUser(record.userId, { password: hashed });
    await storage.markPasswordResetUsed(record.id);
    await storage.invalidateOtherPasswordResets(record.userId, record.id);

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Email verification ───────────────────────────────────
//
// Strategy mirrors password resets: raw token in email URL, SHA-256 digest
// in DB. 24-hour expiry, single-use. Soft-gate: app is fully accessible to
// unverified users; a banner prompts verification until the link is clicked.

// POST /api/auth/verify-email/send — generate a fresh token and email it.
// Auth required (user must be logged in to request a resend).
router.post("/verify-email/send", authLimiter, async (req, res, next) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (req.user.emailVerifiedAt) {
      return res.json({ ok: true, alreadyVerified: true });
    }

    const rawToken = randomBytes(32).toString("hex");
    const digest = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

    await storage.createEmailVerification({
      userId: req.user.id,
      token: digest,
      expiresAt,
    });

    await sendVerificationEmail({ to: req.user.email, token: rawToken });

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/verify-email/:token — consume the token, mark email verified.
// No auth required — user clicks from their inbox.
router.get("/verify-email/:token", async (req, res, next) => {
  try {
    const raw = req.params.token;
    if (!raw || raw.length < 32 || raw.length > 128) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const digest = hashToken(raw);
    const record = await storage.getEmailVerificationByToken(digest);

    if (!record) {
      return res.status(400).json({ message: "Invalid or expired link" });
    }
    if (record.usedAt) {
      return res.status(400).json({ message: "This link has already been used" });
    }
    if (record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "This link has expired" });
    }

    // Constant-time compare (defense in depth — query already matched on digest).
    const a = Buffer.from(digest, "hex");
    const b = Buffer.from(record.token, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(400).json({ message: "Invalid link" });
    }

    await storage.markEmailVerified(record.userId);
    await storage.markEmailVerificationUsed(record.id);
    // Invalidate any other pending tokens for this user.
    await storage.invalidateOtherEmailVerifications(record.userId, record.id);

    // If the verifying user is currently logged in, refresh the session so
    // the client's `emailVerifiedAt` field updates without a manual re-login.
    if (req.isAuthenticated() && req.user.id === record.userId) {
      const freshUser = await storage.getUser(record.userId);
      if (freshUser) {
        const safeUser = sanitizeUser(freshUser);
        req.login(safeUser, (loginErr) => {
          if (loginErr) {
            console.error("[auth] session refresh after verify failed", loginErr);
          }
        });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Author profile ───────────────────────────────────────
// `GET /api/users/:id` — author page. Sign-in required (library is gated).
export const publicUsersRouter = Router();

publicUsersRouter.get("/:id", async (req, res, next) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const profile = await storage.getUserPublicProfile(id);
    if (!profile) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.json(profile);
  } catch (err) {
    next(err);
  }
});

export default router;
