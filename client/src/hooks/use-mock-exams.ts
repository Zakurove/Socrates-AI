import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  MockExam,
  MockExamAttempt,
  MockExamPracticeMode,
  Station,
} from "@shared/schema";
import type { ScoringBreakdown } from "@shared/scoring";

// ─── Template list / stats ──────────────────────────────────────────────

/** Aggregate stats attached to each row in `GET /api/mock-exams`. */
export type MockExamStats = {
  attemptCount: number;
  completedCount: number;
  bestScore: number | null;
  averageScore: number | null;
  lastAttemptedAt: string | null;
};

export type MockExamListItem = MockExam & { stats: MockExamStats };

export function useMockExams() {
  return useQuery<MockExamListItem[]>({ queryKey: ["/api/mock-exams"] });
}

// ─── Template detail ────────────────────────────────────────────────────

/**
 * Template view — name, stations, mode, pacing. Runtime fields (status,
 * currentStationIndex, startedAt, completedAt) are deprecated on the DB
 * row and intentionally not surfaced here; per-run state lives on
 * `MockExamAttemptDTO` instead.
 */
export type MockExamDetail = MockExam & {
  stations: Station[];
};

export function useMockExam(id: number | string | undefined) {
  return useQuery<MockExamDetail>({
    queryKey: [`/api/mock-exams/${id}`],
    enabled: !!id,
  });
}

// ─── Attempts ───────────────────────────────────────────────────────────

export type MockExamAttemptDTO = Omit<
  MockExamAttempt,
  "startedAt" | "completedAt"
> & {
  startedAt: string;
  completedAt: string | null;
};

/** List attempts (newest first) for history/stats. */
export function useMockExamAttempts(examId: number | string | undefined) {
  return useQuery<MockExamAttemptDTO[]>({
    queryKey: [`/api/mock-exams/${examId}/attempts`],
    enabled: !!examId,
  });
}

/** Per-attempt composite results with scoring breakdown per station. */
export type MockExamAttemptResults = {
  mockExam: MockExam;
  attempt: MockExamAttemptDTO;
  perStation: Array<{
    stationIndex: number;
    stationId: number;
    title: string;
    score: number | null;
    scoring: ScoringBreakdown | null;
    timeUsedSeconds: number | null;
    criticalItemsMissed: boolean;
    sessionId: number | null;
  }>;
  overallScore: number | null;
  totalTimeSeconds: number;
  criticalMissedCount: number;
};

export function useMockExamAttempt(
  examId: number | string | undefined,
  attemptId: number | string | undefined,
) {
  return useQuery<MockExamAttemptResults>({
    queryKey: [`/api/mock-exams/${examId}/attempts/${attemptId}`],
    enabled: !!examId && !!attemptId,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0] as string).startsWith("/api/mock-exams"),
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────

export function useCreateMockExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      title: string;
      stationIds: number[];
      restSeconds?: number;
      practiceMode?: MockExamPracticeMode;
    }) => {
      const res = await apiRequest("POST", "/api/mock-exams", data);
      return res.json() as Promise<MockExam>;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateMockExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: number;
      title?: string;
      stationIds?: number[];
      restSeconds?: number;
      practiceMode?: MockExamPracticeMode;
    }) => {
      const res = await apiRequest("PATCH", `/api/mock-exams/${id}`, patch);
      return res.json() as Promise<MockExam>;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteMockExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/mock-exams/${id}`);
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export type CreateAttemptResult = {
  attempt: MockExamAttemptDTO;
  currentStationId: number;
  stationIndex: number;
  totalStations: number;
};

/**
 * Start a new attempt of a mock exam template. Returns the attempt plus
 * the first station the runner should route to.
 */
export function useCreateMockExamAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (examId: number): Promise<CreateAttemptResult> => {
      const res = await apiRequest(
        "POST",
        `/api/mock-exams/${examId}/attempts`,
        {},
      );
      return res.json() as Promise<CreateAttemptResult>;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export type AdvanceAttemptResult = {
  done: boolean;
  attempt: MockExamAttemptDTO;
  currentStationId?: number;
  stationIndex?: number;
  totalStations?: number;
};

export type AdvanceAttemptConflict = {
  conflict: true;
  code: "stale_from_index" | "not_in_progress";
  currentStationIndex?: number;
  currentStationId?: number;
  totalStations?: number;
  message?: string;
};

/**
 * Advance an attempt. Caller MUST pass the index it believes it's finishing
 * — server validates and returns 409 on mismatch so we reconcile instead
 * of skipping or double-advancing. Mirrors the iter9 invalidation pattern
 * on the old advance endpoint.
 */
export function useAdvanceMockExamAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      examId,
      attemptId,
      fromIndex,
    }: {
      examId: number;
      attemptId: number;
      fromIndex: number;
    }): Promise<AdvanceAttemptResult | AdvanceAttemptConflict> => {
      const res = await fetch(
        `/api/mock-exams/${examId}/attempts/${attemptId}/advance`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromIndex }),
        },
      );
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as Partial<
          AdvanceAttemptConflict
        >;
        return {
          conflict: true,
          code:
            (body.code as AdvanceAttemptConflict["code"]) ??
            "stale_from_index",
          currentStationIndex: body.currentStationIndex,
          currentStationId: body.currentStationId,
          totalStations: body.totalStations,
          message: body.message,
        };
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      return (await res.json()) as AdvanceAttemptResult;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Mark an attempt as done (no more stations). */
export function useAbortMockExamAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      examId,
      attemptId,
    }: {
      examId: number;
      attemptId: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/mock-exams/${examId}/attempts/${attemptId}/abort`,
        {},
      );
      return res.json() as Promise<MockExamAttemptDTO>;
    },
    onSuccess: () => invalidateAll(qc),
  });
}
