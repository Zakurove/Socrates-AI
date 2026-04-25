import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage.js";
import { libraryLimiter } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/auth.js";
import { sanitizePublicStation } from "../services/moderation.js";
import { STATION_TYPES } from "../../shared/schema.js";
import type { PublicStationSummary } from "../../shared/schema.js";

const router = Router();

// Library is gated: users must be signed in to browse the community library.
router.use(libraryLimiter);
router.use(requireAuth);

// ─── Query parsing ──────────────────────────────────────────────

const listStationsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  type: z.enum(STATION_TYPES).optional(),
  specialty: z.string().max(100).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  sort: z.enum(["recent", "popular", "forks", "practices"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
});

const listCollectionsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  specialty: z.string().max(100).optional(),
  sort: z.enum(["recent", "popular", "forks"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
});

// Storage expects its own sort keys: map UX-friendly values.
function mapStationSort(sort?: string): string | undefined {
  if (!sort) return undefined;
  if (sort === "popular") return "stars";
  return sort;
}
function mapCollectionSort(sort?: string): string | undefined {
  if (!sort) return undefined;
  if (sort === "popular") return "stars";
  return sort;
}

async function decorateStationsWithStars(
  items: PublicStationSummary[],
  userId: number | undefined,
): Promise<PublicStationSummary[]> {
  if (!userId || items.length === 0) return items;
  const out: PublicStationSummary[] = [];
  for (const s of items) {
    const isStarred = await storage.isStationStarredByUser(userId, s.id);
    out.push({ ...s, isStarred });
  }
  return out;
}

// ─── GET /api/library/stations ──────────────────────────────────
router.get("/stations", async (req, res, next) => {
  try {
    const parsed = listStationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { q, type, specialty, difficulty, sort, page, pageSize } = parsed.data;
    const { items, total } = await storage.listPublicStations({
      q,
      type,
      specialty,
      difficulty,
      sort: mapStationSort(sort),
      page,
      pageSize,
    });

    const decorated = await decorateStationsWithStars(items, req.user?.id);
    return res.json({
      items: decorated,
      total,
      page: page ?? 1,
      pageSize: pageSize ?? 20,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/library/collections ───────────────────────────────
router.get("/collections", async (req, res, next) => {
  try {
    const parsed = listCollectionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { q, specialty, sort, page, pageSize } = parsed.data;
    const { items, total } = await storage.listPublicCollections({
      q,
      specialty,
      sort: mapCollectionSort(sort),
      page,
      pageSize,
    });

    let decorated = items;
    if (req.user?.id) {
      const uid = req.user.id;
      const out = [];
      for (const c of items) {
        const isStarred = await storage.isCollectionStarredByUser(uid, c.id);
        out.push({ ...c, isStarred });
      }
      decorated = out;
    }

    return res.json({
      items: decorated,
      total,
      page: page ?? 1,
      pageSize: pageSize ?? 20,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/library/featured ──────────────────────────────────
// Top 6 by starCount; fall back to recent if everything's zero.
router.get("/featured", async (req, res, next) => {
  try {
    const byStars = await storage.listPublicStations({
      sort: "stars",
      page: 1,
      pageSize: 6,
    });
    const hasStars = byStars.items.some((s) => s.starCount > 0);
    const items = hasStars
      ? byStars.items
      : (
          await storage.listPublicStations({
            sort: "recent",
            page: 1,
            pageSize: 6,
          })
        ).items;

    const decorated = await decorateStationsWithStars(items, req.user?.id);
    return res.json({ items: decorated });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/library/stations/:id ──────────────────────────────
router.get("/stations/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid station ID" });
    }

    const station = await storage.getPublicStation(id);
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    const sanitized = sanitizePublicStation(station);
    if (req.user?.id) {
      sanitized.isStarred = await storage.isStationStarredByUser(
        req.user.id,
        id,
      );
    }
    return res.json(sanitized);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/library/collections/:id ───────────────────────────
router.get("/collections/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid collection ID" });
    }

    const collection = await storage.getPublicCollection(id);
    if (!collection) {
      return res.status(404).json({ message: "Collection not found" });
    }

    // Decorate stations with isStarred if authenticated.
    let stationsOut = collection.stations;
    if (req.user?.id) {
      const uid = req.user.id;
      const out: PublicStationSummary[] = [];
      for (const s of stationsOut) {
        out.push({ ...s, isStarred: await storage.isStationStarredByUser(uid, s.id) });
      }
      stationsOut = out;
    }

    let isStarred: boolean | undefined;
    if (req.user?.id) {
      isStarred = await storage.isCollectionStarredByUser(req.user.id, id);
    }

    // Sanitize: strip userId from the row itself.
    const { userId: _userId, ...rest } = collection;
    return res.json({ ...rest, stations: stationsOut, isStarred });
  } catch (err) {
    next(err);
  }
});

export default router;
