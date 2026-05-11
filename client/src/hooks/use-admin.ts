import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Report } from "@shared/schema";

export interface AdminReport extends Report {
  targetPreview: { title: string | null };
}

/**
 * Aggregated correction telemetry for the matcher-feedback dashboard.
 * Items the user most often flips on, with side-by-side AI-vs-user counts.
 */
export interface AdminCorrectionsSummary {
  topCorrected: Array<{
    itemId: number;
    itemText: string;
    sectionTitle: string;
    parentText: string | null;
    stationId: number;
    stationTitle: string;
    timesCorrected: number;
    userSaysChecked: number;
    userSaysMissed: number;
    aiSaidChecked: number;
    aiSaidMissed: number;
  }>;
  topQuestionCorrections: Array<{
    questionId: number;
    questionText: string;
    stationId: number;
    stationTitle: string;
    timesCorrected: number;
    avgUserScore: number;
    avgAiScore: number;
  }>;
  totals: {
    totalCorrections: number;
    itemFalsePositives: number;
    itemFalseNegatives: number;
    recentEvents: Array<{
      id: number;
      occurredAt: string;
      target: "item" | "question";
      ai: string;
      userView: string;
    }>;
  };
}

export function useAdminCorrections() {
  return useQuery<AdminCorrectionsSummary>({
    queryKey: ["/api/admin/corrections"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/corrections`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}

export function useAdminReports(status: "open" | "reviewed_ok" | "removed" = "open") {
  return useQuery<AdminReport[]>({
    queryKey: ["/api/admin/reports", status],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports?status=${status}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}

export function useResolveReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      notes,
    }: {
      id: number;
      status: "reviewed_ok" | "removed";
      notes?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/reports/${id}`, {
        status,
        ...(notes ? { notes } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/stations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/collections"] });
    },
  });
}

export function useAdminUnpublishStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/stations/${id}/unpublish`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/stations"] });
    },
  });
}

export function useAdminUnpublishCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/collections/${id}/unpublish`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/library/collections"] });
    },
  });
}

// ---------- Admin dashboard types ----------

export interface AdminOverview {
  totalUsers: number;
  totalStations: number;
  publicStations: number;
  totalCollections: number;
  publicCollections?: number;
  totalSessions?: number;
  sessionsToday: number;
  // Server emits `aiCostUsdToday`; accept the documented `aiSpendTodayUsd` too.
  aiCostUsdToday?: number;
  aiSpendTodayUsd?: number;
  aiCostUsdMonth?: number;
  openReports?: number;
}

export interface AdminUserRow {
  id: number;
  email: string;
  displayName: string;
  isAdmin: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
  sessionCount: number;
  stationCount: number;
  aiSpendUsd: number;
}

export interface AdminUsersResponse {
  items: AdminUserRow[];
  total: number;
}

