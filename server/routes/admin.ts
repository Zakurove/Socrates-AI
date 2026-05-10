import { Router } from "express";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { storage } from "../storage.js";
import { forceUnpublishTarget } from "../services/moderation.js";
import { db } from "../db.js";
import {
  correctionEvents,
  items,
  sections,
  stations,
  itemResults,
  examinerQuestions,
  examinerQuestionResults,
} from "../../shared/schema.js";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// ─── GET /api/admin/reports ─────────────────────────────────────
const listReportsQuerySchema = z.object({
  status: z.enum(["open", "reviewed_ok", "removed"]).optional(),
});

router.get("/reports", async (req, res, next) => {
  try {
    const parsed = listReportsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    // Default filter: open reports — most actionable.
    const status = parsed.data.status ?? "open";
    const rows = await storage.listReports(status);
    return res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/reports/:id ───────────────────────────────
const updateReportBodySchema = z
  .object({
    status: z.enum(["reviewed_ok", "removed"]),
    notes: z.string().max(2000).optional(),
  })
  .strict();

router.patch("/reports/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid report ID" });
    }

    const parsed = updateReportBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const updated = await storage.updateReport(id, {
      status: parsed.data.status,
      reviewedBy: req.user!.id,
      notes: parsed.data.notes,
    });
    if (!updated) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Cascading takedown: if moderator resolved as "removed", force the
    // target private. Failure here is surfaced — moderator should know.
    if (parsed.data.status === "removed") {
      await forceUnpublishTarget(updated.targetType, updated.targetId);
    }

    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/stations/:id/unpublish ─────────────────────
router.post("/stations/:id/unpublish", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid station ID" });
    }
    const updated = await storage.unpublishStation(id);
    if (!updated) {
      return res.status(404).json({ message: "Station not found" });
    }
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/collections/:id/unpublish ──────────────────
router.post("/collections/:id/unpublish", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid collection ID" });
    }
    const updated = await storage.unpublishCollection(id);
    if (!updated) {
      return res.status(404).json({ message: "Collection not found" });
    }
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/stations/:id ─────────────────────────────
// Hard delete — rare; prefer unpublish. Cascade handled by FK constraints.
router.delete("/stations/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid station ID" });
    }
    const existing = await storage.getStation(id);
    if (!existing) {
      return res.status(404).json({ message: "Station not found" });
    }
    await storage.deleteStation(id);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/corrections ─────────────────────────────────
