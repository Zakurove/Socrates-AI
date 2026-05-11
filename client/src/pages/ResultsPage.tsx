import { useParams, useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import {
  useSession,
  useDeleteSession,
  useUpdateItemResult,
  useUpdateQuestionResult,
} from "@/hooks/use-sessions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/ui/use-toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  Clock,
  Loader2,
  X,
  AlertTriangle,
  Trash2,
  Info,
  Pencil,
  Undo2,
} from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import { motion } from "framer-motion";

type ItemAiStatus = "checked" | "missed" | "partial" | "checked_after_time";

function prettyAiStatus(s: ItemAiStatus | string): string {
  if (s === "checked") return "checked";
  if (s === "missed") return "missed";
  if (s === "partial") return "partial";
  if (s === "checked_after_time") return "checked after time";
  return String(s);
}

const CORRECTED_BADGE_CLASS =
  "inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-[0.16em] text-primary leading-none";

function scoreRampText(score: number): string {
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-brand-accent";
  return "text-muted-foreground";
}

function scoreRampStroke(score: number): string {
  if (score >= 75) return "text-emerald-500 dark:text-emerald-400";
  if (score >= 60) return "text-brand-accent";
  return "text-muted-foreground";
}

function formatFraction(n: number): string {
  // Examiner earned is a sum of per-question 0..1 scores, so it can be 1.5.
  // Show 1 decimal only when the value is non-integer.
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function ScoreRow({
  label,
  earned,
  total,
  pct,
  weightPct,
}: {
  label: string;
  earned: number;
  total: number;
  pct: number;
  weightPct: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-body text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">
          Weight {weightPct}%
        </p>
      </div>
      <div className="text-right">
        <p className="text-body font-medium tabular-nums text-foreground">
          {formatFraction(earned)}/{total}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {Math.round(pct)}%
        </p>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data: session, isLoading, error } = useSession(params.id);
  const deleteSession = useDeleteSession();
  const updateItemResult = useUpdateItemResult();
  const updateQuestionResult = useUpdateQuestionResult();
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // Stable reference for syncing pending state below.
  const itemResultsRef = useRef(session?.itemResults);
  itemResultsRef.current = session?.itemResults;
  const questionResultsRef = useRef(session?.examinerQuestionResults);
  questionResultsRef.current = session?.examinerQuestionResults;
  // Tracks which question row has its score-picker open.
  const [openScorePickerFor, setOpenScorePickerFor] = useState<number | null>(
    null
  );
  // Optimistic local override: itemResult.id → status. Cleared whenever the
  // server-side value (via session refetch) catches up.
  const [pendingItemStatus, setPendingItemStatus] = useState<
    Record<number, "checked" | "missed">
  >({});
  // Same for question results: questionResult.id → score (0..1).
  const [pendingQuestionScore, setPendingQuestionScore] = useState<
    Record<number, number>
  >({});
  // Optimistic override for checklist per-item breakdown:
  // questionResult.id → [{point, status}]. Cleared when the server row catches up.
  const [pendingPointResults, setPendingPointResults] = useState<
    Record<number, Array<{ point: string; status: "present" | "missed" }>>
  >({});

  // Drop optimistic overrides once the refetched server row matches the
  // pending value (the source of truth has caught up).
  useEffect(() => {
    const irs = itemResultsRef.current;
    if (!irs) return;
    setPendingItemStatus((prev) => {
      let changed = false;
      const next: Record<number, "checked" | "missed"> = {};
      for (const id in prev) {
        const row = irs.find((r) => r.id === Number(id));
        if (row && row.status === prev[id as unknown as number]) {
          changed = true;
        } else {
          next[id as unknown as number] = prev[id as unknown as number];
        }
      }
      return changed ? next : prev;
    });
  }, [session?.itemResults]);

  useEffect(() => {
    const qrs = questionResultsRef.current;
    if (!qrs) return;
    setPendingQuestionScore((prev) => {
      let changed = false;
      const next: Record<number, number> = {};
      for (const id in prev) {
        const row = qrs.find((r) => r.id === Number(id));
        if (row && row.score === prev[id as unknown as number]) {
          changed = true;
        } else {
          next[id as unknown as number] = prev[id as unknown as number];
        }
      }
      return changed ? next : prev;
    });
    // Drop optimistic pointResults entries whose server row now matches.
    setPendingPointResults((prev) => {
      let changed = false;
      const next: Record<
        number,
        Array<{ point: string; status: "present" | "missed" }>
      > = {};
      for (const id in prev) {
        const row = qrs.find((r) => r.id === Number(id));
        const serverPoints = row?.pointResults ?? null;
        const pending = prev[id as unknown as number];
        if (
          row &&
          serverPoints &&
          serverPoints.length === pending.length &&
          serverPoints.every(
            (p, i) =>
              p.point === pending[i].point && p.status === pending[i].status,
          )
        ) {
          changed = true;
        } else {
          next[id as unknown as number] = pending;
        }
      }
      return changed ? next : prev;
    });
  }, [session?.examinerQuestionResults]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-5">
        <p className="text-body text-muted-foreground">Session not found</p>
        <Button
          onClick={() => navigate("/my-stations")}
          className="rounded-full h-12 px-6"
        >
          Back to my stations
        </Button>
      </div>
    );
  }

  // Prefer server-derived breakdown (always fresh, uses iter10 weighting).
  // Fall back to the stored totalScore if for any reason `scoring` is absent
  // (e.g. an old client hitting a new server — shouldn't happen in practice).
  const scoring = session.scoring;
  const score = scoring
    ? scoring.compositeScore
    : (session.totalScore ?? 0);
  const timeUsed = session.timeUsedSeconds ?? 0;
  const timeLimit = session.timeLimitSeconds;

  // Group item results by section
  const itemsBySectionId = new Map<
    number,
    { title: string; items: Array<(typeof session.itemResults)[0]> }
  >();
  session.itemResults?.forEach((ir) => {
    const secId = ir.item.sectionId;
    if (!itemsBySectionId.has(secId)) {
      itemsBySectionId.set(secId, {
        title: ir.item.section?.title ?? `Section ${secId}`,
        items: [],
      });
    }
    itemsBySectionId.get(secId)!.items.push(ir);
  });

  // Build a depth map: items with a parent whose parent also has a parent are depth 2
  const itemDepthMap = new Map<number, number>();
  const parentMap = new Map<number, number | null>();
  session.itemResults?.forEach((ir) => {
    parentMap.set(ir.item.id, ir.item.parentItemId);
  });
  session.itemResults?.forEach((ir) => {
    if (!ir.item.parentItemId) {
      itemDepthMap.set(ir.item.id, 0);
    } else {
      const grandParent = parentMap.get(ir.item.parentItemId);
      itemDepthMap.set(ir.item.id, grandParent ? 2 : 1);
    }
  });

  // A row is a "parent" (heading) if any other row points to its item as
  // parentItemId. Parents are derived from their children — no affordance.
  const hasChildrenSet = new Set<number>();
  session.itemResults?.forEach((ir) => {
    if (ir.item.parentItemId) hasChildrenSet.add(ir.item.parentItemId);
  });

  // Effective status / score honors any in-flight optimistic flip.
  const effectiveItemStatus = (ir: (typeof session.itemResults)[0]): string =>
    pendingItemStatus[ir.id] ?? ir.status;
  const effectiveQuestionScore = (
    qr: (typeof session.examinerQuestionResults)[0]
  ): number | null =>
    pendingQuestionScore[qr.id] !== undefined
      ? pendingQuestionScore[qr.id]
      : qr.score;
  const effectivePointResults = (
    qr: (typeof session.examinerQuestionResults)[0]
  ): Array<{ point: string; status: "present" | "missed" }> | null =>
    pendingPointResults[qr.id] ?? qr.pointResults ?? null;

  // Corrections count = leaf items where final status differs from aiStatus +
  // questions where final score differs from aiScore.
  const correctionsCount =
    (session.itemResults?.filter(
      (ir) =>
        !hasChildrenSet.has(ir.item.id) &&
        ir.aiStatus !== undefined &&
        effectiveItemStatus(ir) !== ir.aiStatus
    ).length ?? 0) +
    (session.examinerQuestionResults?.filter(
      (qr) =>
        qr.aiScore !== null &&
        qr.aiScore !== undefined &&
        effectiveQuestionScore(qr) !== qr.aiScore
    ).length ?? 0);

  // Items stat shows leaf coverage (parent rows are headings, not points).
  // Prefer the server-computed fraction so the numbers match the breakdown.
  const checkedCount = scoring
    ? scoring.checklistFraction.covered
    : session.itemResults?.filter(
        (r) => r.status === "checked" || r.status === "checked_after_time"
      ).length ?? 0;
  const totalItems = scoring
    ? scoring.checklistFraction.total
    : session.itemResults?.length ?? 0;
  const missedCritical =
    session.itemResults?.filter(
      (r) => r.item.isCritical && r.status === "missed"
    ) ?? [];

  // SVG gauge calc — r=54, circumference ≈ 339.29
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  const modeLabelMap: Record<string, string> = {
    self_check: "Self-ck",
    ai_history: "AI history",
    ai_observer: "AI observer",
    ai_communication: "AI comm.",
  };
  const modeLabel =
    modeLabelMap[session.mode ?? ""] ??
    (session.mode ?? "").replace(/_/g, " ");

  const backTo = session.stationId
    ? `/station/${session.stationId}`
    : "/my-stations";

  // Flip a checklist row optimistically, call the server, revert on failure.
  const applyItemCorrection = async (
    ir: (typeof session.itemResults)[0],
    nextStatus: "checked" | "missed"
  ) => {
    const prevStatus = effectiveItemStatus(ir);
    if (prevStatus === nextStatus) return;
    setPendingItemStatus((p) => ({ ...p, [ir.id]: nextStatus }));
    try {
      await updateItemResult.mutateAsync({
        sessionId: session.id,
        itemResultId: ir.id,
        status: nextStatus,
      });
    } catch (err) {
      // Roll back the optimistic flip so the row matches reality.
      setPendingItemStatus((p) => {
        const next = { ...p };
        delete next[ir.id];
        return next;
      });
      toast({
        title: "Couldn't save correction",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  // Same shape for question scores. `nextScore` is 0..1.
  // `nextPointResults` is optionally forwarded to the server for checklist
  // questions so the per-item breakdown stays in sync with the new score.
  const applyQuestionCorrection = async (
    qr: (typeof session.examinerQuestionResults)[0],
    nextScore: number,
    nextPointResults?: Array<{ point: string; status: "present" | "missed" }>
  ) => {
    const prevScore = effectiveQuestionScore(qr);
    if (prevScore === nextScore && nextPointResults === undefined) return;
    setPendingQuestionScore((p) => ({ ...p, [qr.id]: nextScore }));
    if (nextPointResults !== undefined) {
      setPendingPointResults((p) => ({ ...p, [qr.id]: nextPointResults }));
    }
    try {
      await updateQuestionResult.mutateAsync({
        sessionId: session.id,
        questionResultId: qr.id,
        score: nextScore,
        ...(nextPointResults !== undefined
          ? { pointResults: nextPointResults }
          : {}),
      });
    } catch (err) {
      setPendingQuestionScore((p) => {
        const next = { ...p };
        delete next[qr.id];
        return next;
      });
      if (nextPointResults !== undefined) {
        setPendingPointResults((p) => {
          const next = { ...p };
          delete next[qr.id];
          return next;
        });
      }
      toast({
        title: "Couldn't save correction",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <PageHeader
        title="Results"
        backTo={backTo}
        actions={
          <button
            type="button"
            aria-label="Delete this attempt"
            onClick={() => setShowDeleteDialog(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        }
      />

      <div className="mx-auto max-w-2xl lg:max-w-4xl px-5 pt-6 space-y-8">
        {/* Hero — Score gauge */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
          className="space-y-4"
        >
          <div>
            <p className="text-label text-muted-foreground uppercase">
              Practice results
            </p>
            {session.station && (
              <h1 className="mt-1 text-h1 text-foreground">
                {session.station.title}
              </h1>
            )}
          </div>

          <Card className="rounded-3xl border-border/60 bg-card shadow-card">
            <CardContent className="p-6">
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
                      className="text-border/60"
                    />
                    {/* Only render the foreground arc when there's score to
                        show. At score=0 the rounded linecap leaves a stub
                        that reads as a floating dot, so we just skip it
                        and let the muted background ring carry the visual. */}
                    {dash > 0 && (
                      <motion.circle
                        cx="60"
                        cy="60"
                        r={radius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="8"
                        strokeLinecap="round"
                        className={scoreRampStroke(score)}
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
                        scoreRampText(score)
                      )}
                    >
                      {Math.round(score)}
                    </span>
                    <span className="mt-0.5 text-caption text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
                <p className="mt-4 text-caption text-muted-foreground">
                  {score >= 75
                    ? "Excellent performance"
                    : score >= 60
                      ? "Solid attempt — keep refining"
                      : "Room to grow"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Time-overage callout — non-destructive amber nudge when the user
              ran past the station's time limit. In a real OSCE the bell ends
              the station, so this is purely instructional. */}
          {timeLimit != null && timeUsed > timeLimit && (
            <div className="rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-[13px] leading-snug text-foreground">
              You went{" "}
              <span className="font-semibold tabular-nums">
                {formatTime(timeUsed - timeLimit)}
              </span>{" "}
              over the{" "}
              <span className="font-semibold tabular-nums">
                {formatTime(timeLimit)}
              </span>{" "}
              limit. In a real OSCE the bell ends the station — try ending
              sooner next time.
            </div>
          )}

          {/* Score breakdown — shown when the station has both checklist and
              examiner content. Hidden for checklist-only (or examiner-only)
              stations since the composite is trivially one part. */}
          {scoring && scoring.hasChecklist && scoring.hasExaminer && (
            <div className="rounded-2xl bg-card border border-border/60 p-4">
              <p className="text-caption text-muted-foreground">
                Score breakdown
              </p>
              <div className="mt-3 space-y-2.5">
                <ScoreRow
                  label="Checklist"
                  earned={scoring.checklistFraction.covered}
                  total={scoring.checklistFraction.total}
                  pct={scoring.checklistScore}
                  weightPct={60}
                />
                <ScoreRow
                  label="Examiner"
                  earned={scoring.examinerFraction.earned}
                  total={scoring.examinerFraction.total}
                  pct={scoring.examinerScore}
                  weightPct={40}
                />
                <div className="pt-2 mt-1 border-t border-border/60 flex items-baseline justify-between">
                  <span className="text-body font-semibold text-foreground">
                    Overall
                  </span>
                  <span
                    className={cn(
                      "text-body font-semibold tabular-nums",
                      scoreRampText(score)
                    )}
                  >
                    {Math.round(score)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Stats row.
              Examiner-only stations (no checklist items) confused users by
              showing "0/0 items" — switch the card to a Questions count that
              actually reflects what was graded. */}
          <div className="grid grid-cols-3 gap-3">
            {totalItems === 0 &&
            (session.examinerQuestionResults?.length ?? 0) > 0 ? (
              (() => {
                const qrs = session.examinerQuestionResults ?? [];
                const answered = qrs.filter(
                  (qr) => (effectiveQuestionScore(qr) ?? 0) > 0,
                ).length;
                return (
                  <div className="rounded-2xl bg-card border border-border/60 p-4 text-center">
                    <p className="text-caption text-muted-foreground">
                      Questions
                    </p>
                    <p className="mt-1 text-h3 tabular-nums text-foreground">
                      {answered}/{qrs.length}
                    </p>
                  </div>
                );
              })()
            ) : (
              <div className="rounded-2xl bg-card border border-border/60 p-4 text-center">
                <p className="text-caption text-muted-foreground">Items</p>
                <p className="mt-1 text-h3 tabular-nums text-foreground">
                  {checkedCount}/{totalItems}
                </p>
              </div>
            )}
            <div className="rounded-2xl bg-card border border-border/60 p-4 text-center">
              <p className="text-caption text-muted-foreground">Time</p>
              <p className="mt-1 text-h3 tabular-nums text-foreground">
                {formatTime(timeUsed)}
              </p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                of {formatTime(timeLimit)}
              </p>
            </div>
            <div className="rounded-2xl bg-card border border-border/60 p-4 text-center">
              <p className="text-caption text-muted-foreground">Mode</p>
              <p className="mt-1 text-h3 text-foreground capitalize whitespace-nowrap">
                {modeLabel}
              </p>
            </div>
          </div>

          {/* Critical missed alert */}
          {missedCritical.length > 0 && (
            <div className="rounded-xl bg-warning-surface/60 border border-warning/30 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-brand-accent shrink-0" />
                <p className="text-caption font-semibold text-brand-accent">
                  {missedCritical.length} critical item
                  {missedCritical.length > 1 ? "s" : ""} missed
                </p>
              </div>
              <ul className="mt-2 space-y-1 pl-6">
                {missedCritical.map((r) => (
                  <li
                    key={r.id}
                    className="text-caption text-foreground/80 list-disc"
                  >
                    {r.item.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.section>

        {/* Detailed checklist */}
        {session.itemResults && session.itemResults.length > 0 && (
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
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-h2 text-foreground">Checklist</h2>
              {correctionsCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      {correctionsCount} correction
                      {correctionsCount > 1 ? "s" : ""} applied — thanks, this
                      helps Socrates learn
                      <Info className="h-3 w-3" aria-hidden />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-[11px] leading-relaxed">
                    Your corrections become the new score for your history and
                    feed into improving the grader. The AI's original answer is
                    preserved privately for comparison.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="rounded-2xl bg-card border border-border/60 p-5 space-y-6">
              {Array.from(itemsBySectionId.entries()).map(
                ([sectionId, group]) => (
                  <div key={sectionId} className="space-y-2">
                    <h3 className="text-label text-muted-foreground uppercase">
                      {group.title}
                    </h3>
                    <div className="space-y-1.5">
                      {group.items.map((ir) => {
                        const depth = itemDepthMap.get(ir.item.id) ?? 0;
                        const isParent = hasChildrenSet.has(ir.item.id);
                        const status = effectiveItemStatus(ir);
                        const isChecked = status === "checked";
                        const isLate = status === "checked_after_time";
                        const isMissed = status === "missed";
                        const isCorrected =
                          !isParent &&
                          ir.aiStatus !== undefined &&
                          status !== ir.aiStatus;
                        const nextStatus: "checked" | "missed" = isChecked
                          ? "missed"
                          : "checked";
                        return (
                          <div
                            key={ir.id}
                            className={cn(
                              "group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-smooth",
                              depth === 1 && "ml-4",
                              depth === 2 && "ml-8",
                              isChecked &&
                                "bg-emerald-500/5 dark:bg-emerald-500/10",
                              isLate && "bg-brand-accent/5",
                              isMissed && "bg-muted/40",
                              isCorrected && "ring-1 ring-primary/30"
                            )}
                          >
                            <div
                              className={cn(
                                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                                isChecked &&
                                  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                                isLate && "bg-brand-accent/15 text-brand-accent",
                                isMissed && "bg-muted text-muted-foreground"
                              )}
                            >
                              {isChecked && (
                                <Check className="h-3 w-3" strokeWidth={3} />
                              )}
                              {isLate && <Clock className="h-3 w-3" />}
                              {isMissed && (
                                <X className="h-3 w-3" strokeWidth={3} />
                              )}
                            </div>
                            <span
                              className={cn(
                                "flex-1 text-body",
                                isMissed && "text-muted-foreground",
                                isChecked && "text-foreground",
                                isLate && "text-foreground"
                              )}
                            >
                              {ir.item.text}
                            </span>
                            {ir.item.isCritical && isMissed && (
                              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-brand-accent/15 px-2 py-0.5 text-[11px] font-semibold text-brand-accent">
                                <AlertTriangle className="h-3 w-3" />
                                Critical
                              </span>
                            )}
                            {/* Correction affordance — leaf rows only. */}
                            {!isParent && (
                              <div className="shrink-0 flex items-center gap-2">
                                {isCorrected && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        className={CORRECTED_BADGE_CLASS}
                                        data-testid="corrected-badge"
                                      >
                                        Corrected
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs text-[11px]">
                                      You corrected this from{" "}
                                      {prettyAiStatus(ir.aiStatus)} to{" "}
                                      {prettyAiStatus(status)}.
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {isCorrected && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      applyItemCorrection(
                                        ir,
                                        ir.aiStatus === "checked" ||
                                          ir.aiStatus === "checked_after_time"
                                          ? "checked"
                                          : "missed"
                                      )
                                    }
                                    className="text-[11px] text-muted-foreground hover:text-foreground transition-smooth inline-flex items-center gap-1"
                                  >
                                    <Undo2 className="h-3 w-3" />
                                    Undo
                                  </button>
                                )}
                                {!isCorrected && (
                                  <button
                                    type="button"
                                    aria-label={`Mark as ${nextStatus}`}
                                    onClick={() =>
                                      applyItemCorrection(ir, nextStatus)
                                    }
                                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-smooth opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100"
                                  >
                                    <Pencil className="h-3 w-3" />
                                    Wasn't right?
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>
          </motion.section>
        )}

        {/* Examiner Q&A */}
        {session.examinerQuestionResults &&
          session.examinerQuestionResults.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.24,
                delay: 0.1,
                ease: [0.32, 0.72, 0, 1],
              }}
              className="space-y-3"
            >
              <h2 className="text-h2 text-foreground">Examiner questions</h2>
              <Accordion type="multiple" className="space-y-3">
                {session.examinerQuestionResults.map((qr, qi) => {
                  const score = effectiveQuestionScore(qr);
                  const pct =
                    score !== null && score !== undefined
                      ? Math.round(score * 100)
                      : null;
                  const correct = score === 1;
                  const partial = score !== null && score > 0 && score < 1;
                  const isCorrected =
                    qr.aiScore !== null &&
                    qr.aiScore !== undefined &&
                    score !== qr.aiScore;
                  const pickerOpen = openScorePickerFor === qr.id;
                  // Preset chips fallback (no shadcn Popover in this app).
                  const presets = [0, 0.25, 0.5, 0.75, 1] as const;
                  const isChecklist =
                    (qr.question as any)?.questionType === "checklist";
                  const points = effectivePointResults(qr);
                  const showChecklistBreakdown =
                    isChecklist && points && points.length > 0;
                  const presentCount =
                    showChecklistBreakdown && points
                      ? points.filter((p) => p.status === "present").length
                      : 0;
                  const totalPoints = showChecklistBreakdown && points
                    ? points.length
                    : 0;
                  return (
                    <AccordionItem
                      key={qr.id}
                      value={`q-${qr.id}`}
                      className={cn(
                        "rounded-2xl bg-card border border-border/60 overflow-hidden",
                        isCorrected && "ring-1 ring-primary/30"
                      )}
                    >
                      <AccordionTrigger className="px-5 py-4 hover:no-underline">
                        <div className="flex items-start justify-between gap-3 w-full text-left">
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-label text-muted-foreground uppercase">
                              Question {qi + 1}
                            </p>
                            <p className="text-body font-medium text-foreground">
                              {qr.question.question}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums",
                              correct &&
                                "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                              partial && "bg-brand-accent/15 text-brand-accent",
                              !correct &&
                                !partial &&
                                "bg-muted text-muted-foreground"
                            )}
                          >
                            {pct !== null ? `${pct}%` : "—"}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-5 pb-5 space-y-4">
                        <div className="rounded-xl bg-muted/40 p-4 space-y-1">
                          <p className="text-label text-muted-foreground uppercase">
                            Ideal answer
                          </p>
                          <p className="text-caption text-foreground/80 leading-relaxed">
                            {qr.question.idealAnswer}
                          </p>
                        </div>

                        {/* Checklist: per-item breakdown. Tap an item to
                            flip present↔missed; score recomputes from the
                            new covered count. Renders in canonical keyPoint
                            order so authors see consistent layout across runs. */}
                        {showChecklistBreakdown && points && (
                          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border/60">
                              <p className="text-label text-muted-foreground uppercase">
                                Items covered
                              </p>
                              <p className="text-caption tabular-nums text-muted-foreground">
                                {presentCount} of {totalPoints} —{" "}
                                {Math.round(
                                  (presentCount / Math.max(1, totalPoints)) *
                                    100
                                )}
                                %
                              </p>
                            </div>
                            <ul className="divide-y divide-border/60">
                              {points.map((p, i) => {
                                const isPresent = p.status === "present";
                                return (
                                  <li key={`${qr.id}-${i}`}>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const flipped = points.map((pp, j) =>
                                          j === i
                                            ? {
                                                point: pp.point,
                                                status:
                                                  pp.status === "present"
                                                    ? ("missed" as const)
                                                    : ("present" as const),
                                              }
                                            : pp
                                        );
                                        const newPresent = flipped.filter(
                                          (x) => x.status === "present"
                                        ).length;
                                        const newScore =
                                          Math.round(
                                            (newPresent /
                                              Math.max(1, flipped.length)) *
                                              100
                                          ) / 100;
                                        await applyQuestionCorrection(
                                          qr,
                                          newScore,
                                          flipped
                                        );
                                      }}
                                      className={cn(
                                        "w-full flex items-start gap-3 px-4 py-2.5 text-left transition-smooth hover:bg-muted/30"
                                      )}
                                      aria-pressed={isPresent}
                                    >
                                      <span
                                        aria-hidden
                                        className={cn(
                                          "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                                          isPresent
                                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                        )}
                                      >
                                        {isPresent ? (
                                          <Check className="h-3.5 w-3.5" />
                                        ) : (
                                          <X className="h-3.5 w-3.5" />
                                        )}
                                      </span>
                                      <span className="text-caption leading-snug text-foreground/90">
                                        {p.point}
                                      </span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

                        {/* Correction strip: badge + Undo. Non-checklist
                            questions also get the slider/preset chips below. */}
                        <div className="flex flex-wrap items-center gap-2">
                          {isCorrected && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={CORRECTED_BADGE_CLASS}>
                                    Corrected
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-[11px]">
                                  You corrected this from{" "}
                                  {qr.aiScore !== null
                                    ? `${Math.round((qr.aiScore ?? 0) * 100)}%`
                                    : "—"}{" "}
                                  to {pct ?? 0}%.
                                </TooltipContent>
                              </Tooltip>
                              <button
                                type="button"
                                onClick={() =>
                                  qr.aiScore !== null &&
                                  applyQuestionCorrection(qr, qr.aiScore ?? 0)
                                }
                                className="text-[11px] text-muted-foreground hover:text-foreground transition-smooth inline-flex items-center gap-1"
                              >
                                <Undo2 className="h-3 w-3" />
                                Undo
                              </button>
                            </>
                          )}
                          {!showChecklistBreakdown && (
                            <button
                              type="button"
                              onClick={() =>
                                setOpenScorePickerFor(
                                  pickerOpen ? null : qr.id
                                )
                              }
                              className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-smooth"
                              aria-expanded={pickerOpen}
                            >
                              <Pencil className="h-3 w-3" />
                              Correct score
                            </button>
                          )}
                          {showChecklistBreakdown && (
                            <p className="ml-auto text-[11px] text-muted-foreground">
                              Tap an item to flip present / missed.
                            </p>
                          )}
                        </div>
                        {pickerOpen && !showChecklistBreakdown && (
                          <div className="rounded-xl border border-border/60 bg-background p-3 space-y-2">
                            <p className="text-[11px] text-muted-foreground">
                              Pick the right score for this answer.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {presets.map((p) => {
                                const selected = score === p;
                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={async () => {
                                      setOpenScorePickerFor(null);
                                      await applyQuestionCorrection(qr, p);
                                    }}
                                    className={cn(
                                      "rounded-full border px-3 py-1 text-[11px] tabular-nums transition-smooth",
                                      selected
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/50"
                                    )}
                                  >
                                    {Math.round(p * 100)}%
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </motion.section>
          )}

        {/* Actions */}
        <div className="pt-2 space-y-4">
          <Button
            onClick={() => navigate(`/station/${session.stationId}`)}
            className="w-full rounded-full h-12 text-[17px] font-semibold tracking-tight"
          >
            Practice again
          </Button>
          <div className="flex items-center justify-center gap-6">
            <button
              onClick={() => navigate(`/station/${session.stationId}`)}
              className="text-caption text-muted-foreground hover:text-foreground transition-smooth h-11 px-2"
            >
              Back to station
            </button>
            <button
              onClick={() => navigate("/my-stations")}
              className="text-caption text-muted-foreground hover:text-foreground transition-smooth h-11 px-2"
            >
              Back to library
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this attempt?</AlertDialogTitle>
            <AlertDialogDescription>
              The session and its scores will be permanently removed from your
              history. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setShowDeleteDialog(false);
                try {
                  await deleteSession.mutateAsync(session.id);
                  toast({ title: "Session deleted" });
                  navigate("/progress");
                } catch (err) {
                  toast({
                    title: "Couldn't delete session",
                    description:
                      err instanceof Error ? err.message : undefined,
                    variant: "warning",
                  });
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
