import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { storage } from "../storage.js";
import type { CollectionRole } from "../../shared/schema.js";
import { sendCollectionInviteEmail } from "../services/email.js";

const router = Router();
router.use(requireAuth);

const ROLE_RANK: Record<CollectionRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

/**
 * Checks that `userId` has at least `minRole` in `collectionId`. If not, writes
 * the appropriate 403/404 response and returns null. Otherwise returns the
 * member's role.
 */
async function assertCollectionRole(
  res: Response,
  collectionId: number,
  userId: number,
  minRole: CollectionRole,
): Promise<CollectionRole | null> {
  const membership = await storage.getCollectionMembership(
    collectionId,
    userId,
  );
  if (!membership) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }
  return membership.role;
}

const createCollectionSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  specialty: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(50).default([]),
});

const updateCollectionSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).optional(),
    specialty: z.string().max(100).optional(),
    tags: z.array(z.string().max(50)).max(50).optional(),
  })
  .strict();

const addStationToCollectionSchema = z
  .object({
    stationId: z.number().int().positive(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict();

const roleSchema = z.enum(["viewer", "editor", "owner"]);
const inviteRoleSchema = z.enum(["viewer", "editor"]);

const createInviteSchema = z
  .object({
    email: z.string().email().max(255),
    role: inviteRoleSchema,
  })
  .strict();

const updateMemberSchema = z
  .object({
    role: roleSchema,
  })
  .strict();

function parseId(
  req: Request,
  res: Response,
  key: string,
): number | null {
  const n = parseInt(req.params[key], 10);
  if (isNaN(n) || n <= 0) {
    res.status(400).json({ message: `Invalid ${key}` });
    return null;
  }
  return n;
}

// ─── Collections CRUD ─────────────────────────────────────────────

// GET /api/collections — all collections the user is a member of (any role)
router.get("/", async (req, res, next) => {
  try {
    const list = await storage.getUserCollections(req.user!.id);
    return res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /api/collections/:id — viewer+
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const collection = await storage.getCollection(id);
    if (!collection) return res.status(404).json({ message: "Collection not found" });

    // Admin bypass: moderators need to preview private/shared/removed
    // collections from the reports queue without being a member.
    const isAdmin = !!(req.user as { isAdmin?: boolean } | undefined)?.isAdmin;
    let role: CollectionRole;
    if (isAdmin) {
      const membership = await storage.getCollectionMembership(
        id,
        req.user!.id,
      );
      role = membership?.role ?? "viewer";
    } else {
      const checked = await assertCollectionRole(
        res,
        id,
        req.user!.id,
        "viewer",
      );
      if (checked == null) return;
      role = checked;
    }

    const members = await storage.listCollectionMembers(id);

    return res.json({
      ...collection,
      role,
      memberCount: members.length,
      stationCount: collection.stations.length,
      members,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections — creator becomes owner
router.post("/", async (req, res, next) => {
  try {
    const parsed = createCollectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const collection = await storage.createCollection({
      userId: req.user!.id,
      ...parsed.data,
    });

    // Ensure owner membership row exists. `addCollectionMember` upserts,
    // so it's safe even if foundation-storage adds one on createCollection.
    try {
      await storage.addCollectionMember(
        collection.id,
        req.user!.id,
        "owner",
      );
    } catch (err) {
      // If storage refused (e.g. already exists with different role), continue.
      console.warn(
        `[collections] failed to seed owner membership for collection ${collection.id}`,
        err,
      );
    }

    return res.status(201).json(collection);
  } catch (err) {
    next(err);
  }
});

// PUT /api/collections/:id — editor+
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(
      res,
      id,
      req.user!.id,
      "editor",
    );
    if (role == null) return;

    const parsed = updateCollectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const updated = await storage.updateCollection(id, parsed.data);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id — owner only
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "owner");
    if (role == null) return;

    await storage.deleteCollection(id);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Stations in collections ──────────────────────────────────────

// POST /api/collections/:id/stations — editor+
router.post("/:id/stations", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "editor");
    if (role == null) return;

    const parsed = addStationToCollectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const { stationId, order } = parsed.data;

    // Caller must own the source station (we're going to fork their copy
    // into a group-owned working copy — their personal version stays
    // untouched in My Stations).
    const station = await storage.getStation(stationId);
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }
    if (station.userId !== req.user!.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    // Don't double-fork: if they're trying to share a station that's
    // already a group copy (e.g. dragging between collections), reject.
    if (station.collectionId != null) {
      return res.status(400).json({
        message:
          "This station is already a group copy. Share the original from My Stations instead.",
      });
    }

    // Fork the station into a group-owned copy and link THAT to the
    // collection. The personal station is never modified.
    const groupCopy = await storage.forkStation(stationId, req.user!.id, {
      collectionId: id,
    });
    await storage.addStationToCollection(id, groupCopy.id, order);
    return res.status(201).json({
      message: "Station shared to collection",
      groupStationId: groupCopy.id,
      sourceStationId: stationId,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id/stations/:stationId — editor+
router.delete("/:id/stations/:stationId", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;
    const stationId = parseId(req, res, "stationId");
    if (stationId == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "editor");
    if (role == null) return;

    // For group copies, removal from the collection deletes the copy
    // itself (it has no purpose outside the group). For legacy/personal
    // stations that were directly linked (pre-fork-on-share), we just
    // unlink the join row and leave the station alone.
    const station = await storage.getStation(stationId);
    if (station?.collectionId === id) {
      await storage.deleteStation(stationId);
    } else {
      await storage.removeStationFromCollection(id, stationId);
    }
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Members ──────────────────────────────────────────────────────

// GET /api/collections/:id/members — any member
router.get("/:id/members", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "viewer");
    if (role == null) return;

    const members = await storage.listCollectionMembers(id);
    return res.json(
      members.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        email: m.email,
        role: m.role,
        joinedAt: m.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/collections/:id/members/:userId — owner only
router.patch("/:id/members/:userId", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;
    const targetUserId = parseId(req, res, "userId");
    if (targetUserId == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "owner");
    if (role == null) return;

    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const newRole = parsed.data.role;

    // Disallow promoting to owner via this endpoint (only one owner; transfer later).
    if (newRole === "owner") {
      return res.status(400).json({
        message: "Ownership transfer is not supported yet.",
      });
    }

    const target = await storage.getCollectionMembership(id, targetUserId);
    if (!target) {
      return res.status(404).json({ message: "Member not found" });
    }

    // Guard against demoting the only owner (newRole is viewer|editor here).
    if (target.role === "owner") {
      const members = await storage.listCollectionMembers(id);
      const ownerCount = members.filter((m) => m.role === "owner").length;
      if (ownerCount <= 1) {
        return res
          .status(400)
          .json({ message: "Cannot demote the only owner" });
      }
    }

    const updated = await storage.updateMemberRole(id, targetUserId, newRole);
    if (!updated) {
      return res.status(404).json({ message: "Member not found" });
    }
    return res.json({
      userId: updated.userId,
      role: updated.role,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id/members/:userId — owner removes anyone,
// or user removes themselves. Owner cannot remove self unless they transfer first.
router.delete("/:id/members/:userId", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;
    const targetUserId = parseId(req, res, "userId");
    if (targetUserId == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const actorMembership = await storage.getCollectionMembership(
      id,
      req.user!.id,
    );
    if (!actorMembership) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const target = await storage.getCollectionMembership(id, targetUserId);
    if (!target) {
      return res.status(404).json({ message: "Member not found" });
    }

    const isSelf = req.user!.id === targetUserId;

    if (!isSelf && actorMembership.role !== "owner") {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Owner trying to remove self: block unless another owner exists.
    if (isSelf && actorMembership.role === "owner") {
      return res.status(400).json({
        message:
          "Transfer ownership before leaving, or delete the collection.",
      });
    }

    // If actor is owner removing another member, block removing the only owner
    // (shouldn't happen since another member isn't the owner unless multi-owner,
    // but guard anyway).
    if (!isSelf && target.role === "owner") {
      const members = await storage.listCollectionMembers(id);
      const ownerCount = members.filter((m) => m.role === "owner").length;
      if (ownerCount <= 1) {
        return res
          .status(400)
          .json({ message: "Cannot remove the only owner" });
      }
    }

    await storage.removeCollectionMember(id, targetUserId);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Invites ──────────────────────────────────────────────────────

// POST /api/collections/:id/invites — owner only
router.post("/:id/invites", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "owner");
    if (role == null) return;

    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: parsed.error.flatten().fieldErrors,
      });
    }
    const email = parsed.data.email.toLowerCase();
    const inviteRole = parsed.data.role;

    // Guard: self-invite. Owners inviting themselves would either create
    // a duplicate member row or be silently rejected — return a clear
    // 400 so the client can surface an inline error.
    if (
      req.user!.email &&
      email === req.user!.email.toLowerCase()
    ) {
      return res.status(400).json({
        message: "You're already the owner — no need to invite yourself.",
      });
    }

    // Is this email already an active member?
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      const membership = await storage.getCollectionMembership(
        id,
        existingUser.id,
      );
      if (membership) {
        return res.status(409).json({
          message: "This user is already a member.",
        });
      }
    }

    // Refresh existing pending invite (update token + expiry) rather than duplicate.
    const pendingInvites = await storage.getInvitesForCollection(id);
    const existingInvite = pendingInvites.find(
      (inv) => inv.email.toLowerCase() === email,
    );

    let invite;
    if (existingInvite) {
      // Cancel the old one and create a new one (fresh token + expiry).
      await storage.cancelInvite(existingInvite.id);
      invite = await storage.createInvite({
        collectionId: id,
        email,
        role: inviteRole,
        invitedBy: req.user!.id,
      });
    } else {
      invite = await storage.createInvite({
        collectionId: id,
        email,
        role: inviteRole,
        invitedBy: req.user!.id,
      });
    }

    const inviterName = req.user!.displayName ?? "A colleague";
    const sendResult = await sendCollectionInviteEmail({
      to: email,
      inviterName,
      collectionTitle: existing.title,
      role: inviteRole,
      token: invite.token,
    });

    return res.status(201).json({
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
      sent: sendResult.sent,
      inviteUrl: sendResult.inviteUrl,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/collections/:id/invites — owner only; pending invites (not accepted, not expired)
router.get("/:id/invites", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "owner");
    if (role == null) return;

    const now = Date.now();
    const invites = await storage.getInvitesForCollection(id);
    const pending = invites.filter(
      (inv) =>
        !inv.acceptedAt &&
        (!inv.expiresAt || inv.expiresAt.getTime() > now),
    );

    return res.json(
      pending.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id/invites/:inviteId — owner only; cancel invite
router.delete("/:id/invites/:inviteId", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;
    const inviteId = parseId(req, res, "inviteId");
    if (inviteId == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "owner");
    if (role == null) return;

    // Guard: ensure invite belongs to this collection.
    const invites = await storage.getInvitesForCollection(id);
    const target = invites.find((inv) => inv.id === inviteId);
    if (!target) {
      return res.status(404).json({ message: "Invite not found" });
    }

    await storage.cancelInvite(inviteId);
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Publish / unpublish / fork / star ─────────────────────────
// Appended by library-backend agent (Agent B). Uses the existing
// `assertCollectionRole` / `parseId` helpers landed by Agent A.

// POST /api/collections/:id/publish — owner only
router.post("/:id/publish", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "owner");
    if (role == null) return;

    if (!existing.stations || existing.stations.length === 0) {
      return res.status(422).json({
        message: "Add at least one station before publishing.",
      });
    }

    const updated = await storage.publishCollection(id);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id/publish — owner only
router.delete("/:id/publish", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    const role = await assertCollectionRole(res, id, req.user!.id, "owner");
    if (role == null) return;

    const updated = await storage.unpublishCollection(id);
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/collections/:id/fork — any signed-in user;
// source must be public OR caller must have membership.
router.post("/:id/fork", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const source = await storage.getCollection(id);
    if (!source) return res.status(404).json({ message: "Collection not found" });

    if (source.userId === req.user!.id) {
      return res.status(422).json({ message: "This is already yours." });
    }

    const visibility = (source as any).visibility ?? "private";
    if (visibility !== "public") {
      const membership = await storage.getCollectionMembership(id, req.user!.id);
      if (!membership) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const forked = await storage.forkCollection(id, req.user!.id);
    return res.status(201).json({ id: forked.id, collection: forked });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections/:id/star — any signed-in user
router.post("/:id/star", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    const existing = await storage.getCollection(id);
    if (!existing) return res.status(404).json({ message: "Collection not found" });

    await storage.starCollection(req.user!.id, id);
    return res.json({ starred: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/collections/:id/star — any signed-in user
router.delete("/:id/star", async (req, res, next) => {
  try {
    const id = parseId(req, res, "id");
    if (id == null) return;

    await storage.unstarCollection(req.user!.id, id);
    return res.json({ starred: false });
  } catch (err) {
    next(err);
  }
});

export default router;