export interface AdminUserDetail {
  user: {
    id: number;
    email: string;
    displayName: string;
    bio: string | null;
    isAdmin: boolean;
    emailVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  counts: {
    sessions: number;
    stations: number;
    publicStations: number;
    collections: number;
    publicCollections: number;
    aiSpendUsdTotal: number;
    aiSpendUsd30d: number;
  };
  recentSessions: Array<{
    id: number;
    stationId: number | null;
    stationTitle: string | null;
    mode: string;
    totalScore: number | null;
    startedAt: string;
    endedAt: string | null;
  }>;
  stations: Array<{
    id: number;
    title: string;
    type: string;
    visibility: "private" | "shared" | "public";
    createdAt: string;
    starCount: number;
    forkCount: number;
    practiceCount: number;
  }>;
}

export interface AdminStationRow {
  id: number;
  title: string;
  type: string;
  visibility: "private" | "shared" | "public";
  createdAt: string;
  updatedAt: string;
  author: { id: number; displayName: string };
  starCount: number;
  forkCount: number;
  practiceCount: number;
  isCritical: boolean;
  reportCount: number;
}

export interface AdminStationsResponse {
  items: AdminStationRow[];
  total: number;
}

export interface AdminCollectionRow {
  id: number;
  title: string;
  visibility: "private" | "shared" | "public";
  createdAt: string;
  updatedAt: string;
  author: { id: number; displayName: string };
  starCount: number;
  forkCount: number;
  reportCount: number;
  stationCount?: number;
}

export interface AdminCollectionsResponse {
  items: AdminCollectionRow[];
  total: number;
}

export interface AdminAnalytics {
  range: { days: number; startDate: string; endDate: string };
  daily: Array<{
    date: string;
    newUsers: number;
    sessionsStarted: number;
    aiCostUsd: number;
  }>;
  topStationsByPractice: Array<{
    id: number;
    title: string;
    author: { id: number; displayName: string };
    practiceCount: number;
    starCount: number;
    forkCount: number;
  }>;
  topUsersBySessions: Array<{
    id: number;
    email: string;
    displayName: string;
    sessionCount: number;
    aiSpendUsd: number;
  }>;
  topUsersBySpend: Array<{
    id: number;
    email: string;
    displayName: string;
    sessionCount: number;
    aiSpendUsd: number;
  }>;
  criticalFailRate: {
    withCriticalMissed: number;
    totalEnded: number;
    rate: number;
  };
}

// ---------- Admin dashboard queries / mutations ----------

export function useAdminOverview() {
  return useQuery<AdminOverview>({
    queryKey: ["/api/admin/overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/overview", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}

export function useAdminUsers(params: {
  q?: string;
  offset?: number;
  limit?: number;
}) {
  const { q = "", offset = 0, limit = 50 } = params;
  return useQuery<AdminUsersResponse>({
    queryKey: ["/api/admin/users", { q, offset, limit }],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      sp.set("offset", String(offset));
      sp.set("limit", String(limit));
      const res = await fetch(`/api/admin/users?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}

export function useAdminUser(id: number | null) {
  return useQuery<AdminUserDetail>({
    queryKey: ["/api/admin/users", id],
    enabled: id !== null && Number.isFinite(id),
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}

export function useAdminPatchUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: number;
      body: { isAdmin?: boolean; emailVerifiedAt?: string | null };
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, body);
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", variables.id],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overview"] });
    },
  });
}

export function useAdminDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${id}`);
      // 204 has no body; tolerate either.
      try {
        return await res.json();
      } catch {
        return { ok: true };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overview"] });
    },
  });
}

export function useAdminStations(params: {
  visibility?: "private" | "shared" | "public" | "all";
  type?: string;
  authorId?: number;
  q?: string;
  offset?: number;
  limit?: number;
}) {
  const {
    visibility = "all",
    type,
    authorId,
    q = "",
    offset = 0,
    limit = 50,
  } = params;
  return useQuery<AdminStationsResponse>({
    queryKey: [
      "/api/admin/stations",
      { visibility, type, authorId, q, offset, limit },
    ],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (visibility && visibility !== "all") sp.set("visibility", visibility);
      if (type) sp.set("type", type);
      if (authorId) sp.set("authorId", String(authorId));
      if (q) sp.set("q", q);
      sp.set("offset", String(offset));
      sp.set("limit", String(limit));
      const res = await fetch(`/api/admin/stations?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}

export function useAdminPatchStationVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      visibility,
    }: {
      id: number;
      visibility: "private" | "shared" | "public";
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/stations/${id}/visibility`,
        { visibility },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/stations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overview"] });
    },
  });
}

export function useAdminCollections(params: {
  visibility?: "private" | "shared" | "public" | "all";
  q?: string;
  offset?: number;
  limit?: number;
}) {
  const { visibility = "all", q = "", offset = 0, limit = 50 } = params;
  return useQuery<AdminCollectionsResponse>({
    queryKey: ["/api/admin/collections", { visibility, q, offset, limit }],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (visibility && visibility !== "all") sp.set("visibility", visibility);
      if (q) sp.set("q", q);
      sp.set("offset", String(offset));
      sp.set("limit", String(limit));
      const res = await fetch(`/api/admin/collections?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}

export function useAdminPatchCollectionVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      visibility,
    }: {
      id: number;
      visibility: "private" | "shared" | "public";
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/collections/${id}/visibility`,
        { visibility },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/library/collections"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overview"] });
    },
  });
}

export function useAdminAnalytics(params: { days?: number }) {
  const { days = 30 } = params;
  return useQuery<AdminAnalytics>({
    queryKey: ["/api/admin/analytics", { days }],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics?days=${days}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: admin fetch failed`);
      return res.json();
    },
  });
}
