import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

function invalidateStationCaches(queryClient: ReturnType<typeof useQueryClient>, id: number) {
  queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
  queryClient.invalidateQueries({ queryKey: [`/api/stations/${id}`] });
  queryClient.invalidateQueries({ queryKey: [`/api/library/stations/${id}`] });
  queryClient.invalidateQueries({ queryKey: ["/api/library/stations"] });
  queryClient.invalidateQueries({ queryKey: ["/api/library/featured"] });
}

function invalidateCollectionCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
) {
  queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
  queryClient.invalidateQueries({ queryKey: [`/api/collections/${id}`] });
  queryClient.invalidateQueries({
    queryKey: [`/api/library/collections/${id}`],
  });
  queryClient.invalidateQueries({ queryKey: ["/api/library/collections"] });
}

export function usePublishStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/stations/${id}/publish`);
      return res.json();
    },
    onSuccess: (_data, id) => invalidateStationCaches(queryClient, id),
  });
}

export function useUnpublishStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/stations/${id}/publish`);
      return res.json();
    },
    onSuccess: (_data, id) => invalidateStationCaches(queryClient, id),
  });
}

export function usePublishCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/collections/${id}/publish`);
      return res.json();
    },
    onSuccess: (_data, id) => invalidateCollectionCaches(queryClient, id),
  });
}

export function useUnpublishCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/collections/${id}/publish`);
      return res.json();
    },
    onSuccess: (_data, id) => invalidateCollectionCaches(queryClient, id),
  });
}
