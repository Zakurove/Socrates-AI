import { useQuery } from "@tanstack/react-query";
import type {
  PublicStationSummary,
  PublicCollectionSummary,
} from "@shared/schema";

// ─── Types ─────────────────────────────────────────────────────

export type StationSort = "recent" | "popular" | "forks" | "practices";
export type CollectionSort = "recent" | "popular" | "forks";

export interface StationFilters {
  q?: string;
  type?: string;
  specialty?: string;
  difficulty?: string;
  sort?: StationSort;
  page?: number;
  pageSize?: number;
}

export interface CollectionFilters {
  q?: string;
  specialty?: string;
  sort?: CollectionSort;
  page?: number;
  pageSize?: number;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublicStationDetail extends PublicStationSummary {
  scenario: string | null;
  patientBriefing: string | null;
  hasPatientBriefing: boolean;
  defaultTimeMinutes: number;
  referenceImageUrl: string | null;
  referenceImageCaption: string | null;
  sections: Array<{
    id: number;
    title: string;
    description: string | null;
    order: number;
    imageUrl: string | null;
    imageCaption: string | null;
    items: Array<any>;
  }>;
  examinerQuestions: Array<{
    id: number;
    question: string;
    idealAnswer: string;
    keyPoints: string[] | null;
    order: number;
  }>;
  forkOf: number | null;
}

export interface PublicCollectionDetail {
  id: number;
  title: string;
  description: string | null;
  specialty: string | null;
  tags: string[];
  starCount: number;
  forkCount: number;
  publishedAt: string;
  author: { id: number; displayName: string };
  isStarred?: boolean;
  stations: PublicStationSummary[];
}

// ─── Helpers ──────────────────────────────────────────────────

function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// ─── Queries ──────────────────────────────────────────────────

export function useLibraryStations(filters: StationFilters = {}) {
  const qs = buildQuery(filters as Record<string, unknown>);
  return useQuery<Paginated<PublicStationSummary>>({
    queryKey: ["/api/library/stations", filters],
    queryFn: async () => {
      const res = await fetch(`/api/library/stations${qs}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: library fetch failed`);
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

export function useLibraryCollections(filters: CollectionFilters = {}) {
  const qs = buildQuery(filters as Record<string, unknown>);
  return useQuery<Paginated<PublicCollectionSummary>>({
    queryKey: ["/api/library/collections", filters],
    queryFn: async () => {
      const res = await fetch(`/api/library/collections${qs}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: collections fetch failed`);
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

export function useFeaturedLibrary() {
  return useQuery<{ items: PublicStationSummary[] }>({
    queryKey: ["/api/library/featured"],
    queryFn: async () => {
      const res = await fetch(`/api/library/featured`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: featured fetch failed`);
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

export function usePublicStation(id: number | string | undefined) {
  return useQuery<PublicStationDetail>({
    queryKey: [`/api/library/stations/${id}`],
    queryFn: async () => {
      const res = await fetch(`/api/library/stations/${id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body || "not found"}`);
      }
      return res.json();
    },
    enabled: !!id,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function usePublicCollection(id: number | string | undefined) {
  return useQuery<PublicCollectionDetail>({
    queryKey: [`/api/library/collections/${id}`],
    queryFn: async () => {
      const res = await fetch(`/api/library/collections/${id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body || "not found"}`);
      }
      return res.json();
    },
    enabled: !!id,
    staleTime: 60 * 1000,
    retry: false,
  });
}
