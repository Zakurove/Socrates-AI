import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { storage } from "../storage.js";
import {
  buildSessionScoring,
  recomputeSessionTotalScore,
} from "../services/session-scoring.js";

const router = Router();
router.use(requireAuth);

const createSessionSchema = z.object({
  stationId: z.number().int().positive(),
  mode: z.enum(["self_check", "ai_history", "ai_observer", "ai_communication"]),
  timeLimitSeconds: z.number().int().positive(),
  mockExamId: z.number().int().positive().optional(),
  mockExamAttemptId: z.number().int().positive().optional(),
});

const itemResultSchema = z.object({
  itemId: z.number().int().positive(),
  status: z.enum(["checked", "missed", "partial", "checked_after_time"]),
  matchedTranscript: z.string().optional(),
  timestampSeconds: z.number().int().optional(),
});

const updateSessionSchema = z
  .object({
    timeUsedSeconds: z.number().int().nonnegative().max(24 * 60 * 60).optional(),
    totalScore: z.number().min(0).max(1000).optional(),
    criticalItemsMissed: z.boolean().optional(),
    transcript: z.string().max(200000).optional(),
    endedAt: z
      .union([
        z.date(),
        z.string().datetime().transform((s) => new Date(s)),
      ])
      .optional(),
  })
  .strict();

const questionResultSchema = z.object({
  questionId: z.number().int().positive(),
  userAnswerTranscript: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  feedback: z.string().optional(),
  // For checklist-type questions: per-item present/missed breakdown.
  pointResults: z
    .array(
      z.object({
        point: z.string().min(1).max(500),
        status: z.enum(["present", "missed"]),
      }),
    )
    .max(50)
    .optional(),
});

