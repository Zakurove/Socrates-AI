import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface ForkResult {
  id: number;
  [key: string]: unknown;
}

export function useForkStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<ForkResult> => {
      const res = await apiRequest("POST", `/api/stations/${id}/fork`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/stations"] });
    },
  });
}

export function useForkCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<ForkResult> => {
      const res = await apiRequest("POST", `/api/collections/${id}/fork`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/collections"] });
    },
  });
}
