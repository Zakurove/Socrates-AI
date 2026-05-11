import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Session } from "@shared/schema";
import type { ScoringBreakdown } from "@shared/scoring";

export type SessionListItem = Session & {
  station?: { title: string; type: string } | null;
};

export function useSessions(stationId?: number) {
  const queryKey = stationId
    ? `/api/sessions?stationId=${stationId}`
    : "/api/sessions";
  return useQuery<SessionListItem[]>({
    queryKey: [queryKey],
  });
}

export type SessionWithDetails = Session & {
  station: { id: number; title: string; type: string };
  itemResults: Array<{
    id: number;
    itemId: number;
    status: string;
    timestampSeconds: number | null;
    aiStatus: "checked" | "missed" | "partial" | "checked_after_time";
    correctedAt: string | null;
    correctionNote: string | null;
    item: {
      id: number;
      text: string;
      isCritical: boolean;
      sectionId: number;
      parentItemId: number | null;
      section: { title: string };
    };
  }>;
  examinerQuestionResults: Array<{
    id: number;
    questionId: number;
    score: number | null;
    feedback: string | null;
    aiScore: number | null;
    correctedAt: string | null;
    correctionNote: string | null;
    // Per-keyPoint present/missed breakdown for checklist questions.
    // Null for free_text / multiple_choice / multi_select.
    pointResults: Array<{
      point: string;
      status: "present" | "missed";
    }> | null;
    question: {
      question: string;
      idealAnswer: string;
      questionType:
        | "free_text"
        | "multiple_choice"
        | "multi_select"
        | "checklist";
      keyPoints: string[] | null;
    };
  }>;
  /** Server-derived composite scoring (iter10). Always present on reads. */
  scoring?: ScoringBreakdown;
};

export function useSession(id: number | string | undefined) {
  return useQuery<SessionWithDetails>({
    queryKey: [`/api/sessions/${id}`],
    enabled: !!id,
  });
}

/**
 * Delete a session — used to:
 *   - discard an in-progress run (Cancel during practice)
 *   - remove a finalized run from history (Progress / Results pages)
 * Server cascades item_results + examiner_question_results.
 */
export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: number) => {
      await apiRequest("DELETE", `/api/sessions/${sessionId}`);
    },
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0] as string).startsWith("/api/sessions"),
      });
      // Drop the cached single-session query for the deleted id so any
      // stale ResultsPage instance can't render zombie data.
      queryClient.removeQueries({ queryKey: [`/api/sessions/${sessionId}`] });
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      stationId: number;
      mode: string;
      timeLimitSeconds: number;
      mockExamId?: number;
    }) => {
      const res = await apiRequest("POST", "/api/sessions", data);
      return res.json() as Promise<Session>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0] as string).startsWith("/api/sessions"),
      });
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: {
        timeUsedSeconds?: number;
        totalScore?: number;
        criticalItemsMissed?: boolean;
        endedAt?: string;
        transcript?: string;
      };
    }) => {
      const res = await apiRequest("PUT", `/api/sessions/${id}`, data);
      return res.json() as Promise<Session>;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0] as string).startsWith("/api/sessions"),
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/sessions/${variables.id}`],
      });
    },
  });
}

export function useSaveItemResults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      results,
    }: {
      sessionId: number;
      results: Array<{
        itemId: number;
        status: string;
        timestampSeconds?: number;
        matchedTranscript?: string;
      }>;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/sessions/${sessionId}/item-results`,
        results
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/sessions/${variables.sessionId}`],
      });
    },
  });
}

export function useSaveQuestionResults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      results,
    }: {
      sessionId: number;
      results: Array<{
        questionId: number;
        score: number;
        feedback?: string;
        pointResults?: Array<{ point: string; status: "present" | "missed" }>;
      }>;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/sessions/${sessionId}/question-results`,
        results
      );
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/sessions/${variables.sessionId}`],
      });
    },
  });
}

export type UpdateItemResultResponse = {
  itemResult: {
    id: number;
    status: string;
    aiStatus: "checked" | "missed" | "partial" | "checked_after_time";
    correctedAt: string | null;
    correctionNote: string | null;
  };
  sessionTotalScore: number;
};

/**
 * User-correction of a single checklist item. Flips status (checked <-> missed)
 * and the server returns the freshly recomputed session totalScore so the gauge
 * stays in sync after the session query invalidates.
 */
export function useUpdateItemResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      itemResultId,
      status,
      note,
    }: {
      sessionId: number;
      itemResultId: number;
      status: "checked" | "missed";
      note?: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/sessions/${sessionId}/item-results/${itemResultId}`,
        { status, ...(note !== undefined ? { note } : {}) }
      );
      return (await res.json()) as UpdateItemResultResponse;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/sessions/${variables.sessionId}`],
      });
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0] as string).startsWith("/api/sessions"),
      });
    },
  });
}

export type UpdateQuestionResultResponse = {
  questionResult: {
    id: number;
    score: number;
    aiScore: number | null;
    correctedAt: string | null;
    correctionNote: string | null;
  };
  sessionTotalScore: number;
};

/**
 * User-correction of an examiner-question score (0..1). Server validates the
 * range and returns the recomputed session totalScore.
 */
export function useUpdateQuestionResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      questionResultId,
      score,
      note,
      pointResults,
    }: {
      sessionId: number;
      questionResultId: number;
      score: number;
      note?: string;
      pointResults?: Array<{ point: string; status: "present" | "missed" }>;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/sessions/${sessionId}/question-results/${questionResultId}`,
        {
          score,
          ...(note !== undefined ? { note } : {}),
          ...(pointResults !== undefined ? { pointResults } : {}),
        }
      );
      return (await res.json()) as UpdateQuestionResultResponse;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/sessions/${variables.sessionId}`],
      });
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          (q.queryKey[0] as string).startsWith("/api/sessions"),
      });
    },
  });
}
