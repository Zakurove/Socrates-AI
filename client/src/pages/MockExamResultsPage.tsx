import { useMemo } from "react";
import { useLocation, useParams } from "wouter";
import {
  Loader2,
  Home,
  Target,
  AlertTriangle,
  ChevronRight,
  Repeat,
} from "lucide-react";
import {
  useMockExamAttempt,
  useMockExamAttempts,
  useCreateMockExamAttempt,
  useMockExam,
} from "@/hooks/use-mock-exams";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { MockExamPracticeMode } from "@shared/schema";

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

function scoreTextColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-brand-accent";
  return "text-muted-foreground";
}

function scoreStrokeColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-500 dark:text-emerald-400";
  if (score >= 60) return "text-brand-accent";
  return "text-muted-foreground";
}

function scorePillTint(score: number | null | undefined): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 75)
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "bg-brand-accent/15 text-brand-accent";
  return "bg-muted text-muted-foreground";
}

function practiceUrlFor(
  stationId: number,
  mode: MockExamPracticeMode | null | undefined,
  examId: number,
  attemptId: number
): string {
  const qs = `?mockExamId=${examId}&mockExamAttemptId=${attemptId}`;
  switch (mode) {
    case "ai_listen":
      return `/station/${stationId}/ai-practice${qs}&mode=listen`;
    case "ai_conversation":
      return `/station/${stationId}/ai-practice${qs}&mode=conversation`;
    case "self_check":
    default:
      return `/station/${stationId}/practice${qs}`;
  }
}

