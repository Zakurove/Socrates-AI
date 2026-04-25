import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { storage } from "../storage.js";

const router = Router();

// GET /api/invites/:token — public, no auth.
// Returns minimal invite info so the accept page can render a preview.
router.get("/:token", async (req, res, next) => {
  try {
    const token = req.params.token;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Invalid token" });
    }

    const invite = await storage.getInviteByToken(token);
    if (!invite) {
      return res.status(404).json({ message: "Invite not found" });
    }
    if (invite.acceptedAt) {
      return res
        .status(409)
        .json({ message: "This invite has already been accepted." });
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: "Invite expired." });
    }

    // Look up inviter display name.
    const inviter = await storage.getUser(invite.invitedBy);
    const inviterName = inviter?.displayName ?? "A colleague";

    return res.json({
      id: invite.id,
      collectionId: invite.collectionId,
      collectionTitle: invite.collection.title,
      inviterName,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/invites/:token/accept — requires auth. Email must match.
router.post("/:token/accept", requireAuth, async (req, res, next) => {
  try {
    const token = req.params.token;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Invalid token" });
    }

    const invite = await storage.getInviteByToken(token);
    if (!invite) {
      return res.status(404).json({ message: "Invite not found" });
    }
    if (invite.acceptedAt) {
      // Idempotency: if current user is already a member, still return success.
      const membership = await storage.getCollectionMembership(
        invite.collectionId,
        req.user!.id,
      );
      if (membership) {
        return res.json({ collectionId: invite.collectionId });
      }
      return res
        .status(409)
        .json({ message: "This invite has already been accepted." });
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: "Invite expired." });
    }

    // Case-insensitive email match.
    if (
      req.user!.email.toLowerCase() !== invite.email.toLowerCase()
    ) {
      return res.status(403).json({
        message:
          "This invite was sent to a different email. Sign in with that email to accept.",
      });
    }

    // If already a member (perhaps via a previous accept), make the call idempotent.
    const existing = await storage.getCollectionMembership(
      invite.collectionId,
      req.user!.id,
    );
    if (existing) {
      // Still mark the invite accepted for cleanliness.
      await storage.acceptInvite(token, req.user!.id);
      return res.json({ collectionId: invite.collectionId });
    }

    const result = await storage.acceptInvite(token, req.user!.id);
    if (!result) {
      return res
        .status(410)
        .json({ message: "Invite could not be accepted." });
    }

    console.log(
      `[invites] accepted collectionId=${invite.collectionId} userId=${req.user!.id}`,
    );

    return res.json({ collectionId: invite.collectionId });
  } catch (err) {
    next(err);
  }
});

export default router;
