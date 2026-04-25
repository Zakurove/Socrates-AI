import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../db.js";
import { sessions, stations } from "../../shared/schema.js";
import { eq, and, gte, sql, count, countDistinct } from "drizzle-orm";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const userId = req.user!.id;
    const now = new Date();

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Run aggregate queries in parallel
    const [countRows, minutesRow, stationCounts, allSessions] =
      await Promise.all([
        // Sessions counts: total, this week, this month
        db
          .select({
            total: count(),
            thisWeek: sql<number>`count(*) filter (where ${sessions.startedAt} >= ${sevenDaysAgo})`,
            thisMonth: sql<number>`count(*) filter (where ${sessions.startedAt} >= ${thirtyDaysAgo})`,
          })
          .from(sessions)
          .where(eq(sessions.userId, userId)),

        // Total practice minutes
        db
          .select({
            totalSeconds: sql<number>`coalesce(sum(${sessions.timeUsedSeconds}), 0)`,
          })
          .from(sessions)
          .where(eq(sessions.userId, userId)),

        // Station counts
        db
          .select({
            practiced: countDistinct(sessions.stationId),
            totalStations: sql<number>`(select count(*) from ${stations} where ${stations.userId} = ${userId})`,
          })
          .from(sessions)
          .where(eq(sessions.userId, userId)),

        // All sessions for streak + improvement (ordered by startedAt)
        db
          .select({
            stationId: sessions.stationId,
            totalScore: sessions.totalScore,
            startedAt: sessions.startedAt,
            stationTitle: stations.title,
          })
          .from(sessions)
          .innerJoin(stations, eq(sessions.stationId, stations.id))
          .where(eq(sessions.userId, userId))
          .orderBy(sessions.startedAt),
      ]);

    const totalSessions = Number(countRows[0]?.total ?? 0);
    const sessionsThisWeek = Number(countRows[0]?.thisWeek ?? 0);
    const sessionsThisMonth = Number(countRows[0]?.thisMonth ?? 0);
    const totalPracticeMinutes = Math.round(
      Number(minutesRow[0]?.totalSeconds ?? 0) / 60
    );
    const stationsPracticed = Number(stationCounts[0]?.practiced ?? 0);
    const totalStations = Number(stationCounts[0]?.totalStations ?? 0);

    // Current streak: consecutive days from today backward with at least one session
    const currentStreak = computeStreak(allSessions, now);

    // Best improvement: biggest score jump between consecutive attempts at same station
    const bestImprovement = computeBestImprovement(allSessions);

    res.json({
      sessionsThisWeek,
      sessionsThisMonth,
      totalSessions,
      totalPracticeMinutes,
      stationsPracticed,
      totalStations,
      currentStreak,
      bestImprovement,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ message: "Failed to compute stats" });
  }
});

function computeStreak(
  allSessions: { startedAt: Date }[],
  now: Date
): number {
  if (allSessions.length === 0) return 0;

  // Build a set of date strings (YYYY-MM-DD in local time) that have sessions
  const sessionDays = new Set<string>();
  for (const s of allSessions) {
    const d = new Date(s.startedAt);
    sessionDays.add(dateKey(d));
  }

  const todayKey = dateKey(now);
  if (!sessionDays.has(todayKey)) return 0;

  let streak = 1;
  const day = new Date(now);
  while (true) {
    day.setDate(day.getDate() - 1);
    if (sessionDays.has(dateKey(day))) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeBestImprovement(
  allSessions: {
    stationId: number;
    totalScore: number | null;
    startedAt: Date;
    stationTitle: string;
  }[]
): { stationTitle: string; from: number; to: number; delta: number } | null {
  // Group by station, already ordered by startedAt
  const byStation = new Map<
    number,
    { score: number; title: string }[]
  >();
  for (const s of allSessions) {
    if (s.totalScore == null) continue;
    if (!byStation.has(s.stationId)) byStation.set(s.stationId, []);
    byStation.get(s.stationId)!.push({
      score: s.totalScore,
      title: s.stationTitle,
    });
  }

  let best: {
    stationTitle: string;
    from: number;
    to: number;
    delta: number;
  } | null = null;

  for (const attempts of Array.from(byStation.values())) {
    if (attempts.length < 2) continue;
    for (let i = 1; i < attempts.length; i++) {
      const delta = attempts[i].score - attempts[i - 1].score;
      if (delta > 0 && (best === null || delta > best.delta)) {
        best = {
          stationTitle: attempts[i].title,
          from: Math.round(attempts[i - 1].score),
          to: Math.round(attempts[i].score),
          delta: Math.round(delta),
        };
      }
    }
  }

  return best;
}

export default router;
