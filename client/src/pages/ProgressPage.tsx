import { useSessions, type SessionListItem } from "@/hooks/use-sessions";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Clock,
  Loader2,
  Calendar,
  AlertTriangle,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { cn, formatTime, scoreRampClasses, hasScore } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

type TimeFilter = "week" | "month" | "all";

function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

interface StationGroup {
  stationId: number;
  stationTitle: string;
  sessions: SessionListItem[];
  bestScore: number;
  lastPracticed: Date;
  trend: "up" | "down" | "stable";
}

export default function ProgressPage() {
  const { data: sessions, isLoading } = useSessions();
  const [, navigate] = useLocation();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [expandedStation, setExpandedStation] = useState<number | null>(null);

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    const completed = sessions.filter((s) => s.endedAt);
    if (timeFilter === "all") return completed;

    const now = new Date();
    const cutoff = new Date();
    if (timeFilter === "week") {
      cutoff.setDate(now.getDate() - 7);
    } else {
      cutoff.setMonth(now.getMonth() - 1);
    }
    return completed.filter((s) => new Date(s.startedAt) >= cutoff);
  }, [sessions, timeFilter]);

  const stationGroups = useMemo(() => {
    const map = new Map<number, StationGroup>();

    for (const session of filteredSessions) {
      const sid = session.stationId;
      if (!map.has(sid)) {
        map.set(sid, {
          stationId: sid,
          stationTitle: session.station?.title ?? `Station #${sid}`,
          sessions: [],
          bestScore: 0,
          lastPracticed: new Date(0),
          trend: "stable",
        });
      }
      map.get(sid)!.sessions.push(session);
    }

    const groups = Array.from(map.values());

    for (const group of groups) {
      // Sort sessions oldest first for trend calculation
      group.sessions.sort(
        (a: SessionListItem, b: SessionListItem) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
      );

      const scored = group.sessions.filter((s: SessionListItem) => hasScore(s));
      group.bestScore =
        scored.length > 0
          ? Math.max(...scored.map((s: SessionListItem) => s.totalScore ?? 0))
          : 0;

      group.lastPracticed = new Date(
        Math.max(
          ...group.sessions.map((s: SessionListItem) =>
            new Date(s.startedAt).getTime()
          )
        )
      );

      // Trend: compare last two scored attempts
      if (scored.length >= 2) {
        const last = scored[scored.length - 1].totalScore ?? 0;
        const prev = scored[scored.length - 2].totalScore ?? 0;
        const diff = last - prev;
        if (diff > 2) group.trend = "up";
        else if (diff < -2) group.trend = "down";
        else group.trend = "stable";
      }

      // Reverse so newest first for display
      group.sessions.reverse();
    }

    // Sort groups by last practiced descending
    return groups.sort(
      (a: StationGroup, b: StationGroup) =>
        b.lastPracticed.getTime() - a.lastPracticed.getTime()
    );
  }, [filteredSessions]);

  const stats = useMemo(() => {
    const total = filteredSessions.length;
    const stationCount = new Set(filteredSessions.map((s) => s.stationId)).size;
    const scored = filteredSessions.filter((s) => hasScore(s));
    const avgScore =
      scored.length > 0
        ? Math.round(
            scored.reduce((acc, s) => acc + (s.totalScore ?? 0), 0) /
              scored.length
          )
        : 0;
    return { total, stationCount, avgScore };
  }, [filteredSessions]);

  const toggleStation = (stationId: number) => {
    setExpandedStation((prev) => (prev === stationId ? null : stationId));
  };

  return (
    <div className="min-h-screen pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      <PageHeader title="Progress" backTo="/home" />
      <div className="mx-auto max-w-2xl px-5 pt-6 space-y-6">

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {!isLoading &&
          (!sessions || sessions.filter((s) => s.endedAt).length === 0) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center py-16 text-center"
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <BarChart3 className="h-8 w-8 text-primary" />
              </div>
              <h2 className="mb-2 text-h2 text-foreground">
                No practice sessions yet
              </h2>
              <p className="mb-6 max-w-xs text-body text-muted-foreground">
                Complete your first practice session to start tracking your
                progress.
              </p>
              <button
                onClick={() => navigate("/my-stations")}
                className="h-12 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-smooth active:scale-[0.98]"
              >
                Go to my stations
              </button>
            </motion.div>
          )}

        {!isLoading &&
          sessions &&
          sessions.filter((s) => s.endedAt).length > 0 && (
            <div className="space-y-6">
              {/* Time filter (segmented control) */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex rounded-full bg-muted p-1"
              >
                {(
                  [
                    ["week", "Week"],
                    ["month", "Month"],
                    ["all", "All"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTimeFilter(key)}
                    className={cn(
                      "flex-1 h-9 rounded-full px-3 text-[13px] font-semibold transition-smooth",
                      timeFilter === key
                        ? "bg-background text-foreground shadow-card"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </motion.div>

              {/* Summary stats */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="text-caption text-muted-foreground tabular-nums"
              >
                <span className="font-semibold text-foreground">
                  {stats.total}
                </span>{" "}
                session{stats.total === 1 ? "" : "s"} ·{" "}
                <span className="font-semibold text-foreground">
                  {stats.stationCount}
                </span>{" "}
                station{stats.stationCount === 1 ? "" : "s"} · avg{" "}
                <span className="font-semibold text-foreground">
                  {stats.avgScore}%
                </span>
              </motion.p>

              {/* Filtered empty state */}
              {stationGroups.length === 0 && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="py-10 text-center text-body text-muted-foreground"
                >
                  No sessions in this time range.
                </motion.p>
              )}

              {/* Station groups */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="space-y-3"
              >
                {stationGroups.map((group) => {
                  const isExpanded = expandedStation === group.stationId;
                  const bestScored = group.bestScore > 0;

                  return (
                    <div key={group.stationId}>
                      <button
                        onClick={() => toggleStation(group.stationId)}
                        className="w-full flex items-center gap-3 rounded-2xl bg-card border border-border/60 shadow-card p-4 text-left transition-smooth active:scale-[0.99] hover:border-border"
                      >
                        {/* Best score pill */}
                        <div
                          className={cn(
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-semibold text-[13px] tabular-nums",
                            bestScored
                              ? scoreRampClasses(group.bestScore)
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {bestScored ? `${Math.round(group.bestScore)}%` : "—"}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
                              {group.stationTitle}
                            </p>
                            {/* Trend indicator */}
                            {group.sessions.length >= 2 && (
                              <>
                                {group.trend === "up" && (
                                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                )}
                                {group.trend === "down" && (
                                  <TrendingDown className="h-3.5 w-3.5 shrink-0 text-brand-accent" />
                                )}
                                {group.trend === "stable" && (
                                  <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                              </>
                            )}
                          </div>
                          <p className="mt-0.5 text-caption text-muted-foreground">
                            {group.sessions.length} attempt
                            {group.sessions.length === 1 ? "" : "s"} ·{" "}
                            {relativeTime(group.lastPracticed)}
                          </p>
                        </div>

                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            isExpanded && "rotate-180"
                          )}
                        />
                      </button>

                      {/* Expanded session rows */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeInOut" }}
                            className="overflow-hidden"
                          >
                            <div className="ml-5 mt-2 space-y-1.5 border-l border-border/60 pl-4 pb-1">
                              {group.sessions.map(
                                (session: SessionListItem, idx: number) => {
                                  const scored = hasScore(session);
                                  const score = session.totalScore ?? 0;

                                  // Score change vs previous attempt (sessions are newest-first)
                                  let scoreChange: number | null = null;
                                  if (
                                    scored &&
                                    idx < group.sessions.length - 1
                                  ) {
                                    const prevSession = group.sessions[idx + 1];
                                    if (hasScore(prevSession)) {
                                      scoreChange =
                                        Math.round(score) -
                                        Math.round(
                                          prevSession.totalScore ?? 0
                                        );
                                    }
                                  }

                                  return (
                                    <button
                                      key={session.id}
                                      onClick={() =>
                                        navigate(
                                          `/session/${session.id}/results`
                                        )
                                      }
                                      className="w-full flex items-center gap-3 rounded-xl bg-card border border-border/60 px-3 py-2.5 text-left transition-smooth hover:border-border"
                                    >
                                      <div
                                        className={cn(
                                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-semibold text-[12px] tabular-nums",
                                          scored
                                            ? scoreRampClasses(score)
                                            : "bg-muted text-muted-foreground"
                                        )}
                                      >
                                        {scored ? `${Math.round(score)}%` : "—"}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 text-caption text-muted-foreground">
                                          <Calendar className="h-3 w-3" />
                                          <span>
                                            {new Date(
                                              session.startedAt
                                            ).toLocaleDateString(undefined, {
                                              month: "short",
                                              day: "numeric",
                                            })}
                                          </span>
                                          <span className="text-border">|</span>
                                          <Clock className="h-3 w-3" />
                                          <span className="tabular-nums">
                                            {formatTime(
                                              session.timeUsedSeconds ?? 0
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                      {scoreChange !== null &&
                                        scoreChange !== 0 && (
                                          <span
                                            className={cn(
                                              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                                              scoreChange > 0
                                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                : "bg-brand-accent/10 text-brand-accent"
                                            )}
                                          >
                                            {scoreChange > 0 ? (
                                              <TrendingUp className="h-3 w-3" />
                                            ) : (
                                              <TrendingDown className="h-3 w-3" />
                                            )}
                                            {scoreChange > 0 ? "+" : ""}
                                            {scoreChange}%
                                          </span>
                                        )}
                                      <Badge
                                        variant="secondary"
                                        className="shrink-0 text-[11px] font-medium"
                                      >
                                        {session.mode === "self_check"
                                          ? "Self-check"
                                          : session.mode?.replace("_", " ")}
                                      </Badge>
                                      {session.criticalItemsMissed && (
                                        <Badge className="shrink-0 bg-brand-accent/10 text-brand-accent text-[11px] gap-1">
                                          <AlertTriangle
                                            className="h-3 w-3"
                                            aria-hidden="true"
                                          />
                                          Critical
                                        </Badge>
                                      )}
                                    </button>
                                  );
                                }
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </motion.div>
            </div>
          )}
      </div>
    </div>
  );
}
