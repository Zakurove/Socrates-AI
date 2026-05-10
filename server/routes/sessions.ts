import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { storage } from "../storage.js";
import { buildSessionScoring } from "../services/session-scoring.js";

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
        matchedTranscript: item.matchedTranscript ?? null,
        timestampSeconds: item.timestampSeconds ?? null,
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
        feedback: q.feedback ?? null,
      })),
    );

    return res.status(201).json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
