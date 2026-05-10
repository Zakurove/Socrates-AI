import { useLocation } from "wouter";
import { Loader2, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminCorrections } from "@/hooks/use-admin";
import { cn } from "@/lib/utils";

/**
 * Admin-only dashboard surfacing the user-correction telemetry from
 * `correction_events`. Tells us which checklist items the matcher is
 * getting wrong most often and which examiner-Q scores users disagree
 * with — exactly what to feed back into prompt / training improvements.
 */
export default function AdminCorrectionsPage() {
  const [, navigate] = useLocation();
  const { data, isLoading, isError, refetch } = useAdminCorrections();

  return (
    <div className="min-h-screen bg-background pb-10">
      <PageHeader title="Grading corrections" backTo="/admin/reports" />

      <div className="mx-auto max-w-3xl lg:max-w-5xl px-5 pt-6 space-y-8">
        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 text-center">
            <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-destructive" />
            <p className="text-body text-foreground">
              Couldn't load corrections.
            </p>
            <button
              onClick={() => refetch()}
              className="mt-3 text-caption font-semibold text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {data && (
          <>
            {/* Totals strip */}
            <section className="grid grid-cols-3 gap-3">
              <StatCard
                label="Total corrections"
                value={data.totals.totalCorrections}
              />
              <StatCard
                label="AI false-positives"
                sub="AI=checked → user=missed"
                value={data.totals.itemFalsePositives}
                accent="warning"
              />
              <StatCard
                label="AI false-negatives"
                sub="AI=missed → user=checked"
                value={data.totals.itemFalseNegatives}
                accent="warning"
              />
            </section>

            {/* Top items */}
            <section className="space-y-3">
              <h2 className="text-h2 text-foreground">
                Items most often corrected
              </h2>
              {data.topCorrected.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  No corrections yet.
                </p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.topCorrected.map((row) => (
                      <button
                        key={row.itemId}
                        onClick={() => navigate(`/station/${row.stationId}`)}
                        className="block w-full px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-body font-medium text-foreground">
                              {row.parentText
                                ? `${row.parentText} → ${row.itemText}`
                                : row.itemText}
                            </p>
                            <p className="mt-0.5 text-caption text-muted-foreground">
                              {row.stationTitle} · {row.sectionTitle}
                            </p>
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <span className="text-[15px] font-semibold tabular-nums text-foreground">
                              {row.timesCorrected}
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                              flips
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] tabular-nums">
                          <Chip
                            icon={<TrendingDown className="h-3 w-3" />}
                            label="AI → missed"
                            value={row.aiSaidMissed}
                            tone="warning"
                          />
                          <Chip
                            icon={<TrendingUp className="h-3 w-3" />}
                            label="AI → checked"
                            value={row.aiSaidChecked}
                            tone="success"
                          />
                          <Chip
                            label="User → missed"
                            value={row.userSaysMissed}
                            tone="muted"
                          />
                          <Chip
                            label="User → checked"
                            value={row.userSaysChecked}
                            tone="muted"
                          />
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Top examiner-question corrections */}
            {data.topQuestionCorrections.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-h2 text-foreground">
                  Examiner Q&A score disagreements
                </h2>
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.topQuestionCorrections.map((row) => {
                      const userPct = Math.round(row.avgUserScore * 100);
                      const aiPct = Math.round(row.avgAiScore * 100);
                      const delta = userPct - aiPct;
                      return (
                        <button
                          key={row.questionId}
                          onClick={() =>
                            navigate(`/station/${row.stationId}`)
                          }
                          className="block w-full px-4 py-3 text-left transition-colors hover:bg-muted/40"
                        >
                          <p className="line-clamp-2 text-body font-medium text-foreground">
                            {row.questionText}
                          </p>
                          <p className="mt-0.5 text-caption text-muted-foreground">
                            {row.stationTitle}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                            <span>
                              {row.timesCorrected} flip
                              {row.timesCorrected === 1 ? "" : "s"}
                            </span>
                            <span>·</span>
                            <span>AI avg {aiPct}%</span>
                            <span>·</span>
                            <span>User avg {userPct}%</span>
                            <span
                              className={cn(
                                "ml-auto inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold",
                                delta > 0
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : delta < 0
                                    ? "bg-brand-accent/10 text-brand-accent"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {delta > 0 ? "+" : ""}
                              {delta}%
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Recent activity */}
            {data.totals.recentEvents.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-h2 text-foreground">Recent activity</h2>
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.totals.recentEvents.map((ev) => (
                      <div key={ev.id} className="px-4 py-2.5 text-[13px]">
                        <span className="text-muted-foreground">
                          {new Date(ev.occurredAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-foreground capitalize">
                          {ev.target}
                        </span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="font-medium text-foreground">
                          AI {ev.ai}
                        </span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium text-primary">
                          user {ev.userView}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  sub,
  value,
  accent,
}: {
  label: string;
  sub?: string;
  value: number;
  accent?: "warning";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 text-[28px] font-bold tabular-nums text-foreground",
            accent === "warning" && "text-brand-accent",
          )}
        >
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Chip({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  tone: "success" | "warning" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
        tone === "success" &&
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "warning" && "bg-brand-accent/10 text-brand-accent",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {icon}
      <span>
        {label}: {value}
      </span>
    </span>
  );
}
