import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db.js";
import { aiCosts } from "../../shared/schema.js";

/**
 * Hard per-user daily AI spend cap. Sums `cost_estimate_usd` in the trailing
 * 24 hours for the authenticated user and returns 429 once the cap is hit.
 *
 * Intentionally uses a tiny in-memory cache (60s TTL) to avoid a DB hit on
 * every AI request. The cap is a soft ceiling — a user that squeaks past by
 * $0.50 during the cache window is acceptable; we just want to stop runaway
 * abuse long before it becomes a billing event.
 *
 * Configure via `AI_DAILY_SPEND_CAP_USD` (default: $5 / user / day).
 */

const DEFAULT_CAP_USD = 5;
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  spend: number;
  expires: number;
}

const cache = new Map<number, CacheEntry>();

function getCapUsd(): number {
  const raw = process.env.AI_DAILY_SPEND_CAP_USD;
  if (!raw) return DEFAULT_CAP_USD;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
}

async function getUserSpendLast24h(userId: number): Promise<number> {
  const cached = cache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.spend;

  const rows: Array<{ total: number | string | null }> = await db.execute(sql`
    SELECT COALESCE(SUM(cost_estimate_usd), 0) AS total
    FROM ai_costs
    WHERE user_id = ${userId}
      AND created_at > NOW() - INTERVAL '24 hours'
  `) as unknown as Array<{ total: number | string | null }>;

  const total = Number(rows?.[0]?.total ?? 0) || 0;
  cache.set(userId, { spend: total, expires: Date.now() + CACHE_TTL_MS });
  return total;
}

/** Clear the cache entry for a user (call after a large spend). */
export function invalidateSpendCache(userId: number): void {
  cache.delete(userId);
}

export async function dailySpendCap(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = (req as any).user?.id as number | undefined;
  if (!userId) {
    // No user context → fall through; aiLimiter already caps anonymous by IP.
    next();
    return;
  }

  try {
    const cap = getCapUsd();
    const spend = await getUserSpendLast24h(userId);
    if (spend >= cap) {
      res.status(429).json({
        message:
          "Daily AI usage cap reached. Your account has used the maximum daily amount. Try again tomorrow.",
        code: "daily_spend_cap",
      });
      return;
    }
    next();
  } catch {
    // On DB error, don't block the user — log and pass through.
    next();
  }
}
