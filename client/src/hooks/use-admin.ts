import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Report } from "@shared/schema";

export interface AdminReport extends Report {
  targetPreview: { title: string | null };
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
