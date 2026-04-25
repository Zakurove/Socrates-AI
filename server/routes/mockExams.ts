import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../db.js";
import {
  mockExams,
  mockExamAttempts,
  stations,
  sessions,
  itemResults,
  examinerQuestionResults,
} from "../../shared/schema.js";
import { buildSessionScoring } from "../services/session-scoring.js";

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  title: z.string().min(1).max(255),
  stationIds: z.array(z.number().int().positive()).min(1).max(20),
  restSeconds: z.number().int().min(0).max(600).optional(),
  practiceMode: z
    .enum(["self_check", "ai_listen", "ai_conversation"])
    .optional(),
});

// ───────────────────────────────────────────────────────────────────────
// Templates
// ───────────────────────────────────────────────────────────────────────

// GET /api/mock-exams — list templates with aggregate attempt stats so the
// library/card surfaces can show best/average/attemptCount without a
// second round-trip.
router.get("/", async (req, res, next) => {
  try {
    const list = await db
      .select()
      .from(mockExams)
      .where(eq(mockExams.userId, req.user!.id))
      .orderBy(desc(mockExams.createdAt));

    if (list.length === 0) return res.json([]);

    const examIds = list.map((e) => e.id);
    const attemptRows = await db
      .select()
      .from(mockExamAttempts)
      .where(
        and(
          eq(mockExamAttempts.userId, req.user!.id),
          inArray(mockExamAttempts.mockExamId, examIds),
        ),
      );

    const statsByExam = new Map<
      number,
      {
        attemptCount: number;
        completedCount: number;
        bestScore: number | null;
        averageScore: number | null;
        lastAttemptedAt: Date | null;
      }
    >();
    for (const id of examIds) {
      statsByExam.set(id, {
        attemptCount: 0,
        completedCount: 0,
        bestScore: null,
        averageScore: null,
        lastAttemptedAt: null,
      });
    }

    const scoredSumByExam = new Map<number, number>();
    const scoredCountByExam = new Map<number, number>();
    for (const a of attemptRows) {
      const s = statsByExam.get(a.mockExamId)!;
      s.attemptCount += 1;
      if (a.completedAt != null) s.completedCount += 1;
      if (a.overallScore != null) {
        if (s.bestScore == null || a.overallScore > s.bestScore)
          s.bestScore = a.overallScore;
        scoredSumByExam.set(
          a.mockExamId,
          (scoredSumByExam.get(a.mockExamId) ?? 0) + a.overallScore,
        );
        scoredCountByExam.set(
          a.mockExamId,
          (scoredCountByExam.get(a.mockExamId) ?? 0) + 1,
        );
      }
      const t = a.startedAt;
      if (t && (s.lastAttemptedAt == null || t > s.lastAttemptedAt))
        s.lastAttemptedAt = t;
    }
    for (const id of examIds) {
      const s = statsByExam.get(id)!;
      const n = scoredCountByExam.get(id) ?? 0;
      s.averageScore = n > 0 ? (scoredSumByExam.get(id) ?? 0) / n : null;
    }

    return res.json(
      list.map((e) => ({ ...e, stats: statsByExam.get(e.id)! })),
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/mock-exams/:id — template with populated stations. No progress
// fields anymore — those live on attempts.
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const [exam] = await db
      .select()
      .from(mockExams)
      .where(eq(mockExams.id, id));
    if (!exam) return res.status(404).json({ message: "Not found" });
    if (exam.userId !== req.user!.id)
      return res.status(403).json({ message: "Forbidden" });

    const ids = (exam.stationIds ?? []) as number[];
    const rows = ids.length
      ? await db.select().from(stations).where(inArray(stations.id, ids))
      : [];
    const byId = new Map(rows.map((s) => [s.id, s]));
    const populated = ids
      .map((sid) => byId.get(sid))
      .filter((s): s is (typeof rows)[number] => !!s);

    return res.json({
      ...exam,
      stations: populated,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/mock-exams
router.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { title, stationIds, restSeconds, practiceMode } = parsed.data;

    // Verify all stations belong to the user.
    const owned = await db
      .select({ id: stations.id })
      .from(stations)
      .where(
        and(eq(stations.userId, req.user!.id), inArray(stations.id, stationIds)),
      );
    if (owned.length !== stationIds.length) {
      return res
        .status(400)
        .json({ message: "One or more stations are not yours" });
    }

    // If ai_conversation selected, verify every station has a patient briefing.
    if (practiceMode === "ai_conversation") {
      const stationRows = await db
        .select({
          id: stations.id,
          hasPatientBriefing: stations.hasPatientBriefing,
          patientBriefing: stations.patientBriefing,
        })
        .from(stations)
        .where(inArray(stations.id, stationIds));
      const missing = stationRows.filter(
        (s) => !s.hasPatientBriefing || !s.patientBriefing?.trim(),
      );
      if (missing.length > 0) {
        return res.status(400).json({
          message:
            "AI Conversation requires a patient briefing on every station in the exam",
          code: "missing_patient_briefing",
        });
      }
    }

    const [created] = await db
      .insert(mockExams)
      .values({
        userId: req.user!.id,
        title,
        stationIds,
        restSeconds: restSeconds ?? 120,
        practiceMode: practiceMode ?? "self_check",
      })
      .returning();
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    stationIds: z.array(z.number().int().positive()).min(1).max(20).optional(),
    restSeconds: z.number().int().min(0).max(600).optional(),
    practiceMode: z
      .enum(["self_check", "ai_listen", "ai_conversation"])
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field must be provided",
  });

router.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const loaded = await loadOwned(id, req.user!.id);
    if (!loaded.exam) {
      if (loaded.error === 404) return res.status(404).json({ message: "Not found" });
      return res.status(403).json({ message: "Forbidden" });
    }
    const exam = loaded.exam;

    const patch = parsed.data;

    if (patch.stationIds) {
      const owned = await db
        .select({ id: stations.id })
        .from(stations)
        .where(
          and(
            eq(stations.userId, req.user!.id),
            inArray(stations.id, patch.stationIds),
          ),
        );
      if (owned.length !== patch.stationIds.length) {
        return res
          .status(400)
          .json({ message: "One or more stations are not yours" });
      }
    }

    const effectiveMode = patch.practiceMode ?? exam.practiceMode;
    const effectiveStationIds = patch.stationIds ?? exam.stationIds;
    if (effectiveMode === "ai_conversation") {
      const stationRows = await db
        .select({
          id: stations.id,
          hasPatientBriefing: stations.hasPatientBriefing,
          patientBriefing: stations.patientBriefing,
        })
        .from(stations)
        .where(inArray(stations.id, effectiveStationIds));
      const missing = stationRows.filter(
        (s) => !s.hasPatientBriefing || !s.patientBriefing?.trim(),
      );
      if (missing.length > 0) {
        return res.status(400).json({
          message:
            "AI Conversation requires a patient briefing on every station in the exam",
          code: "missing_patient_briefing",
        });
      }
    }

    const [updated] = await db
      .update(mockExams)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.stationIds !== undefined
          ? { stationIds: patch.stationIds }
          : {}),
        ...(patch.restSeconds !== undefined
          ? { restSeconds: patch.restSeconds }
          : {}),
        ...(patch.practiceMode !== undefined
          ? { practiceMode: patch.practiceMode }
          : {}),
      })
      .where(eq(mockExams.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const loaded = await loadOwned(id, req.user!.id);
    if (!loaded.exam) {
      if (loaded.error === 404) return res.status(404).json({ message: "Not found" });
      return res.status(403).json({ message: "Forbidden" });
    }
    await db.delete(mockExams).where(eq(mockExams.id, id));
    return res.status(204).end();
  } catch (err) {
    next(err);
  }
});

