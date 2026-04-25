import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { CollectionRole } from "@shared/schema";

export interface PendingInviteRow {
  id: number;
  email: string;
  role: CollectionRole;
  expiresAt: string;
  createdAt: string;
}

export interface CreateInviteResult {
  invite: {
    id: number;
    email: string;
    role: CollectionRole;
    expiresAt: string;
  };
  sent: boolean;
  inviteUrl: string;
}

export interface InvitePreview {
  id: number;
  collectionId: number;
  collectionTitle: string;
  inviterName: string;
  email: string;
  role: CollectionRole;
  expiresAt: string;
}

/** Pending invites for a collection (owner only on the server side). */
export function useInvites(collectionId: number | string | undefined) {
  return useQuery<PendingInviteRow[]>({
    queryKey: ["/api/collections", collectionId, "invites"],
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/invites`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: failed to load invites`);
      return res.json();
    },
    enabled: !!collectionId,
  });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      collectionId,
      email,
      role,
    }: {
      collectionId: number;
      email: string;
      role: Extract<CollectionRole, "viewer" | "editor">;
    }): Promise<CreateInviteResult> => {
      const res = await apiRequest(
        "POST",
        `/api/collections/${collectionId}/invites`,
        { email, role }
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collections", variables.collectionId, "invites"],
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/collections/${variables.collectionId}`],
      });
    },
  });
}

export function useCancelInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      collectionId,
      inviteId,
    }: {
      collectionId: number;
      inviteId: number;
    }) => {
      await apiRequest(
        "DELETE",
        `/api/collections/${collectionId}/invites/${inviteId}`
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/collections", variables.collectionId, "invites"],
      });
    },
  });
}

/**
 * Preview an invite by token. Public endpoint — works without auth.
 * `retry: false` because 404/410/409 are deterministic.
 */
export function useInvite(token: string | undefined) {
  return useQuery<InvitePreview, Error>({
    queryKey: ["/api/invites", token],
    queryFn: async () => {
      const res = await fetch(`/api/invites/${token}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body || res.statusText}`);
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
    }: {
      token: string;
    }): Promise<{ collectionId: number }> => {
      const res = await apiRequest("POST", `/api/invites/${token}/accept`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
    },
  });
}
