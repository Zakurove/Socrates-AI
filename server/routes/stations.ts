import { Router } from "express";
import { z } from "zod";
import {
  createStationSchema,
  referenceImageUrlSchema,
  STATION_TYPES,
  getStationTypeDefaults,
} from "../../shared/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { storage } from "../storage.js";
import { invalidateSimulatorCache } from "./ai.js";
import { reportLimiter } from "../middleware/rate-limit.js";
import { sanitizePublicStation } from "../services/moderation.js";

const router = Router();

// Write-permission helper. For personal stations (collectionId is null),
// only the owner can write. For group copies (collectionId set), any
// editor+ member of the collection can write — the userId on the station
// is just "who minted the fork" and doesn't grant exclusive ownership.
async function canWriteStation(
  station: { userId: number; collectionId: number | null },
  userId: number,
): Promise<boolean> {
  if (station.collectionId == null) {
    return station.userId === userId;
  }
  const m = await storage.getCollectionMembership(
    station.collectionId,
    userId,
  );
  return m?.role === "owner" || m?.role === "editor";
}

// Read-permission helper. Personal stations: owner only (visibility !=
// public/shared is enforced elsewhere). Group copies: ANY member of
// the collection — viewer included — can read, because the whole point
// of sharing into a group is that the group can see it. Without this,
// non-owner members hit a 403 on the private branch and the client
// renders "Station not found" for stations they can plainly see in
// the group's list.
async function canReadStation(
  station: { userId: number; collectionId: number | null },
  userId: number,
): Promise<boolean> {
  if (station.collectionId == null) {
    return station.userId === userId;
  }
  const m = await storage.getCollectionMembership(
    station.collectionId,
    userId,
  );
  return m != null;
}

// NOTE: requireAuth is applied per-endpoint below (not globally) so that
// `GET /:id` can serve public stations to unauthenticated visitors.

// Allow-list of mutable flat fields on a station. Excludes id, userId,
// createdAt, updatedAt, forkOf and the nested sections/items/examinerQuestions
// trees (which are handled by a separate rewrite endpoint).
const updateStationSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    type: z.enum(STATION_TYPES).optional(),
    hasPatientBriefing: z.boolean().optional(),
    aiPatientEnabled: z.boolean().optional(),
    defaultTimeMinutes: z.number().int().positive().max(24 * 60).optional(),
    readingTimeMinutes: z.number().int().nonnegative().max(60).optional(),
    scenario: z.string().max(20000).optional(),
    patientBriefing: z.string().max(20000).optional(),
    referenceImageUrl: referenceImageUrlSchema,
    referenceImageCaption: z.string().max(500).nullish(),
    specialty: z.string().max(100).optional(),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    tags: z.array(z.string().max(50)).max(50).optional(),
    customVocabulary: z.array(z.string().max(100)).max(200).optional(),
    // Accepted by the schema so the editor can send it, but the PUT handler
    // always overrides this to `false` — an explicit save is by definition
    // not a draft.
    isDraft: z.boolean().optional(),
    sections: createStationSchema.shape.sections.optional(),
    examinerQuestions: createStationSchema.shape.examinerQuestions.optional(),
  })
  .strict();

// GET /api/stations
router.get("/", requireAuth, async (req, res, next) => {
  try {
    // Best-effort GC of stale auto-saved drafts (>7 days). Don't block the
    // fetch if cleanup fails — drafts will just linger until next attempt.
    storage.cleanupStaleDrafts(req.user!.id).catch((err) => {
      console.error("[stations] cleanupStaleDrafts failed:", err);
    });
    const stationsList = await storage.getStations(req.user!.id);
    return res.json(stationsList);
  } catch (err) {
    next(err);
  }
});

