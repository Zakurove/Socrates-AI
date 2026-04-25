import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useStation } from "@/hooks/use-stations";
import { queryClient } from "@/lib/queryClient";
import {
  useCreateSession,
  useUpdateSession,
  useSaveItemResults,
  useSaveQuestionResults,
} from "@/hooks/use-sessions";
import { TimerBar } from "@/components/TimerBar";
import { ChecklistItem, ChecklistItemStatus } from "@/components/ChecklistItem";
import { ReadingPhase } from "@/components/practice/ReadingPhase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { usePrefs } from "@/hooks/use-prefs";
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
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
  Check,
} from "lucide-react";
import { cn, formatTime } from "@/lib/utils";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { useToast } from "@/components/ui/use-toast";
import {
  persistSession,
  loadSession,
  getActiveSessionId,
  setActiveSessionId,
  clearActiveSession,
} from "@/lib/practice-storage";
import { computeCompositeScore } from "@shared/scoring";

type Phase = "reading" | "practice" | "questions" | "complete";

interface FlatItem {
  id: number;
  sectionId: number;
  sectionTitle: string;
  text: string;
  isCritical: boolean;
  isSubItem: boolean;
  depth: number;
  parentItemId: number | null;
}

export default function PracticeModePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data: station, isLoading, error } = useStation(params.id);
  const { prefs } = usePrefs();
  const shouldReduce = useReducedMotion();
  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const saveItemResults = useSaveItemResults();
  const saveQuestionResults = useSaveQuestionResults();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("reading");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // -1 sentinel = not yet initialized from station. Prevents the reading
  // timer effect from seeing 0 on first commit and short-circuiting into
  // startPractice() before setReadingCountdown(station.readingTimeMinutes*60)
  // has been flushed.
  const [readingCountdown, setReadingCountdown] = useState(-1);
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [checkTimestamps, setCheckTimestamps] = useState<Map<number, number>>(new Map());
  const [timeUp, setTimeUp] = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);
  // P0-4: when we restore a session that's already in overtime or
  // completed state we pause before re-attaching the live timer and
  // ask the user whether to resume the existing run or start fresh.
  const [resumePrompt, setResumePrompt] = useState<
    | null
    | {
        kind: "overtime" | "completed";
        savedSessionId: number;
        elapsedSeconds: number;
        applyRestore: () => void;
      }
  >(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [questionScores, setQuestionScores] = useState<Map<number, number>>(new Map());
  const [showQuestionAnswer, setShowQuestionAnswer] = useState(false);
  const [isScoringTransition, setIsScoringTransition] = useState(false);
  const restoredRef = useRef(false);
  const inFlightRef = useRef(false);
  const startAttemptedRef = useRef(false);
  const mockExamIdRef = useRef<number | null>(null);
  const mockExamAttemptIdRef = useRef<number | null>(null);
  if (
    typeof window !== "undefined" &&
    (mockExamIdRef.current == null || mockExamAttemptIdRef.current == null)
  ) {
    const qs = new URLSearchParams(window.location.search);
    if (mockExamIdRef.current == null) {
      const raw = qs.get("mockExamId");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(n)) mockExamIdRef.current = n;
    }
    if (mockExamAttemptIdRef.current == null) {
      const raw = qs.get("mockExamAttemptId");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(n)) mockExamAttemptIdRef.current = n;
    }
  }

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const practiceStartedAtRef = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const halfwayBeeped = useRef(false);
  const twominBeeped = useRef(false);
  const endBeeped = useRef(false);

  // Flatten items
  const flatItems = useMemo<FlatItem[]>(() => {
    if (!station) return [];
    const result: FlatItem[] = [];
    [...station.sections]
      .sort((a, b) => a.order - b.order)
      .forEach((sec) => {
        [...sec.items]
          .filter((i) => !i.parentItemId)
          .sort((a, b) => a.order - b.order)
          .forEach((item) => {
            result.push({
              id: item.id,
              sectionId: sec.id,
              sectionTitle: sec.title,
              text: item.text,
              isCritical: item.isCritical,
              isSubItem: false,
              depth: 0,
              parentItemId: null,
            });
            if (item.subItems) {
              [...item.subItems]
                .sort((a, b) => a.order - b.order)
                .forEach((sub) => {
                  result.push({
                    id: sub.id,
                    sectionId: sec.id,
                    sectionTitle: sec.title,
                    text: sub.text,
                    isCritical: sub.isCritical,
                    isSubItem: true,
                    depth: 1,
                    parentItemId: item.id,
                  });
                  if ((sub as any).subItems) {
                    [...(sub as any).subItems]
                      .sort((a: any, b: any) => a.order - b.order)
                      .forEach((ssub: any) => {
                        result.push({
                          id: ssub.id,
                          sectionId: sec.id,
                          sectionTitle: sec.title,
                          text: ssub.text,
                          isCritical: ssub.isCritical,
                          isSubItem: true,
                          depth: 2,
                          parentItemId: sub.id,
                        });
                      });
                  }
                });
            }
          });
      });
    return result;
  }, [station]);

  // Build a lookup of section-level images
  const sectionMeta = useMemo(() => {
    if (!station) return new Map<number, { imageUrl?: string | null; imageCaption?: string | null; description?: string | null }>();
    const m = new Map<number, { imageUrl?: string | null; imageCaption?: string | null; description?: string | null }>();
    for (const sec of station.sections) {
      m.set(sec.id, {
        imageUrl: (sec as any).imageUrl ?? null,
        imageCaption: (sec as any).imageCaption ?? null,
        description: (sec as any).description ?? null,
      });
    }
    return m;
  }, [station]);

  // Group items by section for display
  const sectionGroups = useMemo(() => {
    const groups: Map<number, { title: string; imageUrl?: string | null; imageCaption?: string | null; items: FlatItem[] }> = new Map();
    flatItems.forEach((item) => {
      if (!groups.has(item.sectionId)) {
        const meta = sectionMeta.get(item.sectionId);
        groups.set(item.sectionId, { title: item.sectionTitle, imageUrl: meta?.imageUrl, imageCaption: meta?.imageCaption, items: [] });
      }
      groups.get(item.sectionId)!.items.push(item);
    });
    return Array.from(groups.entries());
  }, [flatItems, sectionMeta]);

  const totalSeconds = station
    ? station.defaultTimeMinutes * 60
    : 420;

  // Beep sound
  const playBeep = useCallback((count: number) => {
    if (!prefs.timerSounds) return;
    try {
      if (!audioCtx.current) {
        audioCtx.current = new AudioContext();
      }
      const ctx = audioCtx.current;
      for (let i = 0; i < count; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = count >= 3 ? 880 : 660;
        gain.gain.value = 0.15;
        osc.start(ctx.currentTime + i * 0.3);
        osc.stop(ctx.currentTime + i * 0.3 + 0.15);
      }
    } catch {
      // Audio not available
    }
  }, [prefs.timerSounds]);

  // Initialize: try restore from localStorage; else if 0 reading time, start practice.
  useEffect(() => {
    if (!station) return;
    setReadingCountdown(station.readingTimeMinutes * 60);

    // Attempt restore exactly once per mount.
    if (!restoredRef.current) {
      restoredRef.current = true;
      const savedId = getActiveSessionId(station.id);
      if (savedId) {
        const saved = loadSession(savedId);
        if (saved) {
          // Verify the session still exists server-side before restoring.
          // If it was deleted (DB cleanup, station delete cascade, etc.) we'd
          // otherwise be stuck on a phantom session whose mutations all 404.
          let cancelled = false;
          (async () => {
            try {
              const res = await fetch(`/api/sessions/${savedId}`, {
                credentials: "include",
              });
              if (cancelled) return;
              // P0-5: 401 must NOT be treated as a missing session.
              // The active key is left intact so the user lands back
              // on this page after authenticating.
              if (res.status === 401) {
                if (typeof window !== "undefined") {
                  const path = window.location.pathname + window.location.search;
                  window.location.href = `/auth?from=${encodeURIComponent(path)}`;
                }
                return;
              }
              if (res.status === 404) {
                clearActiveSession(station.id, savedId);
                if (
                  station.readingTimeMinutes === 0 &&
                  !sessionId &&
                  !inFlightRef.current
                ) {
                  startPractice();
                }
                return;
              }
              if (!res.ok) {
                // Other server errors — fall through to fresh start
                // but keep the local payload around (don't clear).
                if (
                  station.readingTimeMinutes === 0 &&
                  !sessionId &&
                  !inFlightRef.current
                ) {
                  startPractice();
                }
                return;
              }
              const serverSession = (await res.json().catch(() => null)) as
                | { endedAt?: string | null; timeLimitSeconds?: number }
                | null;
              // Bug 9: validate that questions phase is reachable.
              let restoredPhase = saved.phase;
              if (
                restoredPhase === "questions" &&
                station.examinerQuestions.length === 0
              ) {
                restoredPhase = "complete";
              }

              const applyRestore = () => {
                setSessionId(savedId);
                setCheckedItems(new Set(saved.checkedItems));
                setCheckTimestamps(new Map(saved.checkTimestamps));
                setElapsedSeconds(saved.elapsedSeconds);
                if (saved.practiceStartedAtMs) {
                  practiceStartedAtRef.current = saved.practiceStartedAtMs;
                } else if (restoredPhase === "practice") {
                  practiceStartedAtRef.current =
                    Date.now() - saved.elapsedSeconds * 1000;
                }
                setCurrentQuestionIdx(saved.currentQuestionIdx);
                if (saved.questionScores) {
                  setQuestionScores(new Map(saved.questionScores));
                }
                if (saved.elapsedSeconds >= totalSeconds) {
                  setTimeUp(true);
                  endBeeped.current = true;
                  halfwayBeeped.current = true;
                  twominBeeped.current = true;
                }
                setPhase(restoredPhase);
                if (restoredPhase === "complete") {
                  setTimeout(() => {
                    navigate(`/session/${savedId}/results`);
                  }, 0);
                }
              };

              // P0-4: gate the restore behind a Resume/Restart dialog
              // when the session is already finished (server) or has
              // gone past the time limit (overtime).
              const isCompleted = !!serverSession?.endedAt;
              const isOvertime =
                !isCompleted &&
                restoredPhase === "practice" &&
                saved.elapsedSeconds >= totalSeconds;
              if (isCompleted || isOvertime) {
                setResumePrompt({
                  kind: isCompleted ? "completed" : "overtime",
                  savedSessionId: savedId,
                  elapsedSeconds: saved.elapsedSeconds,
                  applyRestore,
                });
                return;
              }

              applyRestore();
            } catch {
              // Network error — fall through to fresh start.
              if (cancelled) return;
              clearActiveSession(station.id, savedId);
              if (
                station.readingTimeMinutes === 0 &&
                !sessionId &&
                !inFlightRef.current
              ) {
                startPractice();
              }
            }
          })();
          return;
        }
        // Stale active key with no payload — clear it.
        clearActiveSession(station.id, savedId);
      }
    }

    if (
      station.readingTimeMinutes === 0 &&
      phase === "reading" &&
      !sessionId &&
      !inFlightRef.current
    ) {
      startPractice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // Reading timer (auto-advance on 0)
  useEffect(() => {
    if (phase !== "reading" || !station) return;
    if (station.readingTimeMinutes === 0) return;
    if (sessionId) return; // already started
    // Wait until the countdown has been initialized from the station.
    if (readingCountdown < 0) return;
    if (readingCountdown === 0) {
      if (!inFlightRef.current) startPractice();
      return;
    }
    const interval = setInterval(() => {
      setReadingCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, station, readingCountdown, sessionId]);

  // Practice timer — anchored to Date.now() to avoid drift when the tab
  // is backgrounded. Survives restore via practiceStartedAtMs in storage.
  useEffect(() => {
    if (phase !== "practice") return;
    if (resumePrompt) return; // P0-4: hold timer while user decides
    if (practiceStartedAtRef.current == null) {
      practiceStartedAtRef.current = Date.now() - elapsedSeconds * 1000;
    }
    const tick = () => {
      const anchor = practiceStartedAtRef.current ?? Date.now();
      const next = Math.floor((Date.now() - anchor) / 1000);
      const halfway = Math.floor(totalSeconds / 2);
      if (next >= halfway && !halfwayBeeped.current) {
        halfwayBeeped.current = true;
        playBeep(1);
      }
      if (next >= totalSeconds - 120 && !twominBeeped.current) {
        twominBeeped.current = true;
        playBeep(2);
      }
      if (next >= totalSeconds && !endBeeped.current) {
        endBeeped.current = true;
        playBeep(3);
        setTimeUp(true);
      }
      setElapsedSeconds(next);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, totalSeconds, playBeep, resumePrompt]);

  // A2: Persist on every change
  useEffect(() => {
    if (!sessionId) return;
    if (phase === "complete") return;
    persistSession(sessionId, {
      checkedItems: Array.from(checkedItems),
      checkTimestamps: Array.from(checkTimestamps.entries()),
      elapsedSeconds,
      practiceStartedAtMs: practiceStartedAtRef.current ?? undefined,
      phase,
      currentQuestionIdx,
      questionScores: Array.from(questionScores.entries()),
    });
  }, [sessionId, checkedItems, checkTimestamps, elapsedSeconds, phase, currentQuestionIdx, questionScores]);

  // A2: beforeunload warning during practice/questions
  useEffect(() => {
    if (phase !== "practice" && phase !== "questions") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  // P0-4: dialog actions for the overtime/completed resume prompt.
  const onResumeContinue = () => {
    if (!resumePrompt) return;
    const apply = resumePrompt.applyRestore;
    setResumePrompt(null);
    apply();
  };
  const onResumeRestart = () => {
    if (!station || !resumePrompt) return;
    clearActiveSession(station.id, resumePrompt.savedSessionId);
    setResumePrompt(null);
    // Reset all derived practice state to a clean slate.
    setSessionId(null);
    setCheckedItems(new Set());
    setCheckTimestamps(new Map());
    setElapsedSeconds(0);
    setQuestionScores(new Map());
    setCurrentQuestionIdx(0);
    setTimeUp(false);
    practiceStartedAtRef.current = null;
    halfwayBeeped.current = false;
    twominBeeped.current = false;
    endBeeped.current = false;
    startAttemptedRef.current = false;
    if (station.readingTimeMinutes === 0) {
      startPractice();
    } else {
      setReadingCountdown(station.readingTimeMinutes * 60);
      setPhase("reading");
    }
  };

  // Start practice phase. Guarded so it can only fire once per mount cycle.
  const startPractice = async () => {
    if (!station) return;
    if (sessionId) return;
    if (inFlightRef.current) return;
    if (startAttemptedRef.current) return;
    inFlightRef.current = true;
    startAttemptedRef.current = true;
    try {
      const session = await createSession.mutateAsync({
        stationId: station.id,
        mode: "self_check",
        timeLimitSeconds: totalSeconds,
        ...(mockExamIdRef.current != null
          ? { mockExamId: mockExamIdRef.current }
          : {}),
        ...(mockExamAttemptIdRef.current != null
          ? { mockExamAttemptId: mockExamAttemptIdRef.current }
          : {}),
      });
      setActiveSessionId(station.id, session.id);
      setSessionId(session.id);
      practiceStartedAtRef.current = Date.now();
      // Q&A stations have no checklist — jump straight to examiner questions.
      const hasSections = station.sections && station.sections.length > 0;
      setPhase(hasSections ? "practice" : "questions");
    } catch (err) {
      // Allow retry on failure
      startAttemptedRef.current = false;
      toast({
        title: "Failed to create session",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    } finally {
      inFlightRef.current = false;
    }
  };

  // Toggle item (cascades to sub-items when toggling a parent)
  const toggleItem = useCallback(
    (itemId: number) => {
      const childIds = flatItems
        .filter((i) => i.parentItemId === itemId)
        .map((i) => i.id);

      setCheckedItems((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) {
          // Uncheck parent + all its sub-items
          next.delete(itemId);
          childIds.forEach((cid) => next.delete(cid));
          setCheckTimestamps((ts) => {
            const newTs = new Map(ts);
            newTs.delete(itemId);
            childIds.forEach((cid) => newTs.delete(cid));
            return newTs;
          });
        } else {
          // Check parent + all its sub-items
          next.add(itemId);
          childIds.forEach((cid) => next.add(cid));
          setCheckTimestamps((ts) => {
            const newTs = new Map(ts);
            newTs.set(itemId, elapsedSeconds);
            childIds.forEach((cid) => {
              if (!newTs.has(cid)) {
                newTs.set(cid, elapsedSeconds);
              }
            });
            return newTs;
          });
        }
        return next;
      });
    },
    [elapsedSeconds, flatItems]
  );

  // Leaf-only scoring: parents are headings and don't contribute their own
  // point. A leaf is any item that isn't a parent of another item in this
  // station. This makes scoring consistent with AI listen mode and avoids
  // the old bug where "Patient information" needed its own check in
  // addition to "Name" and "Age" to reach 100%.
  const parentIdSet = useMemo(() => {
    const s = new Set<number>();
    for (const it of flatItems) {
      if (it.parentItemId != null) s.add(it.parentItemId);
    }
    return s;
  }, [flatItems]);
  const leafItems = useMemo(
    () => flatItems.filter((i) => !parentIdSet.has(i.id)),
    [flatItems, parentIdSet],
  );

  // Compute the session's stored totalScore as the iter10 weighted composite:
  //   checklist 60% + examiner 40% when both exist, else whichever part exists.
  // Unanswered examiner questions count as 0 against the denominator (not
  // "not included"). This is the fix for the "100% on HO station" bug where a
  // user completed checklist but never reached the examiner phase.
  const computeTotalScore = (scores: Map<number, number>): number => {
    const checkedLeaves = leafItems.filter((i) =>
      checkedItems.has(i.id),
    ).length;
    const questions = station?.examinerQuestions ?? [];
    const examinerScores: number[] = [];
    for (const q of questions) {
      const s = scores.get(q.id);
      if (typeof s === "number") examinerScores.push(s);
    }
    const { compositeScore } = computeCompositeScore({
      checklistTotal: leafItems.length,
      checklistCovered: checkedLeaves,
      examinerTotal: questions.length,
      examinerScores,
    });
    return compositeScore;
  };

  // Finalize navigation: if this practice was part of a mock exam attempt,
  // advance the attempt and route to rest / results instead of the
  // single-session results page. iter10: each mock exam is a reusable
  // template and per-run state lives on the attempt row.
  const finalizeNavigation = async (completedSessionId: number) => {
    const mockId = mockExamIdRef.current;
    const attemptId = mockExamAttemptIdRef.current;
    if (mockId == null || attemptId == null) {
      navigate(`/session/${completedSessionId}/results`);
      return;
    }
    try {
      // Read current attempt state so we can pin fromIndex on the
      // advance call. Server will 409 if it disagrees (we reconcile
      // by routing to the detail page, which derives its own state).
      const attemptRes = await fetch(
        `/api/mock-exams/${mockId}/attempts/${attemptId}`,
        { credentials: "include" }
      );
      if (!attemptRes.ok) throw new Error(await attemptRes.text());
      const payload = (await attemptRes.json()) as {
        attempt: { currentStationIndex: number; completedAt: string | null };
      };
      if (payload.attempt.completedAt != null) {
        invalidateMockExamQueries(mockId);
        navigate(`/mock-exam/${mockId}/results?attemptId=${attemptId}`);
        return;
      }
      const fromIndex = payload.attempt.currentStationIndex;
      if (import.meta.env.DEV) {
        console.log(
          `[mock-exam] end session, mockExamId=${mockId}, attemptId=${attemptId}, advancing index from ${fromIndex} to ${fromIndex + 1}`
        );
      }
      const res = await fetch(
        `/api/mock-exams/${mockId}/attempts/${attemptId}/advance`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromIndex }),
        }
      );
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          currentStationIndex?: number;
        };
        invalidateMockExamQueries(mockId);
        if (body.code === "not_in_progress") {
          navigate(`/mock-exam/${mockId}/results?attemptId=${attemptId}`);
          return;
        }
        // stale_from_index → let the runner reconcile.
        navigate(`/mock-exam/${mockId}?attemptId=${attemptId}`);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const body = (await res.json()) as {
        done: boolean;
        stationIndex?: number;
        currentStationId?: number;
      };
      // CRITICAL: invalidate the runner's cached attempt rows so the next
      // mount reads the new currentStationIndex from the server. Without
      // this, the runner would re-use the stale fromIndex and loop back
      // to the station we just finished. This was iter9's bug 2.
      invalidateMockExamQueries(mockId);
      if (import.meta.env.DEV) {
        console.log(
          `[mock-exam] advance response, done=${body.done}, new index=${body.stationIndex ?? "?"}, next station=${body.currentStationId ?? "?"}`
        );
      }
      if (body.done) {
        navigate(`/mock-exam/${mockId}/results?attemptId=${attemptId}`);
      } else {
        navigate(
          `/mock-exam/${mockId}?phase=rest&attemptId=${attemptId}`
        );
      }
    } catch (err) {
      invalidateMockExamQueries(mockId);
      toast({
        title: "Failed to advance mock exam",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
      navigate(`/mock-exam/${mockId}?attemptId=${attemptId}`);
    }
  };

  // Drop any cached mock-exam rows so a subsequent navigation to the
  // runner reads fresh server state (status, currentStationIndex).
  const invalidateMockExamQueries = (mockId: number) => {
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/mock-exams"),
    });
    queryClient.refetchQueries({
      queryKey: [`/api/mock-exams/${mockId}`],
    });
  };

  // End session
  const endSession = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setShowEndDialog(false);

    if (!sessionId || !station) return;

    // Save item results.
    // For parent items (headings with children) we derive coverage from the
    // leaves so they show a ✓ in the results view when all children are
    // checked — even if the user never explicitly clicked the parent row.
    // This mirrors AI listen mode's aggregation and matches the
    // "parents are headings" scoring model.
    const childrenOf = new Map<number, number[]>();
    for (const it of flatItems) {
      if (it.parentItemId != null) {
        const arr = childrenOf.get(it.parentItemId) ?? [];
        arr.push(it.id);
        childrenOf.set(it.parentItemId, arr);
      }
    }
    const isParentChecked = (parentId: number): boolean => {
      const kids = childrenOf.get(parentId) ?? [];
      if (kids.length === 0) return false;
      return kids.every((cid) => checkedItems.has(cid));
    };
    const parentLatestChildTs = (parentId: number): number | undefined => {
      const kids = childrenOf.get(parentId) ?? [];
      let max: number | undefined;
      for (const cid of kids) {
        const ts = checkTimestamps.get(cid);
        if (ts !== undefined && (max === undefined || ts > max)) max = ts;
      }
      return max;
    };

    const results = flatItems.map((it) => {
      const itemId = it.id;
      const isParent = childrenOf.has(itemId);
      const isChecked = isParent
        ? isParentChecked(itemId) || checkedItems.has(itemId)
        : checkedItems.has(itemId);
      const ts = isParent
        ? (parentLatestChildTs(itemId) ?? checkTimestamps.get(itemId))
        : checkTimestamps.get(itemId);
      let status: string;
      if (isChecked && ts !== undefined && ts <= totalSeconds) {
        status = "checked";
      } else if (isChecked && ts !== undefined && ts > totalSeconds) {
        status = "checked_after_time";
      } else if (isChecked) {
        // Parent checked by derivation but no explicit timestamp tracked.
        status = "checked";
      } else {
        status = "missed";
      }
      return {
        itemId,
        status,
        timestampSeconds: ts,
      };
    });

    const totalScore = computeTotalScore(questionScores);
    // Critical check is leaf-only too — a parent heading is not itself a
    // critical action, its children are.
    const criticalMissed = leafItems.some(
      (item) => item.isCritical && !checkedItems.has(item.id)
    );

    try {
      await saveItemResults.mutateAsync({ sessionId, results });
      await updateSession.mutateAsync({
        id: sessionId,
        data: {
          timeUsedSeconds: Math.min(elapsedSeconds, totalSeconds),
          totalScore,
          criticalItemsMissed: criticalMissed,
          endedAt: new Date().toISOString(),
        },
      });
      clearActiveSession(station.id, sessionId);
    } catch (err) {
      toast({
        title: "Failed to save results",
        description: err instanceof Error ? err.message : "Your progress is saved locally.",
        variant: "warning",
      });
    }

    // Move to examiner questions or results
    if (station.examinerQuestions.length > 0) {
      setPhase("questions");
    } else {
      await finalizeNavigation(sessionId);
    }
  };

  // Score a question
  const scoreQuestion = (score: number) => {
    if (!station || isScoringTransition) return;
    const q = [...station.examinerQuestions].sort((a, b) => a.order - b.order)[currentQuestionIdx];
    if (!q) return;
    setIsScoringTransition(true);
    const updatedScores = new Map(questionScores);
    updatedScores.set(q.id, score);
    setQuestionScores(updatedScores);
    setShowQuestionAnswer(false);

    if (currentQuestionIdx < station.examinerQuestions.length - 1) {
      setTimeout(() => {
        setCurrentQuestionIdx((prev) => prev + 1);
        setIsScoringTransition(false);
      }, 150);
    } else {
      finishQuestions(updatedScores).finally(() => setIsScoringTransition(false));
    }
  };

  const finishQuestions = async (scoresOverride?: Map<number, number>) => {
    if (!sessionId || !station) return;
    const scores = scoresOverride ?? questionScores;
    const sortedQuestions = [...station.examinerQuestions].sort(
      (a, b) => a.order - b.order
    );
    const results = sortedQuestions.map((q) => ({
      questionId: q.id,
      score: scores.get(q.id) ?? 0,
    }));

    try {
      await saveQuestionResults.mutateAsync({ sessionId, results });
      // Fold the question scores into the session's aggregate totalScore.
      const totalScore = computeTotalScore(scores);
      // Critical check is leaf-only: parents are headings, their children
      // carry the criticality.
      const criticalMissed = leafItems.some(
        (item) => item.isCritical && !checkedItems.has(item.id)
      );
      await updateSession.mutateAsync({
        id: sessionId,
        data: {
          timeUsedSeconds: Math.min(elapsedSeconds, totalSeconds),
          totalScore,
          criticalItemsMissed: criticalMissed,
          endedAt: new Date().toISOString(),
        },
      });
      clearActiveSession(station.id, sessionId);
    } catch (err) {
      toast({
        title: "Failed to save question results",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
    await finalizeNavigation(sessionId);
  };

  // P0-4: resume/restart prompt rendered as a portal-like overlay so
  // it surfaces regardless of which phase view is currently mounted.
  const resumeDialog = resumePrompt ? (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {resumePrompt.kind === "completed"
              ? "This session is already finished"
              : "You ran past the time limit"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {resumePrompt.kind === "completed"
              ? "We saved your previous run. You can review the results or start a fresh attempt at this station."
              : `Your last attempt was ${formatTime(resumePrompt.elapsedSeconds)} long, past the station's time limit. Resume where you left off, or restart from zero.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onResumeRestart}>
            Start fresh
          </AlertDialogCancel>
          <AlertDialogAction onClick={onResumeContinue}>
            {resumePrompt.kind === "completed" ? "View results" : "Resume"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  if (error || (!isLoading && !station)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-muted-foreground">Could not load station. Try again.</p>
        <Button variant="outline" onClick={() => navigate("/my-stations")}>Back to My Stations</Button>
      </div>
    );
  }

  if (isLoading || !station) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ==================== READING PHASE ====================
  if (phase === "reading") {
    return (
      <>
        <ReadingPhase
          station={station}
          readingTimeSeconds={readingCountdown}
          onBegin={startPractice}
          onCancel={() => navigate(`/station/${station.id}`)}
          isBeginPending={createSession.isPending || inFlightRef.current}
          modeLabel="Self-check"
        />
        {resumeDialog}
      </>
    );
  }

  // ==================== QUESTIONS PHASE ====================
  if (phase === "questions") {
    return (
      <>
        <QuestionsPhase
          station={station}
          currentQuestionIdx={currentQuestionIdx}
          showQuestionAnswer={showQuestionAnswer}
          setShowQuestionAnswer={setShowQuestionAnswer}
          scoreQuestion={scoreQuestion}
          isScoringTransition={isScoringTransition}
          finishQuestions={finishQuestions}
          shouldReduce={!!shouldReduce}
          onEndSession={() => setShowEndDialog(true)}
        />
        <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End session?</AlertDialogTitle>
              <AlertDialogDescription>
                You can't return to this session once ended. Unsaved question
                scores will be discarded.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continue</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setShowEndDialog(false);
                  finishQuestions();
                }}
              >
                End Session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // When the station has examiner questions, "End session" becomes
  // "Go to examiner questions" so users don't fear losing that portion.
  // Click handler is unchanged — `endSession` already routes correctly.
  const hasExaminerQuestions = station.examinerQuestions.length > 0;
  const finishCtaLabel = hasExaminerQuestions
    ? "Go to examiner questions"
    : "End session";

  // ==================== PRACTICE PHASE (IMAGE ID) ====================
  if (station.type === "image_id") {
    return (
      <ImageIdPracticeView
        station={station}
        totalSeconds={totalSeconds}
        elapsedSeconds={elapsedSeconds}
        timeUp={timeUp}
        sectionGroups={sectionGroups}
        checkedItems={checkedItems}
        toggleItem={toggleItem}
        onEndSession={() => setShowEndDialog(true)}
        showEndDialog={showEndDialog}
        setShowEndDialog={setShowEndDialog}
        endSession={endSession}
        flatItems={flatItems}
        finishCtaLabel={finishCtaLabel}
        hasExaminerQuestions={hasExaminerQuestions}
      />
    );
  }

  // ==================== PRACTICE PHASE ====================
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header: timer pill */}
      <div className="sticky top-0 z-30 border-b border-border/40 bg-background/75 backdrop-blur-xl px-5 py-3 safe-top">
        <div className="mx-auto max-w-lg">
          <TimerBar
            totalSeconds={totalSeconds}
            elapsedSeconds={elapsedSeconds}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="flex-1 px-5 py-4 pb-28">
        <div className="mx-auto max-w-lg">
          {sectionGroups.map(([sectionId, group], idx) => {
            const checkedInSection = group.items.filter((i) =>
              checkedItems.has(i.id)
            ).length;

            return (
              <div key={sectionId}>
                <div className={cn("flex items-center justify-between mb-2", idx === 0 ? "mt-0" : "mt-5")}>
                  <h3 className="text-label text-muted-foreground uppercase">
                    {group.title}
                  </h3>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {checkedInSection}/{group.items.length}
                  </span>
                </div>
                {group.imageUrl && (
                  <SectionImage imageUrl={group.imageUrl} imageCaption={group.imageCaption} />
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    // Calculate child count for parent items
                    let childCount = undefined;
                    if (!item.isSubItem) {
                      const children = group.items.filter(
                        (i) => i.parentItemId === item.id
                      );
                      if (children.length > 0) {
                        childCount = {
                          checked: children.filter((c) =>
                            checkedItems.has(c.id)
                          ).length,
                          total: children.length,
                        };
                      }
                    }

                    return (
                      <ChecklistItem
                        key={item.id}
                        text={item.text}
                        status={
                          checkedItems.has(item.id)
                            ? "checked"
                            : ("pending" as ChecklistItemStatus)
                        }
                        isCritical={item.isCritical}
                        isSubItem={item.isSubItem}
                        depth={item.depth}
                        onToggle={() => toggleItem(item.id)}
                        childCount={childCount}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky bottom bar — finish CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-xl bg-background/80 border-t border-border/40 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-lg">
          <Button
            variant={hasExaminerQuestions ? "default" : "outline"}
            onClick={() => setShowEndDialog(true)}
            className="h-12 w-full rounded-full text-[17px] font-semibold transition-transform active:scale-[0.98]"
          >
            {finishCtaLabel}
          </Button>
        </div>
      </div>

      {/* Confirm dialog — label adapts to whether examiner questions follow */}
      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasExaminerQuestions
                ? "Move on to examiner questions?"
                : "End session?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              You've checked <span className="tabular-nums">{checkedItems.size} of {flatItems.length}</span> items.
              {!timeUp && (
                <>
                  {" "}
                  Time remaining: {formatTime(Math.max(totalSeconds - elapsedSeconds, 0))}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Practicing</AlertDialogCancel>
            <AlertDialogAction onClick={endSession}>
              {finishCtaLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {resumeDialog}
    </div>
  );
}

// ==================== QUESTIONS PHASE ====================
function QuestionsPhase({
  station,
  currentQuestionIdx,
  showQuestionAnswer,
  setShowQuestionAnswer,
  scoreQuestion,
  isScoringTransition,
  finishQuestions,
  shouldReduce,
  onEndSession,
}: {
  station: any;
  currentQuestionIdx: number;
  showQuestionAnswer: boolean;
  setShowQuestionAnswer: (v: boolean) => void;
  scoreQuestion: (score: number) => void;
  isScoringTransition: boolean;
  finishQuestions: (scoresOverride?: Map<number, number>) => Promise<void>;
  onEndSession: () => void;
  shouldReduce: boolean;
}) {
  const sortedQuestions = [...station.examinerQuestions].sort(
    (a: any, b: any) => a.order - b.order
  );
  const total = sortedQuestions.length;
  const q = sortedQuestions[currentQuestionIdx];

  // Keyboard shortcuts 1/2/3 when answer revealed — free_text only.
  const qType = (q as any)?.questionType ?? "free_text";
  useEffect(() => {
    if (qType !== "free_text") return;
    if (!showQuestionAnswer) return;
    const handler = (e: KeyboardEvent) => {
      if (isScoringTransition) return;
      if (e.key === "1") scoreQuestion(1.0);
      else if (e.key === "2") scoreQuestion(0.5);
      else if (e.key === "3") scoreQuestion(0);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showQuestionAnswer, scoreQuestion, isScoringTransition, qType]);

  // `finishQuestions` is recreated each parent render; intentionally excluded
  // from deps to avoid re-running this guard. Bug 9's fix already prevents
  // reaching this branch when there are zero questions.
  useEffect(() => {
    if (!q) finishQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  if (!q) return null;

  const Wrapper = shouldReduce ? "div" : motion.div;
  const wrapperProps = shouldReduce
    ? {}
    : { key: currentQuestionIdx, initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 } };
  const progressPct = ((currentQuestionIdx + 1) / total) * 100;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="border-b px-5 py-3 safe-top">
        <div className="mx-auto max-w-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Examiner Questions</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-muted-foreground">
                Question {currentQuestionIdx + 1} of {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={onEndSession}
              >
                End session
              </Button>
            </div>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <Wrapper {...(wrapperProps as any)} className="w-full max-w-lg">
          <QuestionBody
            question={q}
            showAnswer={showQuestionAnswer}
            setShowAnswer={setShowQuestionAnswer}
            scoreQuestion={scoreQuestion}
            isScoringTransition={isScoringTransition}
          />
        </Wrapper>
      </div>
    </div>
  );
}

// Renders the body of one examiner question based on its type.
// Handles: free_text (self-grade), multiple_choice (instant score),
// multi_select (submit then partial credit).
function QuestionBody({
  question,
  showAnswer,
  setShowAnswer,
  scoreQuestion,
  isScoringTransition,
}: {
  question: any;
  showAnswer: boolean;
  setShowAnswer: (v: boolean) => void;
  scoreQuestion: (score: number) => void;
  isScoringTransition: boolean;
}) {
  const qType: "free_text" | "multiple_choice" | "multi_select" =
    question.questionType ?? "free_text";
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [msSelected, setMsSelected] = useState<Set<number>>(new Set());
  const [msSubmitted, setMsSubmitted] = useState(false);

  // Reset local state when question changes
  useEffect(() => {
    setMcSelected(null);
    setMsSelected(new Set());
    setMsSubmitted(false);
  }, [question.id]);

  const image = question.imageUrl ? (
    <img
      src={question.imageUrl}
      alt="Question image"
      className="mb-4 max-h-64 w-full rounded-xl object-contain"
    />
  ) : null;

  if (qType === "multiple_choice") {
    const options: { text: string; isCorrect: boolean }[] =
      question.config?.options ?? [];
    const correctIdx = options.findIndex((o) => o.isCorrect);
    const revealed = mcSelected !== null;
    return (
      <>
        {image}
        <p className="mb-6 text-base font-medium leading-relaxed">{question.question}</p>
        <div className="space-y-2">
          {options.map((opt, i) => {
            const isChosen = mcSelected === i;
            const isCorrect = i === correctIdx;
            let classes = "border-border bg-card";
            if (revealed) {
              if (isCorrect) classes = "border-success/40 bg-success/10 text-success";
              else if (isChosen) classes = "border-destructive/40 bg-destructive/10 text-destructive";
              else classes = "border-border bg-card opacity-70";
            }
            return (
              <button
                key={i}
                type="button"
                disabled={revealed || isScoringTransition}
                onClick={() => setMcSelected(i)}
                className={`w-full rounded-xl border px-4 py-3 text-left text-body transition-smooth hover:border-primary/40 active:scale-[0.99] disabled:cursor-default ${classes}`}
              >
                {opt.text}
              </button>
            );
          })}
        </div>
        {revealed && (
          <div className="mt-6 flex justify-center">
            <Button
              onClick={() => scoreQuestion(mcSelected === correctIdx ? 1.0 : 0)}
              disabled={isScoringTransition}
              size="lg"
            >
              Next
            </Button>
          </div>
        )}
      </>
    );
  }

  if (qType === "multi_select") {
    const options: { text: string; isCorrect: boolean }[] =
      question.config?.options ?? [];
    const correctCount = options.filter((o) => o.isCorrect).length;
    const threshold = question.config?.threshold ?? correctCount;
    const correctHits = Array.from(msSelected).filter((i) => options[i]?.isCorrect).length;
    const score = msSubmitted
      ? Math.min(1, correctHits / Math.max(1, threshold))
      : 0;
    return (
      <>
        {image}
        <p className="mb-2 text-base font-medium leading-relaxed">{question.question}</p>
        <p className="mb-4 text-caption text-muted-foreground">
          Pick at least {threshold} correct option{threshold === 1 ? "" : "s"}.
        </p>
        <div className="space-y-2">
          {options.map((opt, i) => {
            const isChecked = msSelected.has(i);
            let classes = "border-border bg-card";
            if (msSubmitted) {
              if (opt.isCorrect && isChecked) classes = "border-success/40 bg-success/10 text-success";
              else if (opt.isCorrect && !isChecked) classes = "border-success/20 bg-success/5 text-success/80";
              else if (!opt.isCorrect && isChecked) classes = "border-destructive/40 bg-destructive/10 text-destructive";
              else classes = "border-border bg-card opacity-70";
            } else if (isChecked) {
              classes = "border-primary bg-primary/10 text-primary";
            }
            return (
              <button
                key={i}
                type="button"
                disabled={msSubmitted || isScoringTransition}
                onClick={() => {
                  const next = new Set(msSelected);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  setMsSelected(next);
                }}
                className={`w-full rounded-xl border px-4 py-3 text-left text-body transition-smooth active:scale-[0.99] disabled:cursor-default ${classes}`}
              >
                {opt.text}
              </button>
            );
          })}
        </div>
        {!msSubmitted ? (
          <div className="mt-6 flex justify-center">
            <Button
              onClick={() => setMsSubmitted(true)}
              disabled={msSelected.size === 0 || isScoringTransition}
              size="lg"
            >
              Submit
            </Button>
          </div>
        ) : (
          <div className="mt-6">
            <p className="mb-3 text-center text-caption text-muted-foreground">
              You got {correctHits} of {threshold} needed
              {score >= 1 ? " — full credit" : score > 0 ? ` — ${Math.round(score * 100)}% credit` : " — no credit"}.
            </p>
            <div className="flex justify-center">
              <Button
                onClick={() => scoreQuestion(score)}
                disabled={isScoringTransition}
                size="lg"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Free text — existing self-grade flow
  return (
    <>
      {image}
      <p className="mb-8 text-base font-medium leading-relaxed">{question.question}</p>
      {!showAnswer ? (
        <Button variant="outline" size="lg" onClick={() => setShowAnswer(true)} className="mb-6 w-full">
          Reveal Answer
        </Button>
      ) : (
        <div>
          <Card className="mb-6">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-muted-foreground mb-1">Ideal Answer:</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{question.idealAnswer}</p>
            </CardContent>
          </Card>
          <p className="mb-3 text-center text-sm font-medium text-muted-foreground">
            How did you do? <span className="text-xs text-muted-foreground/70">(1 / 2 / 3)</span>
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Button
              variant="outline"
              disabled={isScoringTransition}
              onClick={() => scoreQuestion(1.0)}
              className="flex-col gap-1 h-auto py-3 bg-success/10 text-success border-success/20 hover:bg-success/15"
            >
              <Check className="h-5 w-5" />
              <span className="text-xs">Correct</span>
            </Button>
            <Button
              variant="outline"
              disabled={isScoringTransition}
              onClick={() => scoreQuestion(0.5)}
              className="flex-col gap-1 h-auto py-3 bg-warning/10 text-warning border-warning/20 hover:bg-warning/15"
            >
              <span className="text-lg font-semibold">~</span>
              <span className="text-xs">Partial</span>
            </Button>
            <Button
              variant="outline"
              disabled={isScoringTransition}
              onClick={() => scoreQuestion(0)}
              className="flex-col gap-1 h-auto py-3 bg-warm-100 text-warm-800 border-warm-200 hover:bg-warm-200"
            >
              <X className="h-5 w-5" />
              <span className="text-xs">Incorrect</span>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// ==================== IMAGE ID PRACTICE VIEW ====================
function ImageIdPracticeView({
  station,
  totalSeconds,
  elapsedSeconds,
  timeUp,
  sectionGroups,
  checkedItems,
  toggleItem,
  onEndSession,
  showEndDialog,
  setShowEndDialog,
  endSession,
  flatItems,
  finishCtaLabel,
  hasExaminerQuestions,
}: {
  station: any;
  totalSeconds: number;
  elapsedSeconds: number;
  timeUp: boolean;
  sectionGroups: [number, { title: string; imageUrl?: string | null; imageCaption?: string | null; items: FlatItem[] }][];
  checkedItems: Set<number>;
  toggleItem: (id: number) => void;
  onEndSession: () => void;
  showEndDialog: boolean;
  setShowEndDialog: (v: boolean) => void;
  endSession: () => void;
  flatItems: FlatItem[];
  finishCtaLabel: string;
  hasExaminerQuestions: boolean;
}) {
  const referenceImageUrl: string | null = station.referenceImageUrl ?? null;
  const referenceImageCaption: string | null = station.referenceImageCaption ?? null;

  // Bottom sheet snap points (fraction of viewport height)
  const SNAPS = [0.45, 0.75, 0.95];
  const [snapIdx, setSnapIdx] = useState(0);
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(t);
  }, []);

  const sheetHeight = referenceImageUrl ? vh * SNAPS[snapIdx] : vh;

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-border/40 bg-background/75 backdrop-blur-xl px-5 py-3 safe-top">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center gap-3">
            <TimerBar
              totalSeconds={totalSeconds}
              elapsedSeconds={elapsedSeconds}
              className="flex-1"
            />
            <Button
              variant={hasExaminerQuestions ? "default" : "outline"}
              size="sm"
              onClick={onEndSession}
              className="rounded-full"
            >
              {finishCtaLabel}
            </Button>
          </div>
        </div>
      </div>

      {/* Reference image top ~40% — only when image is present */}
      {referenceImageUrl && (
        <div
          className="relative w-full bg-black/90 flex items-center justify-center"
          style={{ height: "40vh", minHeight: 220 }}
        >
          <TransformWrapper doubleClick={{ mode: "toggle" }} minScale={1} maxScale={5}>
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              contentStyle={{ width: "100%", height: "100%" }}
            >
              <img
                src={referenceImageUrl}
                alt={referenceImageCaption || "Reference image"}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </TransformComponent>
          </TransformWrapper>
          <AnimatePresence>
            {showHint && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/90"
              >
                Pinch or double-tap to zoom
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Caption */}
      {referenceImageCaption && (
        <div className="px-5 py-2 text-center text-xs text-muted-foreground">
          {referenceImageCaption}
        </div>
      )}

      {/* Draggable bottom sheet */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.15}
        onDragEnd={(_, info) => {
          const delta = info.offset.y;
          // Up = negative delta → larger sheet
          if (delta < -40 && snapIdx < SNAPS.length - 1) {
            setSnapIdx(snapIdx + 1);
          } else if (delta > 40 && snapIdx > 0) {
            setSnapIdx(snapIdx - 1);
          }
        }}
        animate={{ height: sheetHeight }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
        className="fixed bottom-0 left-0 right-0 z-40 rounded-t-[28px] border-t border-border/60 bg-card shadow-lg flex flex-col"
        style={{ touchAction: "none" }}
      >
        <div className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
          <div className="h-[5px] w-9 rounded-full bg-border" />
        </div>
        <div className="px-5 pb-2">
          <div className="flex items-center justify-between">
            <p className="text-label text-muted-foreground uppercase">
              Checklist · {checkedItems.size}/{flatItems.length}
            </p>
          </div>
          {!referenceImageUrl && (
            <p className="mt-1 text-caption text-muted-foreground">
              Image-ID station without reference image.
            </p>
          )}
        </div>
        <div
          className="flex-1 overflow-y-auto px-5 pb-8"
          style={{ touchAction: "pan-y" }}
          onPointerDownCapture={(e) => e.stopPropagation()}
        >
          <div className="space-y-6">
            {sectionGroups.map(([sectionId, group]) => {
              const checkedInSection = group.items.filter((i) =>
                checkedItems.has(i.id)
              ).length;
              return (
                <div key={sectionId}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-label text-muted-foreground uppercase">
                      {group.title}
                    </h3>
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {checkedInSection}/{group.items.length}
                    </span>
                  </div>
                  {group.imageUrl && (
                    <SectionImage imageUrl={group.imageUrl} imageCaption={group.imageCaption} />
                  )}
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      let childCount: { checked: number; total: number } | undefined;
                      if (!item.isSubItem) {
                        const children = group.items.filter(
                          (i) => i.parentItemId === item.id
                        );
                        if (children.length > 0) {
                          childCount = {
                            checked: children.filter((c) => checkedItems.has(c.id)).length,
                            total: children.length,
                          };
                        }
                      }
                      return (
                        <ChecklistItem
                          key={item.id}
                          text={item.text}
                          status={
                            checkedItems.has(item.id)
                              ? "checked"
                              : ("pending" as ChecklistItemStatus)
                          }
                          isCritical={item.isCritical}
                          isSubItem={item.isSubItem}
                        depth={item.depth}
                          onToggle={() => toggleItem(item.id)}
                          childCount={childCount}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* Confirm dialog — label adapts to whether examiner questions follow */}
      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasExaminerQuestions
                ? "Move on to examiner questions?"
                : "End session?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              You've checked{" "}
              <span className="tabular-nums">
                {checkedItems.size} of {flatItems.length}
              </span>{" "}
              items.
              {!timeUp && (
                <>
                  {" "}
                  Time remaining:{" "}
                  {formatTime(Math.max(totalSeconds - elapsedSeconds, 0))}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Practicing</AlertDialogCancel>
            <AlertDialogAction onClick={endSession}>{finishCtaLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SectionImage({
  imageUrl,
  imageCaption,
}: {
  imageUrl: string;
  imageCaption?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {expanded ? "Hide image" : "Show image"}
      </button>
      {expanded && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-border/60">
          <img src={imageUrl} alt={imageCaption || "Section image"} className="w-full object-contain max-h-48" />
          {imageCaption && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{imageCaption}</p>
          )}
        </div>
      )}
    </div>
  );
}