// GET /api/sessions
router.get("/", async (req, res, next) => {
  try {
    const stationId = req.query.stationId
      ? parseInt(req.query.stationId as string, 10)
      : undefined;

    const list = await storage.getSessions(req.user!.id, stationId);
    return res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions/:id
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });

    const session = await storage.getSession(id);
    if (!session) return res.status(404).json({ message: "Session not found" });
    if (session.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Recompute scoring breakdown from source-of-truth tables so older
    // sessions (stored totalScore predates iter10 weighting) surface the
    // correct composite. `session.totalScore` is kept for backwards compat
    // but the client should prefer `scoring.compositeScore`.
    const scoring = await buildSessionScoring(
      session.id,
      session.stationId,
      session.itemResults.map((r) => ({
        itemId: r.itemId,
        status: r.status,
      })),
      session.examinerQuestionResults.map((r) => ({ score: r.score })),
    );

    return res.json({ ...session, scoring });
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions
router.post("/", async (req, res, next) => {
  try {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const session = await storage.createSession({
      userId: req.user!.id,
      ...parsed.data,
    });
    return res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

// PUT /api/sessions/:id
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });

    const existing = await storage.getSession(id);
    if (!existing) return res.status(404).json({ message: "Session not found" });
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // If the client is transitioning the session to "ended", use the
    // atomic finalizer so concurrent double-submits can only bump the
    // practice counter once.
    if (!existing.endedAt && parsed.data.endedAt) {
      const { session } = await storage.finalizeSession(id, parsed.data);
      return res.json(session ?? existing);
    }

    const updated = await storage.updateSession(id, parsed.data);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sessions/:id — used both to discard an in-progress session
// (cancel mid-practice) and to remove a finalized session from history
// (progress / results pages). FK ON DELETE CASCADE takes care of
// item_results and examiner_question_results.
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });

    const existing = await storage.getSession(id);
    if (!existing) {
      // Idempotent: deleting an already-deleted session is fine.
      return res.status(204).end();
    }
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await storage.deleteSession(id);
    return res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/:id/item-results (batch)
router.post("/:id/item-results", async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

    const existing = await storage.getSession(sessionId);
    if (!existing) return res.status(404).json({ message: "Session not found" });
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Idempotency: once a session has ended, don't insert duplicate item-results
    // on a double-end. Return the existing rows so the client can proceed.
    if (existing.endedAt) {
      const prior = await storage.getItemResultsBySession(sessionId);
      return res.status(200).json(prior);
    }

    const parsed = z.array(itemResultSchema).max(1000).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }

    // Cross-check: every itemId must belong to the session's station.
    const station = await storage.getStation(existing.stationId);
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }
    // Recurse all 3 levels (items → subItems → subItems). Previously stopped
    // at level 2, which silently dropped sub-sub-item results.
    const allowedItemIds = new Set<number>();
    for (const section of station.sections ?? []) {
      for (const it of section.items ?? []) {
        allowedItemIds.add(it.id);
        for (const sub of (it as any).subItems ?? []) {
          allowedItemIds.add(sub.id);
          for (const ssub of (sub as any).subItems ?? []) {
            allowedItemIds.add(ssub.id);
          }
        }
      }
    }
    for (const item of parsed.data) {
      if (!allowedItemIds.has(item.itemId)) {
        return res
          .status(400)
          .json({ message: `itemId ${item.itemId} does not belong to this session's station` });
      }
    }

    const results = await storage.createItemResults(
      parsed.data.map((item) => ({
        sessionId,
        itemId: item.itemId,
        status: item.status,
        // Freeze the AI's original verdict at save time. The user's later
        // corrections mutate `status` only; `ai_status` is read-only.
        aiStatus: item.status,
        matchedTranscript: item.matchedTranscript ?? null,
        timestampSeconds: item.timestampSeconds ?? null,
        correctedAt: null,
        correctionNote: null,
      })),
    );

    return res.status(201).json(results);
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/:id/question-results (batch)
router.post("/:id/question-results", async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) return res.status(400).json({ message: "Invalid session ID" });

    const existing = await storage.getSession(sessionId);
    if (!existing) return res.status(404).json({ message: "Session not found" });
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const parsed = z.array(questionResultSchema).max(500).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }

    // Cross-check: every questionId must belong to the session's station.
    const station = await storage.getStation(existing.stationId);
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }
    const allowedQuestionIds = new Set<number>(
      (station.examinerQuestions ?? []).map((q: any) => q.id),
    );
    for (const q of parsed.data) {
      if (!allowedQuestionIds.has(q.questionId)) {
        return res
          .status(400)
          .json({ message: `questionId ${q.questionId} does not belong to this session's station` });
      }
    }

    const results = await storage.createExaminerQuestionResults(
      parsed.data.map((q) => ({
        sessionId,
        questionId: q.questionId,
        userAnswerTranscript: q.userAnswerTranscript ?? null,
        score: q.score ?? null,
        // Freeze the AI's original score so a later user correction can
        // be told apart from the matcher's verdict.
        aiScore: q.score ?? null,
        feedback: q.feedback ?? null,
        pointResults: q.pointResults ?? null,
        correctedAt: null,
        correctionNote: null,
      })),
    );

    return res.status(201).json(results);
  } catch (err) {
    next(err);
  }
});

// ─── User corrections ───────────────────────────────────────────
// Lets the practitioner override the AI matcher's verdict after grading.
// Both endpoints log to correction_events for analytics + audit, then
// recompute session.totalScore against the corrected rows.

const patchItemResultSchema = z
  .object({
    // Only user-settable statuses; partial / checked_after_time stay
    // whatever the matcher set them to.
    status: z.enum(["checked", "missed"]),
    note: z.string().max(500).optional(),
  })
  .strict();

