import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Station, StationWithDetails, CreateStationPayload } from "@shared/schema";

export function useStations() {
  return useQuery<Station[]>({
    queryKey: ["/api/stations"],
  });
}

export function useStation(id: number | string | undefined) {
  return useQuery<StationWithDetails>({
    queryKey: [`/api/stations/${id}`],
    enabled: !!id,
  });
}

export function useCreateStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateStationPayload) => {
      const res = await apiRequest("POST", "/api/stations", data);
      return res.json() as Promise<StationWithDetails>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
    },
  });
}

export function useUpdateStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: CreateStationPayload;
    }) => {
      const res = await apiRequest("PUT", `/api/stations/${id}`, data);
      return res.json() as Promise<StationWithDetails>;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      queryClient.invalidateQueries({
        queryKey: [`/api/stations/${variables.id}`],
      });
    },
  });
}

export function useDeleteStation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/stations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
    },
  });
}
