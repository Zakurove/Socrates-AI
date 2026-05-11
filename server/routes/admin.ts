import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { storage } from "../storage.js";
import { forceUnpublishTarget } from "../services/moderation.js";
import { db } from "../db.js";
import {
  aiCosts,
  collections,
  correctionEvents,
  items,
  reports,
  sections,
  sessions,
  stations,
  itemResults,
  examinerQuestions,
  examinerQuestionResults,
  users,
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

// ─── Validation schemas ─────────────────────────────────────────
const visibilityValues = ["private", "shared", "public"] as const;
const visibilitySchema = z.enum(visibilityValues);

const listUsersQuerySchema = z.object({
  q: z.string().trim().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const listStationsQuerySchema = z.object({
  visibility: visibilitySchema.optional(),
  type: z.string().optional(),
  authorId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const listCollectionsQuerySchema = z.object({
  visibility: visibilitySchema.optional(),
  q: z.string().trim().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const updateUserSchema = z
  .object({
    isAdmin: z.boolean().optional(),
    emailVerifiedAt: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .strict();

const updateVisibilitySchema = z.object({ visibility: visibilitySchema }).strict();

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

// ─── GET /api/admin/overview ────────────────────────────────────
router.get("/overview", async (_req, res, next) => {
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM users) AS total_users,
        (SELECT count(*)::int FROM stations) AS total_stations,
        (SELECT count(*)::int FROM stations WHERE visibility = 'public') AS public_stations,
        (SELECT count(*)::int FROM collections) AS total_collections,
        (SELECT count(*)::int FROM sessions) AS total_sessions,
        (SELECT count(*)::int FROM sessions WHERE started_at >= date_trunc('day', now() at time zone 'utc')) AS sessions_today,
        (SELECT coalesce(sum(cost_estimate_usd), 0)::float FROM ai_costs WHERE created_at >= date_trunc('day', now() at time zone 'utc')) AS ai_cost_today,
        (SELECT coalesce(sum(cost_estimate_usd), 0)::float FROM ai_costs WHERE created_at >= now() - interval '30 days') AS ai_cost_month
    `);
    const row = result.rows[0] as Record<string, any>;
    return res.json({
      totalUsers: row.total_users ?? 0,
      totalStations: row.total_stations ?? 0,
      publicStations: row.public_stations ?? 0,
      totalCollections: row.total_collections ?? 0,
      totalSessions: row.total_sessions ?? 0,
      sessionsToday: row.sessions_today ?? 0,
      aiCostUsdToday: Number(row.ai_cost_today ?? 0),
      aiCostUsdMonth: Number(row.ai_cost_month ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users ───────────────────────────────────────
router.get("/users", async (req, res, next) => {
  try {
    const parsed = listUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { q, offset, limit } = parsed.data;

    const where = q
      ? or(ilike(users.email, `%${q}%`), ilike(users.displayName, `%${q}%`))
      : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(where as any);

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isAdmin: users.isAdmin,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        sessionCount: sql<number>`(SELECT count(*)::int FROM ${sessions} WHERE ${sessions.userId} = ${users.id})`,
        stationCount: sql<number>`(SELECT count(*)::int FROM ${stations} WHERE ${stations.userId} = ${users.id})`,
        aiSpendUsd: sql<number>`(SELECT coalesce(sum(cost_estimate_usd), 0)::float FROM ${aiCosts} WHERE ${aiCosts.userId} = ${users.id})`,
      })
      .from(users)
      .where(where as any)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        isAdmin: r.isAdmin,
        emailVerifiedAt: r.emailVerifiedAt ? r.emailVerifiedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        sessionCount: r.sessionCount,
        stationCount: r.stationCount,
        aiSpendUsd: Number(r.aiSpendUsd ?? 0),
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users/:id ───────────────────────────────────
router.get("/users/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) {
      return res.status(404).json({ message: "User not found" });
    }

    const countsRes = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM sessions WHERE user_id = ${id}) AS sessions,
        (SELECT count(*)::int FROM stations WHERE user_id = ${id}) AS stations,
        (SELECT count(*)::int FROM stations WHERE user_id = ${id} AND visibility = 'public') AS public_stations,
        (SELECT count(*)::int FROM collections WHERE user_id = ${id}) AS collections,
        (SELECT count(*)::int FROM collections WHERE user_id = ${id} AND visibility = 'public') AS public_collections,
        (SELECT coalesce(sum(cost_estimate_usd), 0)::float FROM ai_costs WHERE user_id = ${id}) AS ai_spend_total,
        (SELECT coalesce(sum(cost_estimate_usd), 0)::float FROM ai_costs WHERE user_id = ${id} AND created_at >= now() - interval '30 days') AS ai_spend_30d
    `);
    const c = countsRes.rows[0] as Record<string, any>;

    const recentSessions = await db
      .select({
        id: sessions.id,
        stationId: sessions.stationId,
        stationTitle: stations.title,
        mode: sessions.mode,
        totalScore: sessions.totalScore,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
      })
      .from(sessions)
      .leftJoin(stations, eq(sessions.stationId, stations.id))
      .where(eq(sessions.userId, id))
      .orderBy(desc(sessions.startedAt))
      .limit(10);

    const userStations = await db
      .select({
        id: stations.id,
        title: stations.title,
        type: stations.type,
        visibility: stations.visibility,
        createdAt: stations.createdAt,
        starCount: stations.starCount,
        forkCount: stations.forkCount,
        practiceCount: stations.practiceCount,
      })
      .from(stations)
      .where(eq(stations.userId, id))
      .orderBy(desc(stations.createdAt));

    return res.json({
      user: {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        bio: u.bio,
        isAdmin: u.isAdmin,
        emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      },
      counts: {
        sessions: c.sessions ?? 0,
        stations: c.stations ?? 0,
        publicStations: c.public_stations ?? 0,
        collections: c.collections ?? 0,
        publicCollections: c.public_collections ?? 0,
        aiSpendUsdTotal: Number(c.ai_spend_total ?? 0),
        aiSpendUsd30d: Number(c.ai_spend_30d ?? 0),
      },
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        stationId: s.stationId,
        stationTitle: s.stationTitle ?? "",
        mode: s.mode,
        totalScore: s.totalScore,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      })),
      stations: userStations.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        visibility: s.visibility,
        createdAt: s.createdAt.toISOString(),
        starCount: s.starCount,
        forkCount: s.forkCount,
        practiceCount: s.practiceCount,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id ─────────────────────────────────
router.patch("/users/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    if (
      req.user!.id === id &&
      parsed.data.isAdmin === false
    ) {
      return res.status(403).json({ message: "Cannot self-demote" });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.isAdmin !== undefined) updates.isAdmin = parsed.data.isAdmin;
    if (parsed.data.emailVerifiedAt !== undefined) {
      updates.emailVerifiedAt = parsed.data.emailVerifiedAt
        ? new Date(parsed.data.emailVerifiedAt)
        : null;
    }

    const [updated] = await db
      .update(users)
      .set(updates as any)
      .where(eq(users.id, id))
      .returning();
    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.json({
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      isAdmin: updated.isAdmin,
      emailVerifiedAt: updated.emailVerifiedAt
        ? updated.emailVerifiedAt.toISOString()
        : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/users/:id ────────────────────────────────
router.delete("/users/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    if (req.user!.id === id) {
      return res.status(403).json({ message: "Cannot self-delete" });
    }

    const target = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (target.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    if (target[0].isAdmin) {
      const [{ adminCount }] = await db
        .select({ adminCount: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.isAdmin, true));
      if (adminCount <= 1) {
        return res
          .status(409)
          .json({ message: "Cannot delete the last admin" });
      }
    }

    await db.delete(users).where(eq(users.id, id));
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/stations ────────────────────────────────────
router.get("/stations", async (req, res, next) => {
  try {
    const parsed = listStationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { visibility, type, authorId, q, offset, limit } = parsed.data;

    const conds = [] as any[];
    if (visibility) conds.push(eq(stations.visibility, visibility));
    if (type) conds.push(sql`${stations.type}::text = ${type}`);
    if (authorId) conds.push(eq(stations.userId, authorId));
    if (q) conds.push(ilike(stations.title, `%${q}%`));
    const where = conds.length ? and(...conds) : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(stations)
      .where(where as any);

    const rows = await db
      .select({
        id: stations.id,
        title: stations.title,
        type: stations.type,
        visibility: stations.visibility,
        createdAt: stations.createdAt,
        updatedAt: stations.updatedAt,
        authorId: users.id,
        authorDisplayName: users.displayName,
        starCount: stations.starCount,
        forkCount: stations.forkCount,
        practiceCount: stations.practiceCount,
        isCritical: sql<boolean>`exists (
          SELECT 1 FROM ${items} i
          INNER JOIN ${sections} s ON s.id = i.section_id
          WHERE s.station_id = ${stations.id} AND i.is_critical = true
        )`,
        reportCount: sql<number>`(
          SELECT count(*)::int FROM ${reports} r
          WHERE r.target_type = 'station' AND r.target_id = ${stations.id} AND r.status = 'open'
        )`,
      })
      .from(stations)
      .leftJoin(users, eq(stations.userId, users.id))
      .where(where as any)
      .orderBy(desc(stations.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        visibility: r.visibility,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        author: {
          id: r.authorId ?? 0,
          displayName: r.authorDisplayName ?? "",
        },
        starCount: r.starCount,
        forkCount: r.forkCount,
        practiceCount: r.practiceCount,
        isCritical: r.isCritical,
        reportCount: r.reportCount,
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/stations/:id/visibility ───────────────────
router.patch("/stations/:id/visibility", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid station ID" });
    }
    const parsed = updateVisibilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db
      .select()
      .from(stations)
      .where(eq(stations.id, id));
    if (!existing) {
      return res.status(404).json({ message: "Station not found" });
    }

    const updates: Record<string, unknown> = {
      visibility: parsed.data.visibility,
      updatedAt: new Date(),
    };
    if (parsed.data.visibility === "public" && !existing.publishedAt) {
      updates.publishedAt = new Date();
    }

    const [updated] = await db
      .update(stations)
      .set(updates as any)
      .where(eq(stations.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/collections ─────────────────────────────────
router.get("/collections", async (req, res, next) => {
  try {
    const parsed = listCollectionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { visibility, q, offset, limit } = parsed.data;

    const conds = [] as any[];
    if (visibility) conds.push(eq(collections.visibility, visibility));
    if (q) conds.push(ilike(collections.title, `%${q}%`));
    const where = conds.length ? and(...conds) : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(collections)
      .where(where as any);

    const rows = await db
      .select({
        id: collections.id,
        title: collections.title,
        visibility: collections.visibility,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        authorId: users.id,
        authorDisplayName: users.displayName,
        starCount: collections.starCount,
        forkCount: collections.forkCount,
        reportCount: sql<number>`(
          SELECT count(*)::int FROM ${reports} r
          WHERE r.target_type = 'collection' AND r.target_id = ${collections.id} AND r.status = 'open'
        )`,
      })
      .from(collections)
      .leftJoin(users, eq(collections.userId, users.id))
      .where(where as any)
      .orderBy(desc(collections.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        visibility: r.visibility,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        author: {
          id: r.authorId ?? 0,
          displayName: r.authorDisplayName ?? "",
        },
        starCount: r.starCount,
        forkCount: r.forkCount,
        reportCount: r.reportCount,
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/collections/:id/visibility ────────────────
router.patch("/collections/:id/visibility", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid collection ID" });
    }
    const parsed = updateVisibilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id));
    if (!existing) {
      return res.status(404).json({ message: "Collection not found" });
    }

    const updates: Record<string, unknown> = {
      visibility: parsed.data.visibility,
      updatedAt: new Date(),
    };
    if (parsed.data.visibility === "public" && !existing.publishedAt) {
      updates.publishedAt = new Date();
    }

    const [updated] = await db
      .update(collections)
      .set(updates as any)
      .where(eq(collections.id, id))
      .returning();
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/analytics ───────────────────────────────────
router.get("/analytics", async (req, res, next) => {
  try {
    const parsed = analyticsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { days } = parsed.data;

    const dailyRes = await db.execute(sql`
      WITH series AS (
        SELECT generate_series(
          date_trunc('day', now() at time zone 'utc') - (${days - 1} || ' days')::interval,
          date_trunc('day', now() at time zone 'utc'),
          interval '1 day'
        )::date AS day
      ),
      new_users AS (
        SELECT date_trunc('day', created_at at time zone 'utc')::date AS day, count(*)::int AS n
        FROM users
        WHERE created_at >= date_trunc('day', now() at time zone 'utc') - (${days - 1} || ' days')::interval
        GROUP BY 1
      ),
      sess AS (
        SELECT date_trunc('day', started_at at time zone 'utc')::date AS day, count(*)::int AS n
        FROM sessions
        WHERE started_at >= date_trunc('day', now() at time zone 'utc') - (${days - 1} || ' days')::interval
        GROUP BY 1
      ),
      costs AS (
        SELECT date_trunc('day', created_at at time zone 'utc')::date AS day, sum(cost_estimate_usd)::float AS s
        FROM ai_costs
        WHERE created_at >= date_trunc('day', now() at time zone 'utc') - (${days - 1} || ' days')::interval
        GROUP BY 1
      )
      SELECT
        to_char(s.day, 'YYYY-MM-DD') AS date,
        coalesce(nu.n, 0) AS new_users,
        coalesce(ss.n, 0) AS sessions_started,
        coalesce(c.s, 0)::float AS ai_cost_usd
      FROM series s
      LEFT JOIN new_users nu ON nu.day = s.day
      LEFT JOIN sess ss ON ss.day = s.day
      LEFT JOIN costs c ON c.day = s.day
      ORDER BY s.day ASC
    `);

    const daily = (dailyRes.rows as any[]).map((r) => ({
      date: r.date as string,
      newUsers: Number(r.new_users ?? 0),
      sessionsStarted: Number(r.sessions_started ?? 0),
      aiCostUsd: Number(r.ai_cost_usd ?? 0),
    }));

    const topStations = await db
      .select({
        id: stations.id,
        title: stations.title,
        authorId: users.id,
        authorDisplayName: users.displayName,
        practiceCount: stations.practiceCount,
        starCount: stations.starCount,
        forkCount: stations.forkCount,
      })
      .from(stations)
      .leftJoin(users, eq(stations.userId, users.id))
      .orderBy(desc(stations.practiceCount))
      .limit(10);

    const topUsersBySessionsRes = await db.execute(sql`
      SELECT u.id, u.email, u.display_name,
        (SELECT count(*)::int FROM sessions WHERE user_id = u.id) AS session_count,
        (SELECT coalesce(sum(cost_estimate_usd), 0)::float FROM ai_costs WHERE user_id = u.id) AS ai_spend
      FROM users u
      ORDER BY session_count DESC
      LIMIT 10
    `);

    const topUsersBySpendRes = await db.execute(sql`
      SELECT u.id, u.email, u.display_name,
        (SELECT count(*)::int FROM sessions WHERE user_id = u.id) AS session_count,
        (SELECT coalesce(sum(cost_estimate_usd), 0)::float FROM ai_costs WHERE user_id = u.id) AS ai_spend
      FROM users u
      ORDER BY ai_spend DESC
      LIMIT 10
    `);

    const criticalRes = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM sessions
          WHERE ended_at IS NOT NULL
          AND started_at >= now() - (${days} || ' days')::interval
          AND critical_items_missed = true) AS with_critical,
        (SELECT count(*)::int FROM sessions
          WHERE ended_at IS NOT NULL
          AND started_at >= now() - (${days} || ' days')::interval) AS total_ended
    `);
    const cr = criticalRes.rows[0] as Record<string, any>;
    const withCriticalMissed = Number(cr.with_critical ?? 0);
    const totalEnded = Number(cr.total_ended ?? 0);

    const now = new Date();
    const startDate = new Date(now.getTime() - (days - 1) * 86400000);

    return res.json({
      range: {
        days,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: now.toISOString().slice(0, 10),
      },
      daily,
      topStationsByPractice: topStations.map((s) => ({
        id: s.id,
        title: s.title,
        author: {
          id: s.authorId ?? 0,
          displayName: s.authorDisplayName ?? "",
        },
        practiceCount: s.practiceCount,
        starCount: s.starCount,
        forkCount: s.forkCount,
      })),
      topUsersBySessions: (topUsersBySessionsRes.rows as any[]).map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        sessionCount: Number(r.session_count ?? 0),
        aiSpendUsd: Number(r.ai_spend ?? 0),
      })),
      topUsersBySpend: (topUsersBySpendRes.rows as any[]).map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        sessionCount: Number(r.session_count ?? 0),
        aiSpendUsd: Number(r.ai_spend ?? 0),
      })),
      criticalFailRate: {
        withCriticalMissed,
        totalEnded,
        rate: totalEnded > 0 ? withCriticalMissed / totalEnded : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
