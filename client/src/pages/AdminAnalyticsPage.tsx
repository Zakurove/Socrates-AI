import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminGate } from "@/components/admin/AdminGate";
import { useAdminAnalytics } from "@/hooks/use-admin";
import { cn } from "@/lib/utils";

type Range = 7 | 30 | 90;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function AdminAnalyticsPage() {
  return (
    <AdminGate>
      <AdminAnalyticsInner />
    </AdminGate>
  );
}

function AdminAnalyticsInner() {
  const [, navigate] = useLocation();
  const [range, setRange] = useState<Range>(30);

  useEffect(() => {
    document.title = "Analytics — Admin";
  }, []);

  const { data, isLoading, isError, refetch } = useAdminAnalytics({
    days: range,
  });

  const totals = useMemo(() => {
    if (!data) return null;
    const newUsers = data.daily.reduce((acc, d) => acc + d.newUsers, 0);
    const sessions = data.daily.reduce((acc, d) => acc + d.sessionsStarted, 0);
    const aiSpendUsd = data.daily.reduce((acc, d) => acc + d.aiCostUsd, 0);
    // Per-half delta: compare 2nd half vs 1st half of the window.
    const mid = Math.floor(data.daily.length / 2);
    const halfDelta = (key: "newUsers" | "sessionsStarted" | "aiCostUsd") => {
      const left = data.daily.slice(0, mid).reduce((a, d) => a + d[key], 0);
      const right = data.daily.slice(mid).reduce((a, d) => a + d[key], 0);
      if (left === 0) return right > 0 ? 100 : 0;
      return ((right - left) / left) * 100;
    };
    return {
      newUsers,
      sessions,
      aiSpendUsd,
      newUsersDeltaPct: halfDelta("newUsers"),
      sessionsDeltaPct: halfDelta("sessionsStarted"),
      aiSpendDeltaPct: halfDelta("aiCostUsd"),
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader
        title="Analytics"
        backTo="/admin"
        actions={
          <div className="flex items-center gap-1.5 pr-1 text-caption text-muted-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Admin
          </div>
        }
      />

      <main className="mx-auto max-w-[900px] px-5 pt-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-h1 text-foreground">Analytics</h1>
            <p className="text-body text-muted-foreground">
              {data
                ? `${fmtDate(data.range.startDate)} – ${fmtDate(data.range.endDate)}`
                : "Growth, sessions, AI spend"}
            </p>
          </div>
          <div className="flex gap-1.5">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRange(d)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
                  range === d
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        </header>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data || !totals ? (
          <div className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-5 py-6 text-center">
            <p className="text-body text-foreground">
              Couldn't load analytics.
            </p>
            <Button
              variant="outline"
              className="mt-3 rounded-full"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Sparklines */}
            <section className="mb-8 grid gap-3 sm:grid-cols-3">
              <SparkCard
                label="New users"
                total={totals.newUsers}
                delta={totals.newUsersDeltaPct}
                points={data.daily.map((d) => d.newUsers)}
                rangeLabel={`${fmtDate(data.range.startDate)} – ${fmtDate(data.range.endDate)}`}
              />
              <SparkCard
                label="Sessions"
                total={totals.sessions}
                delta={totals.sessionsDeltaPct}
                points={data.daily.map((d) => d.sessionsStarted)}
                rangeLabel={`${fmtDate(data.range.startDate)} – ${fmtDate(data.range.endDate)}`}
              />
              <SparkCard
                label="AI spend"
                total={totals.aiSpendUsd}
                delta={totals.aiSpendDeltaPct}
                points={data.daily.map((d) => d.aiCostUsd)}
                rangeLabel={`${fmtDate(data.range.startDate)} – ${fmtDate(data.range.endDate)}`}
                isCurrency
              />
            </section>

            {/* Critical fail rate */}
            <section className="mb-8">
              <Card>
                <CardContent className="p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Critical-fail rate
                  </p>
                  <p className="mt-1 text-[32px] font-bold tabular-nums text-foreground">
                    {(data.criticalFailRate.rate * 100).toFixed(1)}%
                  </p>
                  <p className="mt-1 text-caption text-muted-foreground">
                    {data.criticalFailRate.withCriticalMissed.toLocaleString()}{" "}
                    of{" "}
                    {data.criticalFailRate.totalEnded.toLocaleString()} sessions
                    ended with a critical item missed in this range.
                  </p>
                </CardContent>
              </Card>
            </section>

            {/* Top stations */}
            <section className="mb-8 space-y-3">
              <h2 className="text-h2 text-foreground">
                Top stations by practice count
              </h2>
              {data.topStationsByPractice.length === 0 ? (
                <p className="text-caption text-muted-foreground">No data.</p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.topStationsByPractice.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/station/${s.id}`)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <span className="w-6 shrink-0 text-[12px] font-bold tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-foreground">
                            {s.title}
                          </p>
                          <p className="truncate text-caption text-muted-foreground">
                            {s.author.displayName}
                          </p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                          {s.practiceCount.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Top users by sessions */}
            <section className="mb-8 space-y-3">
              <h2 className="text-h2 text-foreground">
                Top users by sessions
              </h2>
              {data.topUsersBySessions.length === 0 ? (
                <p className="text-caption text-muted-foreground">No data.</p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.topUsersBySessions.map((u, i) => (
                      <button
                        key={u.id}
                        onClick={() => navigate(`/admin/users/${u.id}`)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <span className="w-6 shrink-0 text-[12px] font-bold tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-foreground">
                            {u.displayName}
                          </p>
                          <p className="truncate text-caption text-muted-foreground">
                            {u.email}
                          </p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                          {u.sessionCount.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Top users by spend */}
            <section className="space-y-3">
              <h2 className="text-h2 text-foreground">Top users by spend</h2>
              {data.topUsersBySpend.length === 0 ? (
                <p className="text-caption text-muted-foreground">No data.</p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.topUsersBySpend.map((u, i) => (
                      <button
                        key={u.id}
                        onClick={() => navigate(`/admin/users/${u.id}`)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <span className="w-6 shrink-0 text-[12px] font-bold tabular-nums text-muted-foreground">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-foreground">
                            {u.displayName}
                          </p>
                          <p className="truncate text-caption text-muted-foreground">
                            {u.email}
                          </p>
                        </div>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                          ${u.aiSpendUsd.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function SparkCard({
  label,
  total,
  delta,
  points,
  rangeLabel,
  isCurrency,
}: {
  label: string;
  total: number;
  delta: number;
  points: number[];
  rangeLabel: string;
  isCurrency?: boolean;
}) {
  const fmtTotal = isCurrency
    ? `$${total.toFixed(2)}`
    : total.toLocaleString();
  const deltaPositive = delta >= 0;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className="text-[24px] font-bold tabular-nums text-foreground">
            {fmtTotal}
          </p>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
              deltaPositive
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-brand-accent/10 text-brand-accent",
            )}
          >
            {deltaPositive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {deltaPositive ? "+" : ""}
            {delta.toFixed(0)}%
          </span>
        </div>
        <Sparkline points={points} />
        <p className="mt-1 text-[10px] text-muted-foreground">{rangeLabel}</p>
      </CardContent>
    </Card>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const { bars, max } = useMemo(() => {
    const safe = points.length ? points : [0];
    const m = Math.max(...safe, 1);
    return { bars: safe, max: m };
  }, [points]);

  const w = 200;
  const h = 60;
  const n = bars.length;
  const gap = 1;
  const barWidth = Math.max((w - gap * (n - 1)) / Math.max(n, 1), 1);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Trend sparkline"
      className="mt-2 h-[60px] w-full"
    >
      {bars.map((v, i) => {
        const barH = max > 0 ? (v / max) * (h - 2) : 0;
        return (
          <rect
            key={i}
            x={i * (barWidth + gap)}
            y={h - barH}
            width={barWidth}
            height={Math.max(barH, 0.5)}
            rx={1}
            className="fill-primary/80"
          />
        );
      })}
    </svg>
  );
}