router.patch(
  "/:sessionId/item-results/:itemResultId",
  async (req, res, next) => {
    try {
      const sessionId = parseInt(req.params.sessionId, 10);
      const itemResultId = parseInt(req.params.itemResultId, 10);
      if (isNaN(sessionId) || isNaN(itemResultId)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const session = await storage.getSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== req.user!.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const parsed = patchItemResultSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const row = await storage.getItemResult(itemResultId);
      if (!row) return res.status(404).json({ message: "Item result not found" });
      if (row.sessionId !== sessionId) {
        return res
          .status(400)
          .json({ message: "Item result does not belong to this session" });
      }

      // Parents (items with children) are derived headings and not graded
      // directly — block correction attempts on them.
      if ((row.item.subItems ?? []).length > 0) {
        return res
          .status(400)
          .json({ message: "Parent items are not correctable" });
      }

      const currentStatus = row.status;
      const newStatus = parsed.data.status;
      const note = parsed.data.note ?? null;

      // Idempotent: no-op when the requested status matches the current one.
      if (newStatus === currentStatus) {
        return res.json({
          itemResult: row,
          sessionTotalScore: session.totalScore ?? 0,
        });
      }

      // Flipping back to AI's original verdict clears the correction marker.
      const revertingToAi = newStatus === row.aiStatus;
      const updated = await storage.updateItemResult(itemResultId, {
        status: newStatus,
        correctedAt: revertingToAi ? null : new Date(),
        correctionNote: note,
      });

      await storage.insertCorrectionEvent({
        sessionId,
        userId: req.user!.id,
        targetType: "item_result",
        targetId: row.id,
        aiValue: row.aiStatus,
        fromValue: currentStatus,
        toValue: newStatus,
        note,
      });

      const sessionTotalScore = await recomputeSessionTotalScore(sessionId);
      return res.json({ itemResult: updated, sessionTotalScore });
    } catch (err) {
      next(err);
    }
  },
);

const patchQuestionResultSchema = z
  .object({
    score: z.number().min(0).max(1),
    note: z.string().max(500).optional(),
    // For checklist-type questions: optional per-item present/missed override.
    // When supplied, the server persists it alongside the new score so the
    // results page renders the corrected breakdown after a refetch.
    pointResults: z
      .array(
        z.object({
          point: z.string().min(1).max(500),
          status: z.enum(["present", "missed"]),
        }),
      )
      .max(50)
      .optional(),
  })
  .strict();

router.patch(
  "/:sessionId/question-results/:questionResultId",
  async (req, res, next) => {
    try {
      const sessionId = parseInt(req.params.sessionId, 10);
      const questionResultId = parseInt(req.params.questionResultId, 10);
      if (isNaN(sessionId) || isNaN(questionResultId)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const session = await storage.getSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== req.user!.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const parsed = patchQuestionResultSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const row = await storage.getExaminerQuestionResult(questionResultId);
      if (!row) {
        return res.status(404).json({ message: "Question result not found" });
      }
      if (row.sessionId !== sessionId) {
        return res
          .status(400)
          .json({ message: "Question result does not belong to this session" });
      }

      const currentScore = row.score;
      const newScore = parsed.data.score;
      const note = parsed.data.note ?? null;

      // No-op fast path: same score AND no pointResults override. We still
      // pass through if pointResults was supplied so a per-item correction
      // (which can leave the aggregate score unchanged at boundary values)
      // actually persists.
      if (
        currentScore !== null &&
        newScore === currentScore &&
        parsed.data.pointResults === undefined
      ) {
        return res.json({
          questionResult: row,
          sessionTotalScore: session.totalScore ?? 0,
        });
      }

      const revertingToAi = row.aiScore !== null && newScore === row.aiScore;
      const updated = await storage.updateExaminerQuestionResult(
        questionResultId,
        {
          score: newScore,
          correctedAt: revertingToAi ? null : new Date(),
          correctionNote: note,
          // Only overwrite pointResults when the client actually supplied
          // them — `undefined` leaves the existing column alone so a plain
          // slider correction on a non-checklist question keeps the row's
          // existing (null) breakdown.
          ...(parsed.data.pointResults !== undefined
            ? { pointResults: parsed.data.pointResults }
            : {}),
        },
      );

      await storage.insertCorrectionEvent({
        sessionId,
        userId: req.user!.id,
        targetType: "question_result",
        targetId: row.id,
        aiValue: row.aiScore === null ? "" : String(row.aiScore),
        fromValue: currentScore === null ? "" : String(currentScore),
        toValue: String(newScore),
        note,
      });

      const sessionTotalScore = await recomputeSessionTotalScore(sessionId);
      return res.json({ questionResult: updated, sessionTotalScore });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