type LoadResult =
  | { error: 404 | 403; exam?: undefined }
  | { exam: typeof mockExams.$inferSelect; error?: undefined };

async function loadOwned(
  id: number,
  userId: number | undefined,
): Promise<LoadResult> {
  const [exam] = await db.select().from(mockExams).where(eq(mockExams.id, id));
  if (!exam) return { error: 404 };
  if (exam.userId !== userId) return { error: 403 };
  return { exam };
}

type LoadAttemptResult =
  | { error: 404 | 403; attempt?: undefined }
  | {
      attempt: typeof mockExamAttempts.$inferSelect;
      error?: undefined;
    };

async function loadAttempt(
  attemptId: number,
  userId: number,
): Promise<LoadAttemptResult> {
  const [attempt] = await db
    .select()
    .from(mockExamAttempts)
    .where(eq(mockExamAttempts.id, attemptId));
  if (!attempt) return { error: 404 };
  if (attempt.userId !== userId) return { error: 403 };
  return { attempt };
}

// ───────────────────────────────────────────────────────────────────────
// Attempts
// ───────────────────────────────────────────────────────────────────────

// GET /api/mock-exams/:id/attempts — list attempts for stats/history.
router.get("/:id/attempts", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const loaded = await loadOwned(id, req.user!.id);
    if (loaded.error)
      return res.status(loaded.error).json({ message: "Not found" });

    const list = await db
      .select()
      .from(mockExamAttempts)
      .where(
        and(
          eq(mockExamAttempts.mockExamId, id),
          eq(mockExamAttempts.userId, req.user!.id),
        ),
      )
      .orderBy(desc(mockExamAttempts.attemptNumber));
    return res.json(list);
  } catch (err) {
    next(err);
  }
});