// GET /api/stations/:id
// Visibility-aware:
//   - public  → auth required (library is sign-in-gated); sanitized copy
//   - shared  → auth required; caller must be a collection member that includes this station
//   - private → auth required + ownership
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    // Library is sign-in-gated — require auth before any station fetch.
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const station = await storage.getStation(id);
    if (!station) return res.status(404).json({ message: "Station not found" });

    const visibility = (station as any).visibility ?? "private";

    // Public: fetch via storage.getPublicStation to guarantee we hit the
    // same sanitization path (and include author projection).
    if (visibility === "public") {
      const pub = await storage.getPublicStation(id);
      if (!pub) return res.status(404).json({ message: "Station not found" });
      const sanitized = sanitizePublicStation(pub);
      // Owner gets the full untruncated view.
      if (req.user?.id && station.userId === req.user.id) {
        return res.json(station);
      }
      if (req.user?.id) {
        sanitized.isStarred = await storage.isStationStarredByUser(
          req.user.id,
          id,
        );
      }
      return res.json(sanitized);
    }

    // Admin bypass: moderators need to preview private/removed stations
    // from the reports queue without owning them. This applies to both
    // shared and private visibilities below.
    const isAdmin = !!(req.user as { isAdmin?: boolean } | undefined)?.isAdmin;

    if (visibility === "shared") {
      // Shared stations: any collection the user is a member of that
      // contains this station grants read access. Ownership also passes.
      if (station.userId === req.user!.id || isAdmin) {
        return res.json(station);
      }
      // TODO: once Agent A's collection membership helper lands, tighten
      // this check. For now: allow if user shares any membership with
      // a collection that includes this station.
      const memberCollections = await storage.getUserCollections(req.user!.id);
      let allowed = false;
      for (const c of memberCollections) {
        const coll = await storage.getCollection(c.id);
        if (coll?.stations?.some((s) => s.id === id)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return res.status(403).json({ message: "Forbidden" });
      }
      return res.json(station);
    }

    // Private: ownership only (or admin) — UNLESS this is a group copy
    // (collectionId set), in which case any collection member can read.
    // The fork is "private" in the sense that it's not in the public
    // library; collection members are still its intended audience.
    if (
      !isAdmin &&
      !(await canReadStation(station, req.user!.id))
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json(station);
  } catch (err) {
    next(err);
  }
});

// POST /api/stations
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const parsed = createStationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // Apply smart defaults per station type for any unspecified fields.
    const defaults = getStationTypeDefaults(parsed.data.type);
    const payload = {
      ...parsed.data,
      defaultTimeMinutes:
        parsed.data.defaultTimeMinutes ?? defaults.defaultTimeMinutes,
      patientBriefing:
        parsed.data.patientBriefing ?? defaults.patientBriefing,
      hasPatientBriefing:
        parsed.data.hasPatientBriefing ?? defaults.hasPatientBriefing,
      aiPatientEnabled:
        parsed.data.aiPatientEnabled ?? defaults.aiPatientEnabled,
    };
    const station = await storage.createStation(req.user!.id, payload);
    return res.status(201).json(station);
  } catch (err) {
    next(err);
  }
});

