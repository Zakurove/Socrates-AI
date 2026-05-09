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
    question: { question: string; idealAnswer: string };
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