// Aggregated stats over correction_events. Used to surface the checklist
// items / examiner questions where the AI matcher most frequently disagrees
// with users, so prompts can be tuned.
router.get("/corrections", async (_req, res, next) => {
  try {
    // Top item corrections: group correction_events for items by the
    // underlying item_id (joining through item_results), then enrich with
    // item/section/station metadata + AI-vs-user vote breakdown.
    const itemAgg = await db
      .select({
        itemId: items.id,
        itemText: items.text,
        sectionTitle: sections.title,
        parentItemId: items.parentItemId,
        stationId: stations.id,
        stationTitle: stations.title,
        timesCorrected: sql<number>`count(*)::int`,
        userSaysChecked: sql<number>`sum(case when ${correctionEvents.toValue} = 'checked' then 1 else 0 end)::int`,
        userSaysMissed: sql<number>`sum(case when ${correctionEvents.toValue} = 'missed' then 1 else 0 end)::int`,
        aiSaidChecked: sql<number>`sum(case when ${correctionEvents.aiValue} = 'checked' then 1 else 0 end)::int`,
        aiSaidMissed: sql<number>`sum(case when ${correctionEvents.aiValue} = 'missed' then 1 else 0 end)::int`,
      })
      .from(correctionEvents)
      .innerJoin(itemResults, eq(correctionEvents.targetId, itemResults.id))
      .innerJoin(items, eq(itemResults.itemId, items.id))
      .innerJoin(sections, eq(items.sectionId, sections.id))
      .innerJoin(stations, eq(sections.stationId, stations.id))
      .where(eq(correctionEvents.targetType, "item_result"))
      .groupBy(
        items.id,
        items.text,
        items.parentItemId,
        sections.title,
        stations.id,
        stations.title,
      )
      .orderBy(desc(sql`count(*)`))
      .limit(50);

    // Look up parent-item text for items that are sub-items. One round-trip
    // for the de-duped parent ids.
    const parentIds = Array.from(
      new Set(
        itemAgg.map((r) => r.parentItemId).filter((id): id is number => id !== null),
      ),
    );
    const parentRows = parentIds.length
      ? await db
          .select({ id: items.id, text: items.text })
          .from(items)
          .where(sql`${items.id} = ANY(${parentIds})`)
      : [];
    const parentTextById = new Map(parentRows.map((r) => [r.id, r.text]));

    const topCorrected = itemAgg.map((r) => ({
      itemId: r.itemId,
      itemText: r.itemText,
      sectionTitle: r.sectionTitle,
      parentText:
        r.parentItemId !== null
          ? parentTextById.get(r.parentItemId) ?? null
          : null,
      stationId: r.stationId,
      stationTitle: r.stationTitle,
      timesCorrected: r.timesCorrected,
      userSaysChecked: r.userSaysChecked,
      userSaysMissed: r.userSaysMissed,
      aiSaidChecked: r.aiSaidChecked,
      aiSaidMissed: r.aiSaidMissed,
    }));

    // Top examiner question corrections: order by largest avg user-vs-AI score
    // delta. from_value / to_value / ai_value are stored as text-numerics.
    const questionAgg = await db
      .select({
        questionId: examinerQuestions.id,
        questionText: examinerQuestions.question,
        stationId: stations.id,
        stationTitle: stations.title,
        timesCorrected: sql<number>`count(*)::int`,
        avgUserScore: sql<number>`avg(nullif(${correctionEvents.toValue}, '')::numeric)::float`,
        avgAiScore: sql<number>`avg(nullif(${correctionEvents.aiValue}, '')::numeric)::float`,
      })
      .from(correctionEvents)
      .innerJoin(
        examinerQuestionResults,
        eq(correctionEvents.targetId, examinerQuestionResults.id),
      )
      .innerJoin(
        examinerQuestions,
        eq(examinerQuestionResults.questionId, examinerQuestions.id),
      )
      .innerJoin(stations, eq(examinerQuestions.stationId, stations.id))
      .where(eq(correctionEvents.targetType, "question_result"))
      .groupBy(
        examinerQuestions.id,
        examinerQuestions.question,
        stations.id,
        stations.title,
      )
      .orderBy(
        desc(
          sql`abs(coalesce(avg(nullif(${correctionEvents.toValue}, '')::numeric), 0) - coalesce(avg(nullif(${correctionEvents.aiValue}, '')::numeric), 0))`,
        ),
      )
      .limit(50);

    const topQuestionCorrections = questionAgg.map((r) => ({
      questionId: r.questionId,
      questionText: r.questionText,
      stationId: r.stationId,
      stationTitle: r.stationTitle,
      timesCorrected: r.timesCorrected,
      avgUserScore: Number(r.avgUserScore ?? 0),
      avgAiScore: Number(r.avgAiScore ?? 0),
    }));

    // Global totals: total corrections + item false-positive / false-negative
    // counts (matcher said checked but user flipped to missed = FP, vice versa).
    const [totalsRow] = await db
      .select({
        totalCorrections: sql<number>`count(*)::int`,
      })
      .from(correctionEvents);

    const [fpRow] = await db
      .select({
        n: sql<number>`count(*)::int`,
      })
      .from(correctionEvents)
      .where(
        sql`${correctionEvents.targetType} = 'item_result'
            and ${correctionEvents.aiValue} = 'checked'
            and ${correctionEvents.toValue} = 'missed'`,
      );

    const [fnRow] = await db
      .select({
        n: sql<number>`count(*)::int`,
      })
      .from(correctionEvents)
      .where(
        sql`${correctionEvents.targetType} = 'item_result'
            and ${correctionEvents.aiValue} = 'missed'
            and ${correctionEvents.toValue} = 'checked'`,
      );

    const recent = await db
      .select({
        id: correctionEvents.id,
        occurredAt: correctionEvents.occurredAt,
        targetType: correctionEvents.targetType,
        aiValue: correctionEvents.aiValue,
        toValue: correctionEvents.toValue,
      })
      .from(correctionEvents)
      .orderBy(desc(correctionEvents.occurredAt))
      .limit(20);

    return res.json({
      topCorrected,
      topQuestionCorrections,
      totals: {
        totalCorrections: totalsRow?.totalCorrections ?? 0,
        itemFalsePositives: fpRow?.n ?? 0,
        itemFalseNegatives: fnRow?.n ?? 0,
        recentEvents: recent.map((r) => ({
          id: r.id,
          occurredAt: r.occurredAt.toISOString(),
          target: r.targetType === "item_result" ? "item" : "question",
          ai: r.aiValue,
          userView: r.toValue,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
