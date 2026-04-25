import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Optimistic update helper — we bump starCount and toggle isStarred on the
// cached detail record and any list entries we can find.
function toggleStarOptimistic(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: "station" | "collection",
  id: number,
  starred: boolean,
) {
  const detailKey =
    kind === "station"
      ? `/api/library/stations/${id}`
      : `/api/library/collections/${id}`;
  queryClient.setQueryData([detailKey], (prev: any) => {
    if (!prev) return prev;
    const delta = starred ? 1 : -1;
    const starCount = Math.max(0, (prev.starCount ?? 0) + delta);
    return { ...prev, starCount, isStarred: starred };
  });

  // Best-effort patch of lists (featured, paged). Iterate active queries.
  const listPrefix =
    kind === "station" ? ["/api/library/stations"] : ["/api/library/collections"];
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: listPrefix });
  for (const q of queries) {
    queryClient.setQueryData(q.queryKey, (prev: any) => {
      if (!prev || !Array.isArray(prev.items)) return prev;
      const items = prev.items.map((it: any) => {
        if (it.id !== id) return it;
        const delta = starred ? 1 : -1;
        return {
          ...it,
          starCount: Math.max(0, (it.starCount ?? 0) + delta),
          isStarred: starred,
        };
      });
      return { ...prev, items };
    });
  }

  // Featured is shaped differently: { items: [...] } with no total.
  queryClient.setQueryData(["/api/library/featured"], (prev: any) => {
    if (!prev || !Array.isArray(prev.items)) return prev;
    const items = prev.items.map((it: any) => {
      if (it.id !== id) return it;
      const delta = starred ? 1 : -1;
      return {
        ...it,
        starCount: Math.max(0, (it.starCount ?? 0) + delta),
        isStarred: starred,
      };
    });
    return { ...prev, items };
  });
}

export function useStarStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/stations/${id}/star`);
    },
    onMutate: async (id) => {
      toggleStarOptimistic(queryClient, "station", id, true);
    },
    onError: (_err, id) => {
      toggleStarOptimistic(queryClient, "station", id, false);
    },
  });
}

export function useUnstarStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/stations/${id}/star`);
    },
    onMutate: async (id) => {
      toggleStarOptimistic(queryClient, "station", id, false);
    },
    onError: (_err, id) => {
      toggleStarOptimistic(queryClient, "station", id, true);
    },
  });
}

export function useStarCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/collections/${id}/star`);
    },
    onMutate: async (id) => {
      toggleStarOptimistic(queryClient, "collection", id, true);
    },
    onError: (_err, id) => {
      toggleStarOptimistic(queryClient, "collection", id, false);
    },
  });
}

export function useUnstarCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/collections/${id}/star`);
    },
    onMutate: async (id) => {
      toggleStarOptimistic(queryClient, "collection", id, false);
    },
    onError: (_err, id) => {
      toggleStarOptimistic(queryClient, "collection", id, true);
    },
  });
}
