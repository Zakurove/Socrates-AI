import type { Express } from "express";
import authRoutes, { publicUsersRouter } from "./auth.js";
import stationsRoutes, { reportRouter } from "./stations.js";
import collectionsRoutes from "./collections.js";
import sessionsRoutes from "./sessions.js";
import aiRoutes from "./ai.js";
import uploadsRoutes from "./uploads.js";
import practiceRoutes from "./practice.js";
import mockExamsRoutes from "./mockExams.js";
import geminiRoutes from "./gemini.js";
import statsRoutes from "./stats.js";
import invitesRoutes from "./invites.js";
import libraryRoutes from "./library.js";
import adminRoutes from "./admin.js";

export function registerRoutes(app: Express): void {
  // Auth routes (no requireAuth — handled internally)
  app.use("/api/auth", authRoutes);

  // Public user profile (no auth gate — community author page).
  app.use("/api/users", publicUsersRouter);

  // Invites: mixed auth (GET /:token is public, POST /:token/accept requires auth).
  // Mounted at root since the routes are /api/invites/:token, not nested.
  app.use("/api/invites", invitesRoutes);

  // Protected resource routes (requireAuth applied at router level).
  // NOTE: stations router applies requireAuth per-endpoint (not globally)
  // to allow GET /:id on public stations.
  app.use("/api/stations", stationsRoutes);
  app.use("/api/collections", collectionsRoutes);
  app.use("/api/sessions", sessionsRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/uploads", uploadsRoutes);
  app.use("/api/practice", practiceRoutes);
  app.use("/api/mock-exams", mockExamsRoutes);
  app.use("/api/gemini", geminiRoutes);
  app.use("/api/stats", statsRoutes);

  // Community library — public browse + detail (rate-limited).
  app.use("/api/library", libraryRoutes);

  // Report submissions (authenticated, rate-limited 10/day/user).
  app.use("/api/reports", reportRouter);

  // Admin moderation queue (requireAuth + requireAdmin).
  app.use("/api/admin", adminRoutes);
}