// POST /api/mock-exams/:id/attempts — start a new attempt.
router.post("/:id/attempts", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const loaded = await loadOwned(id, req.user!.id);
    if (loaded.error)
      return res.status(loaded.error).json({ message: "Not found" });
    const ids = (loaded.exam.stationIds ?? []) as number[];
    if (ids.length === 0)
      return res
        .status(400)
        .json({ message: "Mock exam has no stations", code: "empty_circuit" });

    // Next attempt number = max + 1. A unique index on
    // (userId, mockExamId, attemptNumber) enforces monotonicity at the DB
    // level so concurrent POSTs collide rather than silently producing
    // duplicates.
    const [maxRow] = await db
      .select({ m: sql<number>`MAX(${mockExamAttempts.attemptNumber})` })
      .from(mockExamAttempts)
      .where(
        and(
          eq(mockExamAttempts.mockExamId, id),
          eq(mockExamAttempts.userId, req.user!.id),
        ),
      );
    const nextNumber = (maxRow?.m ?? 0) + 1;

    const [created] = await db
      .insert(mockExamAttempts)
      .values({
        mockExamId: id,
        userId: req.user!.id,
        attemptNumber: nextNumber,
        currentStationIndex: 0,
        startedAt: new Date(),
      })
      .returning();

    return res.status(201).json({
      attempt: created,
      currentStationId: ids[0],
      stationIndex: 0,
      totalStations: ids.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/mock-exams/:id/attempts/:attemptId — one attempt with per-station
// results. Uses the iter10 composite scoring (matches Agent B's path in the
// legacy /results endpoint).
router.get("/:id/attempts/:attemptId", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const attemptId = parseInt(req.params.attemptId, 10);
    if (isNaN(id) || isNaN(attemptId))
      return res.status(400).json({ message: "Invalid id" });

    const loaded = await loadOwned(id, req.user!.id);
    if (loaded.error)
      return res.status(loaded.error).json({ message: "Not found" });

    const loadedAttempt = await loadAttempt(attemptId, req.user!.id);
    if (loadedAttempt.error)
      return res.status(loadedAttempt.error).json({ message: "Not found" });
    const attempt = loadedAttempt.attempt;
    if (attempt.mockExamId !== id)
      return res
        .status(400)
        .json({ message: "Attempt does not belong to this mock exam" });

    const ids = (loaded.exam.stationIds ?? []) as number[];
    const stationRows = ids.length
      ? await db.select().from(stations).where(inArray(stations.id, ids))
      : [];
    const stationById = new Map(stationRows.map((s) => [s.id, s]));

    // Sessions scoped to THIS attempt only.
    const attemptSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.mockExamAttemptId, attemptId));

    // Most recent session per station (guard against accidental dupes).
    const sessByStation = new Map<number, (typeof attemptSessions)[number]>();
    for (const s of attemptSessions) {
      const prev = sessByStation.get(s.stationId);
      if (!prev || new Date(s.startedAt) > new Date(prev.startedAt)) {
        sessByStation.set(s.stationId, s);
      }
    }

    const perStationSessionIds = Array.from(sessByStation.values()).map(
      (s) => s.id,
    );
    const allItemResults = perStationSessionIds.length
      ? await db
          .select()
          .from(itemResults)
          .where(inArray(itemResults.sessionId, perStationSessionIds))
      : [];
    const allExaminerResults = perStationSessionIds.length
      ? await db
          .select()
          .from(examinerQuestionResults)
          .where(
            inArray(
              examinerQuestionResults.sessionId,
              perStationSessionIds,
            ),
          )
      : [];

    const itemResultsBySession = new Map<number, typeof allItemResults>();
    for (const r of allItemResults) {
      const arr = itemResultsBySession.get(r.sessionId) ?? [];
      arr.push(r);
      itemResultsBySession.set(r.sessionId, arr);
    }
    const examinerResultsBySession = new Map<
      number,
      typeof allExaminerResults
    >();
    for (const r of allExaminerResults) {
      const arr = examinerResultsBySession.get(r.sessionId) ?? [];
      arr.push(r);
      examinerResultsBySession.set(r.sessionId, arr);
    }

    const perStation = await Promise.all(
      ids.map(async (sid, idx) => {
        const station = stationById.get(sid);
        const sess = sessByStation.get(sid);
        let scoring = null as
          | Awaited<ReturnType<typeof buildSessionScoring>>
          | null;
        if (sess) {
          scoring = await buildSessionScoring(
            sess.id,
            sess.stationId,
            (itemResultsBySession.get(sess.id) ?? []).map((r) => ({
              itemId: r.itemId,
              status: r.status,
            })),
            (examinerResultsBySession.get(sess.id) ?? []).map((r) => ({
              score: r.score,
            })),
          );
        }
        return {
          stationIndex: idx,
          stationId: sid,
          title: station?.title ?? "Untitled station",
          // Preserve `score` key for backwards-compat with UI that was
          // reading it directly; mirrors the composite.
          score: scoring ? scoring.compositeScore : null,
          scoring,
          timeUsedSeconds: sess?.timeUsedSeconds ?? null,
          criticalItemsMissed: sess?.criticalItemsMissed ?? false,
          sessionId: sess?.id ?? null,
        };
      }),
    );

    const scored = perStation.filter((p) => p.score != null);
    const computedOverall =
      scored.length === 0
        ? null
        : scored.reduce((a, b) => a + (b.score ?? 0), 0) / scored.length;
    const totalTime = perStation.reduce(
      (a, b) => a + (b.timeUsedSeconds ?? 0),
      0,
    );
    const criticalMissedCount = perStation.filter(
      (p) => p.criticalItemsMissed,
    ).length;

    return res.json({
      mockExam: loaded.exam,
      attempt,
      perStation,
      overallScore: attempt.overallScore ?? computedOverall,
      totalTimeSeconds: totalTime,
      criticalMissedCount,
    });
  } catch (err) {
    next(err);
  }
});

