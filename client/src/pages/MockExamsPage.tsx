import { useLocation } from "wouter";
import { Loader2, Plus, ChevronRight } from "lucide-react";
import { useMockExams } from "@/hooks/use-mock-exams";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function scoreText(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-brand-accent";
  return "text-muted-foreground";
}

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

export default function MockExamsPage() {
  const [, navigate] = useLocation();
  const { data, isLoading } = useMockExams();

  const isEmpty = !isLoading && (!data || data.length === 0);

  return (
    <div className="min-h-screen pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      <div className="safe-top" />
      <div className="mx-auto max-w-3xl px-5 pt-6 space-y-6">
        <div>
          <h1 className="text-h1 text-foreground">Mock exams</h1>
          <p className="mt-1 text-caption text-muted-foreground">
            Timed multi-station circuits.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center text-center pt-12 px-4">
            <div className="h-14 w-14 rounded-full bg-muted/60 grid place-items-center mb-4">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-h2 text-foreground">No mock exams yet</h2>
            <p className="mt-2 text-body text-muted-foreground max-w-xs">
              Build a circuit of your stations and test yourself under real
              conditions.
            </p>
            <Button
              onClick={() => navigate("/mock-exam/new")}
              className="mt-6 rounded-full h-12 px-6 text-[17px] font-semibold tracking-tight gap-2"
            >
              <Plus className="h-4 w-4" />
              New mock exam
            </Button>
          </div>
        ) : (
          <>
            <Button
              onClick={() => navigate("/mock-exam/new")}
              className="w-full rounded-full h-12 text-[17px] font-semibold tracking-tight gap-2"
            >
              <Plus className="h-4 w-4" />
              New mock exam
            </Button>

            <div className="space-y-3">
              {data!.map((m) => {
                const count = Array.isArray(m.stationIds)
                  ? (m.stationIds as number[]).length
                  : 0;
                const best =
                  m.stats.bestScore != null
                    ? Math.round(m.stats.bestScore)
                    : null;
                const dateStr =
                  formatDate(m.stats.lastAttemptedAt) ||
                  formatDate(m.createdAt);
                const attemptCount = m.stats.attemptCount;

                return (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/mock-exams/${m.id}`)}
                    className="w-full rounded-2xl border border-border/60 bg-card p-5 text-left transition-smooth active:scale-[0.99] hover:bg-muted/40 flex items-center gap-4 shadow-card"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-semibold text-foreground truncate">
                        {m.title}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <span className="text-caption text-muted-foreground tabular-nums">
                          {count} station{count === 1 ? "" : "s"}
                          {attemptCount > 0 && (
                            <>
                              {" · "}
                              {attemptCount} attempt
                              {attemptCount === 1 ? "" : "s"}
                            </>
                          )}
                          {dateStr && (
                            <>
                              {" · "}
                              {dateStr}
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                    {best != null ? (
                      <div
                        className={cn(
                          "text-h2 tabular-nums shrink-0",
                          scoreText(best)
                        )}
                      >
                        {best}
                        <span className="text-caption text-muted-foreground ml-0.5">
                          %
                        </span>
                      </div>
                    ) : null}
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
