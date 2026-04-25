import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface SubmitReportPayload {
  targetType: "station" | "collection" | "user";
  targetId: number;
  reason: string;
}

export function useSubmitReport() {
  return useMutation({
    mutationFn: async (payload: SubmitReportPayload) => {
      const res = await apiRequest("POST", `/api/reports`, payload);
      return res.json();
    },
  });
}
