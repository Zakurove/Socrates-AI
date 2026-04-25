import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { storage } from "../storage.js";
import { forceUnpublishTarget } from "../services/moderation.js";

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

export default router;
