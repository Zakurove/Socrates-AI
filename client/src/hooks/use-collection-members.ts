import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { CollectionRole } from "@shared/schema";

/**
 * Member row returned by `GET /api/collections/:id/members`.
 * The server flattens user + membership into one shape.
 */
export interface CollectionMemberRow {
  userId: number;
  displayName: string;
  email: string;
  role: CollectionRole;
  joinedAt: string;
}

export function useMembers(collectionId: number | string | undefined) {
  return useQuery<CollectionMemberRow[]>({
    queryKey: ["/api/collections", collectionId, "members"],
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/members`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`${res.status}: failed to load members`);
      }
      return res.json();
    },
    enabled: !!collectionId,
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      collectionId,
      userId,
      role,
    }: {
      collectionId: number;
      userId: number;
      role: CollectionRole;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/collections/${collectionId}/members/${userId}`,
        { role }
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collections", variables.collectionId, "members"],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/collections/${variables.collectionId}`],
      });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      collectionId,
      userId,
    }: {
      collectionId: number;
      userId: number;
    }) => {
      await apiRequest(
        "DELETE",
        `/api/collections/${collectionId}/members/${userId}`
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collections", variables.collectionId, "members"],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/collections/${variables.collectionId}`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    },
  });
}