// PUT /api/stations/:id
router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    // Verify write permission (owner of a personal station, OR editor+
    // in the collection that owns a group copy).
    const existing = await storage.getStation(id);
    if (!existing) return res.status(404).json({ message: "Station not found" });
    if (!(await canWriteStation(existing, req.user!.id))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const parsed = updateStationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // Explicit save -> never a draft, regardless of what the client sent.
    const updated = await storage.updateStation(id, {
      ...parsed.data,
      isDraft: false,
    });
    invalidateSimulatorCache(id);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stations/:id
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    const existing = await storage.getStation(id);
    if (!existing) return res.status(404).json({ message: "Station not found" });
    if (!(await canWriteStation(existing, req.user!.id))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await storage.deleteStation(id);
    invalidateSimulatorCache(id);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Publish / unpublish ───────────────────────────────────────

function hasEnoughContent(station: {
  sections: Array<{ items: Array<unknown> }>;
  examinerQuestions: Array<unknown>;
}): boolean {
  const sectionWithItem = station.sections.some(
    (s) => Array.isArray(s.items) && s.items.length > 0,
  );
  const anyQuestion = (station.examinerQuestions?.length ?? 0) > 0;
  return sectionWithItem || anyQuestion;
}

// POST /api/stations/:id/publish
router.post("/:id/publish", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    const existing = await storage.getStation(id);
    if (!existing) return res.status(404).json({ message: "Station not found" });
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!existing.title || existing.title.trim().length === 0) {
      return res.status(422).json({
        message: "Station needs a title before it can be published.",
      });
    }
    if (!hasEnoughContent(existing as any)) {
      return res.status(422).json({
        message:
          "Station needs at least one checklist item or one examiner question before publishing.",
      });
    }

    const updated = await storage.publishStation(id);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stations/:id/publish
router.delete("/:id/publish", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    const existing = await storage.getStation(id);
    if (!existing) return res.status(404).json({ message: "Station not found" });
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const updated = await storage.unpublishStation(id);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── Group copies (pull-back) ──────────────────────────────────

// GET /api/stations/:id/group-copies — list group copies of a personal
// station, with collection metadata. Owner-only — the personal author
// is the only one with a pull-back affordance.
router.get("/:id/group-copies", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    const existing = await storage.getStation(id);
    if (!existing) return res.status(404).json({ message: "Station not found" });
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (existing.collectionId != null) {
      // Group copies don't have their own group copies.
      return res.json({ copies: [] });
    }

    const copies = await storage.listGroupCopiesOfStation(id);
    return res.json({ copies });
  } catch (err) {
    next(err);
  }
});

// POST /api/stations/:id/pull-from-group
// Replace the personal station's contents with a chosen group copy's.
// Body: { groupStationId: number }
// Owner-only on the personal station; v1 is full-replace (no per-item
// cherry-pick). The personal station identity is preserved (id, userId,
// createdAt, forkOf, visibility, counts) — existing sessions still link.
router.post("/:id/pull-from-group", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    const groupStationId = Number(req.body?.groupStationId);
    if (!Number.isInteger(groupStationId)) {
      return res
        .status(400)
        .json({ message: "groupStationId is required" });
    }

    const existing = await storage.getStation(id);
    if (!existing) return res.status(404).json({ message: "Station not found" });
    if (existing.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (existing.collectionId != null) {
      return res
        .status(400)
        .json({ message: "Pull-back only applies to personal stations" });
    }

    const groupCopy = await storage.getStation(groupStationId);
    if (!groupCopy) {
      return res.status(404).json({ message: "Group copy not found" });
    }
    if (groupCopy.collectionId == null) {
      return res
        .status(400)
        .json({ message: "Source is not a group copy" });
    }
    if (groupCopy.forkOf !== id) {
      return res
        .status(400)
        .json({ message: "Group copy is not a fork of this station" });
    }

    const updated = await storage.pullFromGroupCopy(id, groupStationId);
    invalidateSimulatorCache(id);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── Fork ──────────────────────────────────────────────────────

// POST /api/stations/:id/fork
router.post("/:id/fork", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    const source = await storage.getStation(id);
    if (!source) return res.status(404).json({ message: "Station not found" });

    // Cannot fork your own station.
    if (source.userId === req.user!.id) {
      return res.status(422).json({ message: "This is already yours." });
    }

    const visibility = (source as any).visibility ?? "private";
    if (visibility !== "public") {
      // Allow if requester has membership in any collection containing this station.
      const memberCollections = await storage.getUserCollections(req.user!.id);
      let allowed = false;
      for (const c of memberCollections) {
        const coll = await storage.getCollection(c.id);
        if (coll?.stations?.some((s) => s.id === id)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const forked = await storage.forkStation(id, req.user!.id);
    return res.status(201).json({ id: forked.id, station: forked });
  } catch (err) {
    next(err);
  }
});

// ─── Stars ─────────────────────────────────────────────────────

// POST /api/stations/:id/star
router.post("/:id/star", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    const existing = await storage.getStation(id);
    if (!existing) return res.status(404).json({ message: "Station not found" });

    await storage.starStation(req.user!.id, id);
    return res.json({ starred: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stations/:id/star
router.delete("/:id/star", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid station ID" });

    await storage.unstarStation(req.user!.id, id);
    return res.json({ starred: false });
  } catch (err) {
    next(err);
  }
});

// ─── Reports ───────────────────────────────────────────────────
// Mounted here (rather than in library.ts) so the rate limit reuses the
// user-keyed limiter, which requires auth. Path: POST /api/stations/reports
// is awkward — exposed via index.ts at /api/reports instead (see below).

const reportSchema = z
  .object({
    targetType: z.enum(["station", "collection", "user"]),
    targetId: z.number().int().positive(),
    reason: z.string().min(1).max(500),
  })
  .strict();

// Exported so index.ts can mount this directly at /api/reports
// without colliding with the per-station routes above.
export const reportRouter = Router();
reportRouter.post("/", requireAuth, reportLimiter, async (req, res, next) => {
  try {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const report = await storage.createReport({
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      reporterId: req.user!.id,
      reason: parsed.data.reason,
    });
    return res.status(201).json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
