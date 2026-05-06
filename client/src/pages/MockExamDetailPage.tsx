import { useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Play,
  Repeat,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import {
  useMockExam,
  useMockExamAttempts,
  useCreateMockExamAttempt,
  useDeleteMockExam,
  type MockExamAttemptDTO,
} from "@/hooks/use-mock-exams";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function scorePillTint(score: number | null | undefined): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 75)
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "bg-brand-accent/15 text-brand-accent";
  return "bg-muted text-muted-foreground";
}

function modeLabel(m: string | null | undefined): string {
  if (m === "ai_listen") return "AI Listen";
  if (m === "ai_conversation") return "AI Conversation";
  return "Self-check";
}

/**
 * Build the practice URL for a given station based on the mock exam's
 * chosen practice mode. Matches the convention used by the runner and
 * the original inline URL builder.
 */
function practiceUrlFor(
  stationId: number,
  mode: string | null | undefined,
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

export default function MockExamDetailPage() {
  const params = useParams<{ id: string }>();
  const examId = Number(params.id);
  const [, navigate] = useLocation();
  const { data: exam, isLoading } = useMockExam(examId);
  const { data: attempts } = useMockExamAttempts(examId);
  const createAttempt = useCreateMockExamAttempt();
  const deleteExam = useDeleteMockExam();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    try {
      await deleteExam.mutateAsync(examId);
      toast({ title: "Mock exam deleted" });
      navigate("/mock-exam");
    } catch (err) {
      toast({
        title: "Failed to delete",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  const sorted = useMemo<MockExamAttemptDTO[]>(() => {
    if (!attempts) return [];
    return [...attempts].sort((a, b) => b.attemptNumber - a.attemptNumber);
  }, [attempts]);

  const { attemptCount, completedCount, bestScore, averageScore, inProgress } =
    useMemo(() => {
      let best: number | null = null;
      let sum = 0;
      let scored = 0;
      let completed = 0;
      let inFlight: MockExamAttemptDTO | null = null;
      for (const a of attempts ?? []) {
        if (a.completedAt != null) completed += 1;
        else if (!inFlight) inFlight = a;
        if (a.overallScore != null) {
          scored += 1;
          sum += a.overallScore;
          if (best == null || a.overallScore > best) best = a.overallScore;
        }
      }
      return {
        attemptCount: attempts?.length ?? 0,
        completedCount: completed,
        bestScore: best,
        averageScore: scored > 0 ? sum / scored : null,
        inProgress: inFlight,
      };
    }, [attempts]);

  const totalStations = Array.isArray(exam?.stationIds)
    ? (exam!.stationIds as number[]).length
    : 0;

  const totalMinutes = useMemo(() => {
    if (!exam?.stations) return 0;
    return exam.stations.reduce(
      (acc, s) => acc + (s.defaultTimeMinutes ?? 0),
      0
    );
  }, [exam]);

  const handleStartNewAttempt = async () => {
    if (!exam) return;
    try {
      const result = await createAttempt.mutateAsync(examId);
      navigate(
        practiceUrlFor(
          result.currentStationId,
          exam.practiceMode,
          examId,
          result.attempt.id
        )
      );
    } catch (err) {
      toast({
        title: "Failed to start attempt",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  const handleResumeAttempt = (attempt: MockExamAttemptDTO) => {
    if (!exam) return;
    const ids = (exam.stationIds ?? []) as number[];
    const sid = ids[attempt.currentStationIndex];
    if (sid == null) {
      // Nothing to resume — route to the attempt results instead.
      navigate(`/mock-exam/${examId}/results?attemptId=${attempt.id}`);
      return;
    }
    navigate(
      practiceUrlFor(sid, exam.practiceMode, examId, attempt.id)
    );
  };

  if (isLoading || !exam) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-40 bg-background">
      <PageHeader
        title={exam.title}
        backTo="/mock-exam"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-11 w-11 -mr-2 grid place-items-center rounded-full hover:bg-muted transition-smooth"
                aria-label="Mock exam options"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setConfirmDelete(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete mock exam
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this mock exam?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the exam template and all its attempts. Your stations
              and practice sessions remain untouched. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteExam.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteExam.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteExam.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="px-5 pt-6 space-y-8 lg:max-w-2xl lg:mx-auto">
        {/* Hero */}
        <header className="space-y-1">
          <p className="text-label text-muted-foreground uppercase">
            Mock exam
          </p>
          <h1 className="text-h1 text-foreground">{exam.title}</h1>
          <p className="text-body text-muted-foreground">
            {totalStations} station{totalStations === 1 ? "" : "s"} ·{" "}
            {totalMinutes}m · {modeLabel(exam.practiceMode)} ·{" "}
            {exam.restSeconds}s rest
          </p>
        </header>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Best score"
            value={bestScore != null ? `${Math.round(bestScore)}%` : "—"}
          />
          <StatCard
            label="Average"
            value={averageScore != null ? `${Math.round(averageScore)}%` : "—"}
          />
          <StatCard
            label="Attempts"
            value={String(attemptCount)}
            sub={
              completedCount > 0
                ? `${completedCount} completed`
                : undefined
            }
          />
          <StatCard
            label="Last attempted"
            value={
              sorted.length > 0
                ? formatDate(sorted[0].startedAt) || "—"
                : "—"
            }
          />
        </div>

        {/* Stations list */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase">
            Circuit
          </h2>
          <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/40 overflow-hidden shadow-card">
            {exam.stations?.map((s, idx) => (
              <div key={s.id} className="flex items-center gap-3 p-4">
                <div className="h-9 w-9 rounded-full grid place-items-center text-[12px] font-semibold tabular-nums shrink-0 bg-muted text-muted-foreground">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-body font-semibold truncate text-foreground">
                    {s.title}
                  </div>
                  <div className="text-caption text-muted-foreground capitalize">
                    {s.type.replace(/_/g, " ")} · {s.defaultTimeMinutes}m
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* History */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase">
            History
          </h2>
          {sorted.length === 0 ? (
            <p className="text-body text-muted-foreground py-4">
              No attempts yet. Start one to see your history here.
            </p>
          ) : (
            <div className="space-y-2">
              {sorted.map((a) => {
                const score =
                  a.overallScore != null ? Math.round(a.overallScore) : null;
                const completed = a.completedAt != null;
                return (
                  <button
                    key={a.id}
                    onClick={() =>
                      completed
                        ? navigate(
                            `/mock-exam/${examId}/results?attemptId=${a.id}`
                          )
                        : handleResumeAttempt(a)
                    }
                    className="w-full rounded-2xl border border-border/60 bg-card p-4 text-left transition-smooth active:scale-[0.99] hover:bg-muted/40 flex items-center gap-4 shadow-card"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-semibold text-foreground">
                        Attempt #{a.attemptNumber}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            "text-[11px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5",
                            completed
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-brand-accent/15 text-brand-accent"
                          )}
                        >
                          {completed ? "Completed" : "In progress"}
                        </span>
                        <span className="text-caption text-muted-foreground tabular-nums">
                          {formatDate(a.startedAt)}
                        </span>
                      </div>
                    </div>
                    {score != null ? (
                      <span
                        className={cn(
                          "shrink-0 inline-flex items-center justify-center rounded-full px-3 h-9 text-[15px] font-semibold tabular-nums",
                          scorePillTint(score)
                        )}
                      >
                        {score}%
                      </span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-0 inset-x-0 z-20 backdrop-blur-xl bg-background/80 border-t border-border/40 safe-bottom">
        <div className="px-5 py-4 space-y-2">
          {inProgress && (
            <Button
              variant="outline"
              onClick={() => handleResumeAttempt(inProgress)}
              className="w-full rounded-full h-12 text-[15px] font-semibold tracking-tight gap-2"
            >
              <Play className="h-4 w-4" />
              Resume attempt #{inProgress.attemptNumber}
            </Button>
          )}
          <Button
            onClick={handleStartNewAttempt}
            disabled={createAttempt.isPending || totalStations === 0}
            className="w-full rounded-full h-12 text-[17px] font-semibold tracking-tight gap-2"
          >
            {createAttempt.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : attemptCount === 0 ? (
              <Play className="h-4 w-4" />
            ) : (
              <Repeat className="h-4 w-4" />
            )}
            {attemptCount === 0 ? "Start first attempt" : "Start new attempt"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="mt-1 text-h3 tabular-nums text-foreground">{value}</p>
      {sub && (
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {sub}
        </p>
      )}
    </div>
  );
}
