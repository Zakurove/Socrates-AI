import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

function userOrIpKey(req: Request): string {
  const userId = (req as any).user?.id;
  if (userId != null) return `u:${userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

// Allow dev / E2E runs to bypass the tight auth rate-limit that otherwise
// blocks more than 5 registrations per 15 minutes per IP. Turn off via
// RATE_LIMIT_DISABLED=1 (only honored in non-production environments).
const rateLimitDisabled =
  process.env.NODE_ENV !== "production" &&
  process.env.RATE_LIMIT_DISABLED === "1";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}`,
  message: { message: "Too many authentication attempts. Try again later." },
  skip: () => rateLimitDisabled,
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { message: "AI rate limit exceeded. Please slow down." },
});

export const aiDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { message: "Daily AI usage limit reached." },
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: () => rateLimitDisabled,
});

// Public library browse — unauthenticated traffic permitted, but throttled
// to discourage scraping. Looser than auth flow but tighter than AI.
export const libraryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "")}`,
  message: { message: "Too many requests. Please slow down." },
});

// Report submissions — 10 per day per user to prevent spam flooding.
export const reportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { message: "Daily report limit reached." },
  skip: () => rateLimitDisabled,
});