const advanceSchema = z.object({
  fromIndex: z.number().int().nonnegative(),
});

// POST /api/mock-exams/:id/attempts/:attemptId/advance — advance the
// attempt's station index. fromIndex pins the client's expected index for
// idempotency; server returns 409 on mismatch so a duplicate POST can't
// skip a station.
router.post("/:id/attempts/:attemptId/advance", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const attemptId = parseInt(req.params.attemptId, 10);
    if (isNaN(id) || isNaN(attemptId))
      return res.status(400).json({ message: "Invalid id" });

    const parsed = advanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "fromIndex required",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const loaded = await loadOwned(id, req.user!.id);
    if (loaded.error)
      return res.status(loaded.error).json({ message: "Not found" });

    const loadedAttempt = await loadAttempt(attemptId, req.user!.id);
    if (loadedAttempt.error)
      return res.status(loadedAttempt.error).json({ message: "Not found" });
    const attempt = loadedAttempt.attempt;
    if (attempt.mockExamId !== id)
      return res
        .status(400)
        .json({ message: "Attempt does not belong to this mock exam" });

    const ids = (loaded.exam.stationIds ?? []) as number[];

    if (attempt.completedAt != null) {
      return res.status(409).json({
        message: "Attempt already completed",
        code: "not_in_progress",
        currentStationIndex: attempt.currentStationIndex,
      });
    }

    if (parsed.data.fromIndex !== attempt.currentStationIndex) {
      return res.status(409).json({
        message: "Stale fromIndex",
        code: "stale_from_index",
        currentStationIndex: attempt.currentStationIndex,
        currentStationId: ids[attempt.currentStationIndex] ?? null,
        totalStations: ids.length,
      });
    }

    const nextIdx = attempt.currentStationIndex + 1;

    if (nextIdx >= ids.length) {
      // Final station — compute composite overall from attempt sessions.
      const overall = await computeAttemptOverallScore(attemptId);
      const [updated] = await db
        .update(mockExamAttempts)
        .set({
          completedAt: new Date(),
          overallScore: overall,
          currentStationIndex: nextIdx,
        })
        .where(eq(mockExamAttempts.id, attemptId))
        .returning();
      return res.json({ done: true, attempt: updated });
    }

    const [updated] = await db
      .update(mockExamAttempts)
      .set({ currentStationIndex: nextIdx })
      .where(eq(mockExamAttempts.id, attemptId))
      .returning();

    return res.json({
      done: false,
      attempt: updated,
      currentStationId: ids[nextIdx],
      stationIndex: nextIdx,
      totalStations: ids.length,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/mock-exams/:id/attempts/:attemptId/abort — mark the attempt as
// done (no more stations). Keeps it out of in-progress lists.
router.post("/:id/attempts/:attemptId/abort", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const attemptId = parseInt(req.params.attemptId, 10);
    if (isNaN(id) || isNaN(attemptId))
      return res.status(400).json({ message: "Invalid id" });

    const loaded = await loadOwned(id, req.user!.id);
    if (loaded.error)
      return res.status(loaded.error).json({ message: "Not found" });
    const loadedAttempt = await loadAttempt(attemptId, req.user!.id);
    if (loadedAttempt.error)
      return res.status(loadedAttempt.error).json({ message: "Not found" });
    const attempt = loadedAttempt.attempt;
    if (attempt.mockExamId !== id)
      return res
        .status(400)
        .json({ message: "Attempt does not belong to this mock exam" });

    if (attempt.completedAt != null) return res.json(attempt);

    const overall = await computeAttemptOverallScore(attemptId);
    const [updated] = await db
      .update(mockExamAttempts)
      .set({ completedAt: new Date(), overallScore: overall })
      .where(eq(mockExamAttempts.id, attemptId))
      .returning();
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Helper: compute composite overall score for an attempt by re-scoring its
// sessions from source tables (same path Agent B uses). Returns null if no
// sessions completed.
async function computeAttemptOverallScore(
  attemptId: number,
): Promise<number | null> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.mockExamAttemptId, attemptId));
  if (rows.length === 0) return null;

  const sessionIds = rows.map((r) => r.id);
  const allItemResults = await db
    .select()
    .from(itemResults)
    .where(inArray(itemResults.sessionId, sessionIds));
  const allExaminerResults = await db
    .select()
    .from(examinerQuestionResults)
    .where(inArray(examinerQuestionResults.sessionId, sessionIds));
  const itemsBySession = new Map<number, typeof allItemResults>();
  for (const r of allItemResults) {
    const arr = itemsBySession.get(r.sessionId) ?? [];
    arr.push(r);
    itemsBySession.set(r.sessionId, arr);
  }
  const examinersBySession = new Map<number, typeof allExaminerResults>();
  for (const r of allExaminerResults) {
    const arr = examinersBySession.get(r.sessionId) ?? [];
    arr.push(r);
    examinersBySession.set(r.sessionId, arr);
  }

  const composites: number[] = [];
  for (const s of rows) {
    const scoring = await buildSessionScoring(
      s.id,
      s.stationId,
      (itemsBySession.get(s.id) ?? []).map((r) => ({
        itemId: r.itemId,
        status: r.status,
      })),
      (examinersBySession.get(s.id) ?? []).map((r) => ({ score: r.score })),
    );
    composites.push(scoring.compositeScore);
  }
  if (composites.length === 0) return null;
  return composites.reduce((a, b) => a + b, 0) / composites.length;
}

// ───────────────────────────────────────────────────────────────────────
// Deprecated endpoints — kept so older clients and Agent B's scoring path
// don't break. All new work goes through /attempts.
// ───────────────────────────────────────────────────────────────────────

// GET /api/mock-exams/:id/results — legacy aggregate endpoint (reads by
// mockExamId, not attemptId). Retains iter10 composite scoring from
// Agent B so the existing MockExamResultsPage keeps working while we
// migrate it to attempt-scoped routing.
router.get("/:id/results", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const loaded = await loadOwned(id, req.user!.id);
    if (loaded.error)
      return res.status(loaded.error).json({ message: "Not found" });
    const exam = loaded.exam;

    const ids = (exam.stationIds ?? []) as number[];
    const stationRows = ids.length
      ? await db.select().from(stations).where(inArray(stations.id, ids))
      : [];
    const stationById = new Map(stationRows.map((s) => [s.id, s]));

    const examSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.mockExamId, id));
    const sessByStation = new Map<number, (typeof examSessions)[number]>();
    for (const s of examSessions) {
      const prev = sessByStation.get(s.stationId);
      if (!prev || new Date(s.startedAt) > new Date(prev.startedAt)) {
        sessByStation.set(s.stationId, s);
      }
    }

    const sessionIds = Array.from(sessByStation.values()).map((s) => s.id);
    const allItemResults = sessionIds.length
      ? await db
          .select()
          .from(itemResults)
          .where(inArray(itemResults.sessionId, sessionIds))
      : [];
    const allExaminerResults = sessionIds.length
      ? await db
          .select()
          .from(examinerQuestionResults)
          .where(inArray(examinerQuestionResults.sessionId, sessionIds))
      : [];
    const itemResultsBySession = new Map<number, typeof allItemResults>();
    for (const r of allItemResults) {
      const arr = itemResultsBySession.get(r.sessionId) ?? [];
      arr.push(r);
      itemResultsBySession.set(r.sessionId, arr);
    }
    const examinerResultsBySession = new Map<
      number,
      typeof allExaminerResults
    >();
    for (const r of allExaminerResults) {
      const arr = examinerResultsBySession.get(r.sessionId) ?? [];
      arr.push(r);
      examinerResultsBySession.set(r.sessionId, arr);
    }

    const perStation = await Promise.all(
      ids.map(async (sid, idx) => {
        const station = stationById.get(sid);
        const sess = sessByStation.get(sid);
        let scoring = null as
          | Awaited<ReturnType<typeof buildSessionScoring>>
          | null;
        if (sess) {
          scoring = await buildSessionScoring(
            sess.id,
            sess.stationId,
            (itemResultsBySession.get(sess.id) ?? []).map((r) => ({
              itemId: r.itemId,
              status: r.status,
            })),
            (examinerResultsBySession.get(sess.id) ?? []).map((r) => ({
              score: r.score,
            })),
          );
        }
        return {
          stationIndex: idx,
          stationId: sid,
          title: station?.title ?? "Untitled station",
          score: scoring ? scoring.compositeScore : null,
          scoring,
          timeUsedSeconds: sess?.timeUsedSeconds ?? null,
          criticalItemsMissed: sess?.criticalItemsMissed ?? false,
          sessionId: sess?.id ?? null,
        };
      }),
    );

    const scored = perStation.filter((p) => p.score != null);
    const overallScore =
      scored.length === 0
        ? null
        : scored.reduce((a, b) => a + (b.score ?? 0), 0) / scored.length;
    const totalTime = perStation.reduce(
      (a, b) => a + (b.timeUsedSeconds ?? 0),
      0,
    );
    const criticalMissedCount = perStation.filter(
      (p) => p.criticalItemsMissed,
    ).length;

    return res.json({
      mockExam: exam,
      perStation,
      overallScore,
      totalTimeSeconds: totalTime,
      criticalMissedCount,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
