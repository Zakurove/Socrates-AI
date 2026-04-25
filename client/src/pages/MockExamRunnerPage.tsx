import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Loader2, TimerIcon, X } from "lucide-react";
import {
  useMockExam,
  useMockExamAttempts,
  useAbortMockExamAttempt,
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
import { useToast } from "@/components/ui/use-toast";
import { usePrefs } from "@/hooks/use-prefs";
import type { MockExamPracticeMode } from "@shared/schema";

function formatClock(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function useQuery() {
  const [loc] = useLocation();
  return useMemo(() => {
    const q = typeof window !== "undefined" ? window.location.search : "";
    return new URLSearchParams(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc]);
}

/**
 * Build the practice URL for a given station based on the mock exam's
 * chosen practice mode. The runner uses this to route directly into the
 * correct surface — the PracticeModeSheet should NOT appear inside a
 * mock exam, because mode is decided once at creation time.
 */
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

export default function MockExamRunnerPage() {
  const params = useParams<{ id: string }>();
  const examId = Number(params.id);
  const [, navigate] = useLocation();
  const query = useQuery();
  const phaseParam = query.get("phase");
  const attemptIdParam = query.get("attemptId");
  const attemptId = attemptIdParam ? Number(attemptIdParam) : undefined;

  const { data: exam, isLoading, refetch } = useMockExam(examId);
  const {
    data: attempts,
    refetch: refetchAttempts,
  } = useMockExamAttempts(examId);
  const abortAttempt = useAbortMockExamAttempt();
  const { toast } = useToast();
  const { prefs } = usePrefs();
  const [showExitDialog, setShowExitDialog] = useState(false);

  // Pick the attempt. If none specified, prefer the latest in-progress;
  // if none in progress, fall back to most recent attempt. When no
  // attempts exist at all we route to the detail page so the user can
  // start one.
  const attempt: MockExamAttemptDTO | undefined = useMemo(() => {
    if (!attempts || attempts.length === 0) return undefined;
    if (attemptId != null) {
      return attempts.find((a) => a.id === attemptId);
    }
    const inProgress = [...attempts]
      .filter((a) => a.completedAt == null)
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    if (inProgress) return inProgress;
    return [...attempts].sort(
      (a, b) => b.attemptNumber - a.attemptNumber
    )[0];
  }, [attempts, attemptId]);

  // Defensive refetch on mount — mirrors the iter9 pattern. The global
  // staleTime is 5 minutes so without this the runner would happily
  // re-render stale state after a station finishes (old bug 2).
  useEffect(() => {
    if (!isNaN(examId)) {
      refetch();
      refetchAttempts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Bell
  const audioCtx = useRef<AudioContext | null>(null);
  const playBell = useCallback(
    (high = false) => {
      if (!prefs.timerSounds) return;
      try {
        if (!audioCtx.current) audioCtx.current = new AudioContext();
        const ctx = audioCtx.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = high ? 1320 : 880;
        gain.gain.value = 0.18;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          ctx.currentTime + 0.9
        );
        osc.stop(ctx.currentTime + 0.9);
      } catch {
        // ignore
      }
    },
    [prefs.timerSounds]
  );

  // Rest countdown — anchored to wall clock so we don't drift when the
  // tab is backgrounded.
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const restEndsAtRef = useRef<number | null>(null);
  const tenBeeped = useRef(false);
  const zeroBeeped = useRef(false);
  const autoAdvancedRef = useRef(false);

  useEffect(() => {
    if (phaseParam !== "rest" || !exam) {
      setRestRemaining(null);
      restEndsAtRef.current = null;
      tenBeeped.current = false;
      zeroBeeped.current = false;
      autoAdvancedRef.current = false;
      return;
    }
    restEndsAtRef.current = Date.now() + exam.restSeconds * 1000;
    setRestRemaining(exam.restSeconds);
    tenBeeped.current = false;
    zeroBeeped.current = false;
    autoAdvancedRef.current = false;
  }, [phaseParam, exam]);

  useEffect(() => {
    if (phaseParam !== "rest" || restEndsAtRef.current == null) return;
    const tick = () => {
      const endsAt = restEndsAtRef.current;
      if (endsAt == null) return;
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (remaining <= 10 && !tenBeeped.current) {
        tenBeeped.current = true;
        playBell(false);
      }
      if (remaining <= 0 && !zeroBeeped.current) {
        zeroBeeped.current = true;
        playBell(true);
      }
      setRestRemaining(remaining);
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [phaseParam, playBell]);

  // Begin the next station for the active attempt. Routes into the correct
  // practice surface based on the mock exam's practice mode so the
  // PracticeModeSheet never appears inside a mock exam.
  const beginNextStation = useCallback(() => {
    if (!exam || !attempt) return;
    const ids = (exam.stationIds ?? []) as number[];
    const idx = attempt.currentStationIndex;
    const sid = ids[idx];
    if (sid == null) {
      // Out of range — attempt should be completed. Route to the
      // attempt results page.
      navigate(`/mock-exam/${examId}/results?attemptId=${attempt.id}`);
      return;
    }
    if (import.meta.env.DEV) {
      console.log(
        `[mock-exam] runner begin, attempt=${attempt.id}, mode=${exam.practiceMode}, index=${idx}, stationId=${sid}`
      );
    }
    navigate(practiceUrlFor(sid, exam.practiceMode, examId, attempt.id));
  }, [exam, attempt, examId, navigate]);

  // Auto-advance when rest hits 0. Fires exactly once per rest entry.
  useEffect(() => {
    if (phaseParam !== "rest") return;
    if (restRemaining == null) return;
    if (restRemaining <= 0 && !autoAdvancedRef.current) {
      autoAdvancedRef.current = true;
      const t = setTimeout(() => beginNextStation(), 400);
      return () => clearTimeout(t);
    }
  }, [phaseParam, restRemaining, beginNextStation]);

  // Completed attempt → route to results. No attempt at all → detail page.
  useEffect(() => {
    if (!exam || !attempts) return;
    if (attempts.length === 0) {
      navigate(`/mock-exams/${examId}`);
      return;
    }
    if (!attempt) return;
    if (attempt.completedAt != null) {
      navigate(`/mock-exam/${examId}/results?attemptId=${attempt.id}`);
    }
  }, [exam, attempts, attempt, examId, navigate]);

  // In-progress (not rest phase) → redirect straight to current station.
  useEffect(() => {
    if (!exam || !attempt) return;
    if (phaseParam === "rest") return;
    if (attempt.completedAt != null) return;
    const ids = (exam.stationIds ?? []) as number[];
    const idx = attempt.currentStationIndex;
    const sid = ids[idx];
    if (sid != null) {
      navigate(practiceUrlFor(sid, exam.practiceMode, examId, attempt.id));
    }
  }, [exam, attempt, phaseParam, examId, navigate]);

  const handleExitConfirmed = async () => {
    setShowExitDialog(false);
    if (attempt && attempt.completedAt == null) {
      try {
        await abortAttempt.mutateAsync({ examId, attemptId: attempt.id });
      } catch {
        // best-effort — still navigate out
      }
    }
    navigate(`/mock-exams/${examId}`);
  };

  if (isLoading || !exam) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // ───────── REST PHASE ─────────
  if (phaseParam === "rest") {
    const remaining = restRemaining ?? exam.restSeconds;

    return (
      <div className="fixed inset-0 flex flex-col bg-background">
        <div className="safe-top" />

        <div className="sticky top-0 z-10 backdrop-blur-xl bg-background/80">
          <div className="px-5 h-14 flex items-center justify-end">
            <button
              onClick={() => setShowExitDialog(true)}
              className="h-11 w-11 -mr-2 grid place-items-center rounded-full hover:bg-muted transition-smooth"
              aria-label="End mock exam"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="h-16 w-16 rounded-full bg-muted grid place-items-center mb-8">
            <TimerIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-label text-muted-foreground uppercase">
            Next station in
          </p>
          <div
            className="mt-3 text-[64px] font-bold tabular-nums tracking-[-0.028em] text-foreground leading-none"
            aria-live="polite"
          >
            {formatClock(Math.max(0, remaining))}
          </div>
          <p className="mt-3 text-caption text-muted-foreground max-w-xs">
            Rest. Don&rsquo;t look at what&rsquo;s coming — the surprise is
            part of the exam.
          </p>
          <Button
            onClick={beginNextStation}
            className="mt-10 rounded-full h-12 px-6 text-[17px] font-semibold tracking-tight"
          >
            Begin next station
          </Button>
        </div>

        <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End mock exam?</AlertDialogTitle>
              <AlertDialogDescription>
                Progress on this attempt will be saved and the attempt marked
                complete.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay</AlertDialogCancel>
              <AlertDialogAction onClick={handleExitConfirmed}>
                End exam
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // Otherwise we're waiting for navigation to resolve — the effects above
  // will route us out within a frame. Show a spinner.
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
