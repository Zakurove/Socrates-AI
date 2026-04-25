import { useQuery } from "@tanstack/react-query";
import type { AuthorProfile } from "@shared/schema";

export function useAuthorProfile(id: number | string | undefined) {
  return useQuery<AuthorProfile>({
    queryKey: [`/api/users/${id}`],
    queryFn: async () => {
      const res = await fetch(`/api/users/${id}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body || "not found"}`);
      }
      return res.json();
    },
    enabled: !!id,
    retry: false,
    staleTime: 60 * 1000,
  });
}
