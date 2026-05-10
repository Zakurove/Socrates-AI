import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { useSession, useDeleteSession } from "@/hooks/use-sessions";
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
  Check,
  Clock,
  Loader2,
  X,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import { motion } from "framer-motion";

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
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
                      className="text-muted/40"
                    />
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

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-card border border-border/60 p-4 text-center">
              <p className="text-caption text-muted-foreground">Items</p>
              <p className="mt-1 text-h3 tabular-nums text-foreground">
                {checkedCount}/{totalItems}
              </p>
            </div>
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
            <h2 className="text-h2 text-foreground">Checklist</h2>
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
                        const isChecked = ir.status === "checked";
                        const isLate = ir.status === "checked_after_time";
                        const isMissed = ir.status === "missed";
                        return (
                          <div
                            key={ir.id}
                            className={cn(
                              "flex items-start gap-3 rounded-xl px-3 py-2.5 transition-smooth",
                              depth === 1 && "ml-4",
                              depth === 2 && "ml-8",
                              isChecked &&
                                "bg-emerald-500/5 dark:bg-emerald-500/10",
                              isLate && "bg-brand-accent/5",
                              isMissed && "bg-muted/40"
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
                  const correct = qr.score === 1;
                  const partial = qr.score === 0.5;
                  return (
                    <AccordionItem
                      key={qr.id}
                      value={`q-${qr.id}`}
                      className="rounded-2xl bg-card border border-border/60 overflow-hidden"
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
                              "shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              correct &&
                                "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                              partial && "bg-brand-accent/15 text-brand-accent",
                              !correct &&
                                !partial &&
                                "bg-muted text-muted-foreground"
                            )}
                          >
                            {correct
                              ? "Correct"
                              : partial
                                ? "Partial"
                                : "Incorrect"}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-5 pb-5">
                        <div className="rounded-xl bg-muted/40 p-4 space-y-1">
                          <p className="text-label text-muted-foreground uppercase">
                            Ideal answer
                          </p>
                          <p className="text-caption text-foreground/80 leading-relaxed">
                            {qr.question.idealAnswer}
                          </p>
                        </div>
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
