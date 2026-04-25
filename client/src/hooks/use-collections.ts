import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  Collection,
  CollectionRole,
  CollectionWithMembership,
  Visibility,
} from "@shared/schema";
import type { CollectionMemberRow } from "./use-collection-members";

export type { CollectionMemberRow } from "./use-collection-members";

/** Station row as returned by the collection detail endpoint. */
export interface CollectionStationRow {
  id: number;
  title: string;
  type: string;
  specialty?: string | null;
  defaultTimeMinutes?: number;
  /** displayName of the user who added this station to the collection. Optional. */
  addedByName?: string | null;
}

/**
 * The shape returned by `GET /api/collections/:id`. Individual collection
 * endpoints bundle membership metadata + first-party members list.
 */
export type CollectionDetail = Collection & {
  role: CollectionRole;
  memberCount: number;
  stationCount: number;
  members: CollectionMemberRow[];
  stations: CollectionStationRow[];
  visibility: Visibility;
};

/** List endpoint returns the lighter `CollectionWithMembership` summary. */
export function useCollections() {
  return useQuery<CollectionWithMembership[]>({
    queryKey: ["/api/collections"],
  });
}

export function useCollection(id: number | string | undefined) {
  return useQuery<CollectionDetail>({
    queryKey: [`/api/collections/${id}`],
    enabled: !!id,
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      title: string;
      description?: string;
      specialty?: string;
      tags?: string[];
    }) => {
      const res = await apiRequest("POST", "/api/collections", data);
      return res.json() as Promise<Collection>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    },
  });
}

export function useUpdateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: {
        title?: string;
        description?: string;
        specialty?: string;
        tags?: string[];
      };
    }) => {
      const res = await apiRequest("PUT", `/api/collections/${id}`, data);
      return res.json() as Promise<Collection>;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({
        queryKey: [`/api/collections/${variables.id}`],
      });
    },
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/collections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    },
  });
}

export function useAddStationToCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      collectionId,
      stationId,
      order,
    }: {
      collectionId: number;
      stationId: number;
      order?: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/collections/${collectionId}/stations`,
        { stationId, ...(order !== undefined ? { order } : {}) }
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/collections/${variables.collectionId}`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    },
  });
}

export function useRemoveStationFromCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      collectionId,
      stationId,
    }: {
      collectionId: number;
      stationId: number;
    }) => {
      await apiRequest(
        "DELETE",
        `/api/collections/${collectionId}/stations/${stationId}`
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/collections/${variables.collectionId}`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    },
  });
}