function useQueryString() {
  const [loc] = useLocation();
  return useMemo(() => {
    const q = typeof window !== "undefined" ? window.location.search : "";
    return new URLSearchParams(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc]);
}

export default function MockExamResultsPage() {
  const params = useParams<{ id: string }>();
  const examId = Number(params.id);
  const qs = useQueryString();
  const attemptIdParam = qs.get("attemptId");
  const explicitAttemptId = attemptIdParam ? Number(attemptIdParam) : undefined;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // When the URL doesn't carry an attemptId (legacy deeplink), resolve the
  // latest completed attempt so we show something meaningful rather than a
  // blank error.
  const { data: attemptsList } = useMockExamAttempts(examId);
  const resolvedAttemptId = useMemo<number | undefined>(() => {
    if (explicitAttemptId != null) return explicitAttemptId;
    if (!attemptsList || attemptsList.length === 0) return undefined;
    const completed = [...attemptsList]
      .filter((a) => a.completedAt != null)
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    if (completed) return completed.id;
    return [...attemptsList].sort(
      (a, b) => b.attemptNumber - a.attemptNumber
    )[0]?.id;
  }, [explicitAttemptId, attemptsList]);

  const { data, isLoading } = useMockExamAttempt(examId, resolvedAttemptId);
  const { data: examTemplate } = useMockExam(examId);
  const createAttempt = useCreateMockExamAttempt();

  const weakest = useMemo(() => {
    if (!data) return null;
    const scored = data.perStation.filter((p) => p.score != null);
    if (scored.length === 0) return null;
    return scored.reduce((a, b) =>
      (a.score ?? 100) <= (b.score ?? 100) ? a : b
    );
  }, [data]);

  const handleTryAgain = async () => {
    if (!examTemplate) return;
    try {
      const result = await createAttempt.mutateAsync(examId);
      navigate(
        practiceUrlFor(
          result.currentStationId,
          examTemplate.practiceMode,
          examId,
          result.attempt.id
        )
      );
    } catch (err) {
      toast({
        title: "Failed to start new attempt",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const overall =
    data.overallScore != null ? Math.round(data.overallScore) : null;

  // SVG gauge
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash =
    overall != null
      ? (Math.max(0, Math.min(100, overall)) / 100) * circumference
      : 0;

  return (
    <div className="min-h-screen pb-40 bg-background">
      <PageHeader
        title={`Attempt #${data.attempt.attemptNumber}`}
        backTo={`/mock-exams/${examId}`}
      />

      <div className="mx-auto max-w-2xl px-5 pt-6 space-y-8">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
          className="space-y-4"
        >
          <div>
            <p className="text-label text-brand-accent uppercase">
              Mock exam {data.attempt.completedAt ? "complete" : "in progress"}
            </p>
            <h1 className="mt-1 text-h1 text-foreground">
              {data.mockExam.title}
            </h1>
          </div>

          <div className="rounded-3xl bg-card border border-border/60 p-6 shadow-card">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <svg
                  className="h-32 w-32 -rotate-90"
                  viewBox="0 0 120 120"
                  aria-hidden
                >
                  <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-muted/40"
                  />
                  {overall != null && (
                    <motion.circle
                      cx="60"
                      cy="60"
                      r={radius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                      className={scoreStrokeColor(overall)}
                      initial={{ strokeDasharray: `0 ${circumference}` }}
                      animate={{
                        strokeDasharray: `${dash} ${circumference}`,
                      }}
                      transition={{
                        duration: 0.6,
                        ease: [0.32, 0.72, 0, 1],
                      }}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className={cn(
                      "text-[40px] font-bold tabular-nums leading-none tracking-tight",
                      scoreTextColor(overall)
                    )}
                  >
                    {overall != null ? overall : "—"}
                  </span>
                  {overall != null && (
                    <span className="mt-0.5 text-caption text-muted-foreground">
                      %
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-4 text-caption text-muted-foreground">
                Overall score
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-card border border-border/60 p-4">
              <p className="text-caption text-muted-foreground">Total time</p>
              <p className="mt-1 text-h3 tabular-nums text-foreground">
                {formatDuration(data.totalTimeSeconds)}
              </p>
            </div>
            <div className="rounded-2xl bg-card border border-border/60 p-4">
              <p className="text-caption text-muted-foreground">
                Critical missed
              </p>
              <p className="mt-1 text-h3 tabular-nums text-foreground flex items-center gap-1.5">
                {data.criticalMissedCount > 0 && (
                  <AlertTriangle className="h-4 w-4 text-brand-accent" />
                )}
                {data.criticalMissedCount}
              </p>
            </div>
          </div>
        </motion.section>

        {/* Per station — Agent B's scoring display block. */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.24,
            delay: 0.05,
            ease: [0.32, 0.72, 0, 1],
          }}
          className="space-y-3"
        >
          <h2 className="text-h2 text-foreground">Per station</h2>
          <div className="space-y-2">
            {data.perStation.map((p) => {
              const score = p.score != null ? Math.round(p.score) : null;
              const clickable = !!p.sessionId;
              const sc = p.scoring;
              // Show a "C 86% · E 60%" sub-line when both parts exist, so
              // the aggregate composite is legible at a glance. Checklist-
              // only or examiner-only stations keep the single-number look.
              const showBreakdown =
                sc != null && sc.hasChecklist && sc.hasExaminer;
              return (
                <button
                  key={p.stationId}
                  onClick={() =>
                    p.sessionId && navigate(`/session/${p.sessionId}/results`)
                  }
                  disabled={!clickable}
                  className={cn(
                    "w-full rounded-2xl border border-border/60 bg-card p-4 text-left flex items-center gap-4 transition-smooth shadow-card",
                    clickable
                      ? "hover:bg-muted/40 active:scale-[0.99]"
                      : "opacity-60 cursor-default"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-semibold text-foreground truncate flex items-center gap-1.5">
                      {p.title}
                      {p.criticalItemsMissed && (
                        <AlertTriangle className="h-3.5 w-3.5 text-brand-accent shrink-0" />
                      )}
                    </div>
                    <p className="mt-0.5 text-caption text-muted-foreground tabular-nums">
                      Station {p.stationIndex + 1}
                      {p.timeUsedSeconds != null && (
                        <> · {formatDuration(p.timeUsedSeconds)}</>
                      )}
                    </p>
                    {showBreakdown && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                        Checklist {Math.round(sc!.checklistScore)}%
                        {" · "}
                        Examiner {Math.round(sc!.examinerScore)}%
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 inline-flex items-center justify-center rounded-full px-3 h-9 text-[15px] font-semibold tabular-nums",
                      scorePillTint(score)
                    )}
                  >
                    {score != null ? `${score}%` : "—"}
                  </span>
                  {clickable && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </motion.section>

        {/* Actions */}
        <div className="pt-2 space-y-3">
          <Button
            onClick={handleTryAgain}
            disabled={createAttempt.isPending || !examTemplate}
            className="w-full rounded-full h-12 text-[17px] font-semibold tracking-tight gap-2"
          >
            {createAttempt.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Repeat className="h-4 w-4" />
            )}
            Try this exam again
          </Button>
          {weakest && (
            <Button
              variant="outline"
              onClick={() =>
                navigate(`/station/${weakest.stationId}/practice`)
              }
              className="w-full rounded-full h-12 text-[15px] font-semibold tracking-tight gap-2"
            >
              <Target className="h-4 w-4" />
              Practice weakest station
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => navigate("/home")}
            className="w-full rounded-full h-12 text-[15px] font-medium gap-2 text-muted-foreground hover:text-foreground"
          >
            <Home className="h-4 w-4" />
            Back to home
          </Button>
        </div>
      </div>
    </div>
  );
}
