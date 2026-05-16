import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Square, Volume2, VolumeX, Volume, Pause, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionTimerRing } from "@/components/SessionTimerRing";
import { MicButton } from "@/components/practice/MicButton";
import { cn } from "@/lib/utils";

export type ExaminerQuestion = {
  id: number;
  question: string;
  questionType: "free_text" | "checklist" | "multiple_choice" | "multi_select";
  idealAnswer: string | null;
  keyPoints: string[];
  config: any;
  imageUrl?: string | null;
  order: number;
};

export type CoverageEntry = {
  score: number;
  pointResults?: Array<{ point: string; status: "present" | "missed" }>;
};

export type TapAnswer = {
  selectedIndex?: number;
  selectedIndexes?: number[];
  submitted?: boolean;
  score: number;
};

const LIVE_CHECK_INTERVAL_MS = 10_000;
const LIVE_CHECK_TRANSCRIPT_DELTA = 15; // chars added since last grading
const AUTO_ADVANCE_DELAY_MS = 600;
const FREE_TEXT_COMPLETE_THRESHOLD = 0.7;
const CHECKLIST_COMPLETE_RATIO = 0.6; // 60% of keypoints covered = advance
const IDLE_ADVANCE_AFTER_MS = 25_000; // no transcript growth → consider done

export function ExaminerNarrationPhase({
  sessionId,
  questions,
  audioElRef,
  narration,
  totalSeconds,
  elapsedSeconds,
  timerVisibility,
  isListenMuted,
  setIsListenMuted,
  ttsMuted,
  setTtsMuted,
  coverage,
  setCoverage,
  tapAnswers,
  setTapAnswers,
  onPause,
  onEndSession,
  onDiscardSession,
}: {
  sessionId: number | null;
  questions: ExaminerQuestion[];
  // Pre-warmed audio element minted in the Begin tap so .play() works
  // without an extra user gesture in this phase.
  audioElRef: React.MutableRefObject<HTMLAudioElement | null>;
  narration: {
    transcript: string;
    isListening: boolean;
    isTranscribing: boolean;
    chunkError: string | null;
    analyser?: AnalyserNode | null;
  };
  totalSeconds: number;
  elapsedSeconds: number;
  timerVisibility: { hidden: boolean; toggle: () => void };
  isListenMuted: boolean;
  setIsListenMuted: (v: boolean | ((p: boolean) => boolean)) => void;
  ttsMuted: boolean;
  setTtsMuted: (v: boolean | ((p: boolean) => boolean)) => void;
  coverage: Map<number, CoverageEntry>;
  setCoverage: (
    updater: (prev: Map<number, CoverageEntry>) => Map<number, CoverageEntry>,
  ) => void;
  tapAnswers: Map<number, TapAnswer>;
  setTapAnswers: (
    updater: (prev: Map<number, TapAnswer>) => Map<number, TapAnswer>,
  ) => void;
  onPause: () => void;
  onEndSession: () => void;
  onDiscardSession: () => void;
}) {
  const [focusIdx, setFocusIdx] = useState(0);
  const focusedQuestion = questions[focusIdx];

  // Karaoke reveal: word count revealed for the focused question
  const [revealedWords, setRevealedWords] = useState(0);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [ttsBlocked, setTtsBlocked] = useState(false);

  const audioObjectUrlRef = useRef<string | null>(null);
  const karaokeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  const cleanupAudio = useCallback(() => {
    if (karaokeTimerRef.current) {
      clearInterval(karaokeTimerRef.current);
      karaokeTimerRef.current = null;
    }
    const el = audioElRef.current;
    if (el) {
      try {
        el.pause();
      } catch {
        // ignore
      }
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    setIsTtsPlaying(false);
  }, [audioElRef]);

  // Stash for the prefetched blob URL of the focused question, so the
  // "Tap to hear" pill can play() SYNCHRONOUSLY inside its click handler —
  // no await between the user gesture and audio.play(). Without this the
  // pill click loses its gesture activation while await fetch runs.
  const pendingTtsUrlRef = useRef<string | null>(null);
  const pendingWordCountRef = useRef<number>(0);

  // Wire karaoke timer + autoplay attempt for whatever URL is currently in
  // pendingTtsUrlRef. Separated so the synchronous click path can invoke
  // it without any awaits.
  const armAudioForCurrentBlob = useCallback(() => {
    const audio = audioElRef.current;
    const url = pendingTtsUrlRef.current;
    if (!audio || !url) return false;
    const wordCount = pendingWordCountRef.current;
    audio.muted = false;
    audio.volume = 1;
    audio.src = url;
    try {
      audio.currentTime = 0;
    } catch {
      // some browsers throw before the resource loads
    }
    const beginKaraoke = () => {
      const dur =
        isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : wordCount * 0.35;
      const intervalMs = Math.max(80, (dur * 1000) / Math.max(1, wordCount));
      let revealed = 0;
      if (karaokeTimerRef.current) clearInterval(karaokeTimerRef.current);
      setIsTtsPlaying(true);
      karaokeTimerRef.current = setInterval(() => {
        revealed += 1;
        setRevealedWords(revealed);
        if (revealed >= wordCount && karaokeTimerRef.current) {
          clearInterval(karaokeTimerRef.current);
          karaokeTimerRef.current = null;
        }
      }, intervalMs);
    };
    const onEnded = () => {
      setRevealedWords(wordCount);
      setIsTtsPlaying(false);
      audio.removeEventListener("canplaythrough", beginKaraoke);
      audio.removeEventListener("ended", onEnded);
    };
    audio.addEventListener("canplaythrough", beginKaraoke, { once: true });
    audio.addEventListener("ended", onEnded);
    // CRITICAL: do NOT await — the caller may be a click handler whose
    // gesture-activation will expire if we yield to the microtask queue.
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise
        .then(() => setTtsBlocked(false))
        .catch((err) => {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn(
              "[ExaminerNarrationPhase] audio.play() blocked",
              err,
            );
          }
          setIsTtsPlaying(false);
          setTtsBlocked(true);
        });
    }
    return true;
  }, [audioElRef]);

  // Prefetch (or refetch) TTS for the focused question and stash the blob
  // URL. Then attempt a non-awaited play; if blocked, the pill surfaces.
  const prefetchAndPlay = useCallback(
    async (q: ExaminerQuestion) => {
      cleanupAudio();
      const wordCount = q.question.trim().split(/\s+/).filter(Boolean).length;
      pendingWordCountRef.current = wordCount;
      if (!sessionId || ttsMuted) {
        setRevealedWords(wordCount);
        return;
      }
      setRevealedWords(0);
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      try {
        const res = await fetch(`/api/practice/${sessionId}/tts`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: q.question }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn(
              "[ExaminerNarrationPhase] tts endpoint failed",
              res.status,
            );
          }
          throw new Error(`tts_${res.status}`);
        }
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        // Replace previous pending URL (revoke happens in cleanupAudio).
        pendingTtsUrlRef.current = url;
        audioObjectUrlRef.current = url;
        if (!audioElRef.current) {
          setRevealedWords(wordCount);
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn(
              "[ExaminerNarrationPhase] no prewarmed audio element — pill must be tapped to hear",
            );
          }
          setTtsBlocked(true);
          return;
        }
        // Try autoplay (will succeed only if the audio element is still
        // gesture-unlocked from the parent's Begin tap). If it rejects,
        // armAudioForCurrentBlob sets ttsBlocked so the pill surfaces.
        armAudioForCurrentBlob();
      } catch {
        setRevealedWords(wordCount);
        setIsTtsPlaying(false);
      }
    },
    [cleanupAudio, sessionId, ttsMuted, audioElRef, armAudioForCurrentBlob],
  );

  // The pill click handler. SYNCHRONOUS — no awaits. Replays whatever
  // blob is currently stashed so play() inherits this click's gesture.
  const playStashedSync = useCallback(() => {
    if (!pendingTtsUrlRef.current) return;
    // Reset reveal so the karaoke runs again from word 0.
    setRevealedWords(0);
    setTtsBlocked(false);
    armAudioForCurrentBlob();
  }, [armAudioForCurrentBlob]);

  // Fetch TTS for the focused question on every focus change.
  useEffect(() => {
    if (!focusedQuestion) return;
    void prefetchAndPlay(focusedQuestion);
    return () => {
      cleanupAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedQuestion?.id]);

  useEffect(() => {
    return () => cleanupAudio();
  }, [cleanupAudio]);

  // ─── Silent grading: drives auto-advance only — never rendered ─────────
  const gradableQuestions = useMemo(
    () =>
      questions.filter(
        (q) => q.questionType === "free_text" || q.questionType === "checklist",
      ),
    [questions],
  );

  const transcriptRef = useRef("");
  transcriptRef.current = narration.transcript;

  const postCheck = useCallback(async () => {
    if (!sessionId) return;
    if (gradableQuestions.length === 0) return;
    const transcript = transcriptRef.current.trim();
    if (!transcript) return;
    try {
      const res = await fetch(`/api/practice/${sessionId}/examiner-check`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          questions: gradableQuestions.map((q) => ({
            id: q.id,
            questionType: q.questionType,
            question: q.question,
            idealAnswer: q.idealAnswer ?? null,
            keyPoints: q.keyPoints ?? [],
          })),
        }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        items?: Array<{
          questionId: number;
          score: number;
          pointResults?: Array<{ point: string; status: "present" | "missed" }>;
          match?: string;
        }>;
      };
      const items = body.items ?? [];
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[ExaminerNarrationPhase] postCheck items", {
          transcriptLen: transcript.length,
          itemCount: items.length,
          scores: items.map((it) => ({ id: it.questionId, s: it.score })),
        });
      }
      if (items.length === 0) return;
      setCoverage((prev) => {
        const next = new Map(prev);
        for (const it of items) {
          const existing = next.get(it.questionId);
          if (!existing || it.score > existing.score || it.pointResults) {
            next.set(it.questionId, {
              score: it.score,
              pointResults: it.pointResults,
            });
          }
        }
        return next;
      });
    } catch {
      // Silent — auto-advance just won't fire this tick.
    }
  }, [gradableQuestions, sessionId, setCoverage]);

  // CRITICAL: the 10s interval must NOT have `postCheck` in deps. postCheck
  // is rebuilt whenever `gradableQuestions` changes, and gradableQuestions
  // is recreated when the parent re-renders (which it does every second
  // for the timer tick). With postCheck in deps the interval gets torn
  // down and re-armed every render, and never reaches 10s of wall-time.
  // Use a ref to call the latest postCheck without retriggering the effect.
  const postCheckRef = useRef(postCheck);
  postCheckRef.current = postCheck;
  useEffect(() => {
    if (!sessionId) return;
    void postCheckRef.current();
    const id = setInterval(() => void postCheckRef.current(), LIVE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sessionId]);

  // Fire on every transcribing→idle edge. Each completed Whisper chunk is
  // worth grading; we don't gate on a chars delta so the very first short
  // chunk (e.g. ~50 chars from a 5-second answer) still triggers grading.
  const prevTranscribingRef = useRef(false);
  useEffect(() => {
    const was = prevTranscribingRef.current;
    prevTranscribingRef.current = narration.isTranscribing;
    if (was && !narration.isTranscribing) {
      void postCheckRef.current();
    }
  }, [narration.isTranscribing]);

  // Belt-and-suspenders: also fire when transcript has grown by ≥15 chars
  // since the last check. Catches cases where isTranscribing toggles
  // weren't observed (rapid back-to-back chunks).
  const lastCheckedLenRef = useRef(0);
  useEffect(() => {
    if (narration.isTranscribing) return;
    const len = narration.transcript.length;
    if (len - lastCheckedLenRef.current < LIVE_CHECK_TRANSCRIPT_DELTA) return;
    lastCheckedLenRef.current = len;
    void postCheckRef.current();
  }, [narration.transcript, narration.isTranscribing]);

  // Coverage stats for a checklist Q — used both for the auto-advance gate
  // and the on-card progress signal.
  const checklistCoverage = useCallback(
    (q: ExaminerQuestion): { covered: number; total: number } => {
      const c = coverage.get(q.id);
      const kp = q.keyPoints ?? [];
      if (kp.length === 0 || !c?.pointResults)
        return { covered: 0, total: kp.length };
      const presentSet = new Set(
        c.pointResults
          .filter((p) => p.status === "present")
          .map((p) => p.point),
      );
      const covered = kp.filter((p) => presentSet.has(p)).length;
      return { covered, total: kp.length };
    },
    [coverage],
  );

  // ─── Completion threshold + auto-advance ───────────────────────────────
  // Voice + Whisper imprecision means demanding 100% checklist coverage is
  // unreachable. 60% is a reasonable "answered enough to move on" bar; the
  // results page still grades on true coverage.
  const isQuestionComplete = useCallback(
    (q: ExaminerQuestion): boolean => {
      if (q.questionType === "free_text") {
        const c = coverage.get(q.id);
        return !!c && c.score >= FREE_TEXT_COMPLETE_THRESHOLD;
      }
      if (q.questionType === "checklist") {
        const { covered, total } = checklistCoverage(q);
        if (total === 0) return false;
        return covered / total >= CHECKLIST_COMPLETE_RATIO;
      }
      if (
        q.questionType === "multiple_choice" ||
        q.questionType === "multi_select"
      ) {
        return !!tapAnswers.get(q.id)?.submitted;
      }
      return false;
    },
    [coverage, tapAnswers, checklistCoverage],
  );

  const autoAdvancedFromRef = useRef<Set<number>>(new Set());
  // Reset the "already advanced from" set whenever the questions list
  // identity changes (different station / fresh session). Prevents a
  // ref polluted by stale question ids from blocking new advances.
  useEffect(() => {
    autoAdvancedFromRef.current = new Set();
  }, [questions]);

  // Idle-advance fallback: if the user has spoken something for the
  // focused question but the transcript hasn't grown for IDLE_ADVANCE_AFTER_MS,
  // assume they're done (or stuck) and advance. Catches unreachable-checklist
  // gates and "I think I'm done" UX cases.
  const focusBaselineLenRef = useRef(0);
  const lastGrowthAtRef = useRef(Date.now());
  useEffect(() => {
    // Reset growth tracking on each focus change.
    focusBaselineLenRef.current = narration.transcript.length;
    lastGrowthAtRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedQuestion?.id]);
  useEffect(() => {
    if (narration.transcript.length > focusBaselineLenRef.current) {
      lastGrowthAtRef.current = Date.now();
    }
  }, [narration.transcript]);
  useEffect(() => {
    if (!focusedQuestion) return;
    // Only idle-advance for spoken question types.
    if (
      focusedQuestion.questionType !== "free_text" &&
      focusedQuestion.questionType !== "checklist"
    )
      return;
    const interval = setInterval(() => {
      if (!focusedQuestion) return;
      if (autoAdvancedFromRef.current.has(focusedQuestion.id)) return;
      const grewSinceFocus =
        narration.transcript.length > focusBaselineLenRef.current + 20;
      if (!grewSinceFocus) return;
      const idleMs = Date.now() - lastGrowthAtRef.current;
      if (idleMs < IDLE_ADVANCE_AFTER_MS) return;
      const nextIdx = questions.findIndex(
        (q, i) => i > focusIdx && !isQuestionComplete(q),
      );
      if (nextIdx < 0) return;
      autoAdvancedFromRef.current.add(focusedQuestion.id);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[ExaminerNarrationPhase] idle auto-advance fired", {
          from: focusedQuestion.id,
          toIdx: nextIdx,
          idleMs,
        });
      }
      setFocusIdx(nextIdx);
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedQuestion?.id, focusedQuestion?.questionType]);

  useEffect(() => {
    if (!focusedQuestion) return;
    if (!isQuestionComplete(focusedQuestion)) return;
    if (autoAdvancedFromRef.current.has(focusedQuestion.id)) return;
    const nextIdx = questions.findIndex(
      (q, i) => i > focusIdx && !isQuestionComplete(q),
    );
    autoAdvancedFromRef.current.add(focusedQuestion.id);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[ExaminerNarrationPhase] auto-advance fired", {
        from: focusedQuestion.id,
        toIdx: nextIdx,
        focusIdx,
      });
    }
    if (nextIdx < 0) return; // last question — stay; user taps End when ready.
    const t = setTimeout(() => setFocusIdx(nextIdx), AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [coverage, tapAnswers, focusIdx, focusedQuestion, questions, isQuestionComplete]);

  // ─── Tap handlers (MCQ / multi-select) ─────────────────────────────────
  const handleMcTap = useCallback(
    (q: ExaminerQuestion, optionIndex: number) => {
      const options: { text: string; isCorrect: boolean }[] = q.config?.options ?? [];
      const correctIdx = options.findIndex((o) => o.isCorrect);
      const score = optionIndex === correctIdx ? 1 : 0;
      setTapAnswers((prev) => {
        const next = new Map(prev);
        next.set(q.id, { selectedIndex: optionIndex, submitted: true, score });
        return next;
      });
    },
    [setTapAnswers],
  );

  const handleMsToggle = useCallback(
    (q: ExaminerQuestion, optionIndex: number) => {
      setTapAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(q.id);
        if (existing?.submitted) return prev;
        const cur = new Set(existing?.selectedIndexes ?? []);
        if (cur.has(optionIndex)) cur.delete(optionIndex);
        else cur.add(optionIndex);
        next.set(q.id, {
          selectedIndexes: Array.from(cur),
          submitted: false,
          score: 0,
        });
        return next;
      });
    },
    [setTapAnswers],
  );

  const handleMsSubmit = useCallback(
    (q: ExaminerQuestion) => {
      const options: { text: string; isCorrect: boolean }[] = q.config?.options ?? [];
      const correctCount = options.filter((o) => o.isCorrect).length;
      const threshold = (q.config?.threshold ?? correctCount) as number;
      setTapAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(q.id);
        const selected = existing?.selectedIndexes ?? [];
        const correctHits = selected.filter((i) => options[i]?.isCorrect).length;
        const score = Math.min(1, correctHits / Math.max(1, threshold));
        next.set(q.id, {
          selectedIndexes: selected,
          submitted: true,
          score,
        });
        return next;
      });
    },
    [setTapAnswers],
  );

  // ─── Manual skip — escape hatch if STT undershoots ─────────────────────
  const goNext = useCallback(() => {
    if (!focusedQuestion) return;
    autoAdvancedFromRef.current.add(focusedQuestion.id);
    const nextIdx = focusIdx + 1;
    if (nextIdx >= questions.length) return;
    setFocusIdx(nextIdx);
  }, [focusedQuestion, focusIdx, questions.length]);

  // ─── Render ────────────────────────────────────────────────────────────
  if (!focusedQuestion) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-body text-muted-foreground">No questions to examine.</p>
      </div>
    );
  }

  const words = focusedQuestion.question.trim().split(/\s+/).filter(Boolean);
  const showCursor = isTtsPlaying && revealedWords < words.length;

  const micState = isListenMuted
    ? "idle"
    : narration.isTranscribing
      ? "processing"
      : narration.isListening
        ? "listening"
        : "idle";

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top status strip — minimal, single line */}
      <div className="flex items-center justify-center gap-2 px-5 pt-6 pb-1">
        <span className="relative inline-flex h-2 w-2" aria-hidden>
          {!isListenMuted && narration.isListening && (
            <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              isListenMuted
                ? "bg-muted-foreground"
                : narration.isTranscribing
                  ? "bg-brand-accent"
                  : "bg-success",
            )}
          />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {isListenMuted
            ? "Muted"
            : narration.isTranscribing
              ? "Processing…"
              : narration.isListening
                ? "Listening…"
                : "Starting…"}
        </span>
        {narration.chunkError && (
          <span
            aria-label="Reconnecting"
            className="ml-2 h-1.5 w-1.5 rounded-full bg-brand-accent"
          />
        )}
      </div>

      {/* Timer ring */}
      <div className="px-5 pb-2">
        <SessionTimerRing
          totalSeconds={totalSeconds}
          elapsedSeconds={elapsedSeconds}
          hidden={timerVisibility.hidden}
          onToggleHide={timerVisibility.toggle}
        />
      </div>

      {/* Hero question — single Q at a time, no rubric exposed */}
      <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-label uppercase text-muted-foreground">Examiner</p>
          <span className="text-caption tabular-nums text-muted-foreground">
            {focusIdx + 1} / {questions.length}
          </span>
        </div>

        {focusedQuestion.imageUrl && (
          <img
            src={focusedQuestion.imageUrl}
            alt=""
            className="mb-4 max-h-56 w-full rounded-xl object-contain"
          />
        )}

        <p
          className="text-h2 font-display leading-tight text-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {words.map((w, i) => (
            <span
              key={i}
              className={cn(
                "transition-opacity duration-200",
                i < revealedWords ? "opacity-100" : "opacity-30",
              )}
            >
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
          {showCursor && (
            <span className="ml-1 inline-block h-5 w-1.5 animate-pulse rounded-sm bg-brand-accent align-middle" />
          )}
        </p>

        {/* Fallback when the browser blocked audio anyway — surfaces a
            tap-to-hear button so the user can retry in-gesture. The
            handler MUST be synchronous: any await between the click and
            audio.play() expires the gesture-activation token. */}
        {ttsBlocked && !ttsMuted && (
          <button
            type="button"
            onClick={playStashedSync}
            className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted/80"
          >
            <Volume className="h-3.5 w-3.5" />
            Tap to hear the question
          </button>
        )}

        {/* Coverage progress signal for checklist Qs — count only, no
            keypoint text exposed. Tells the user they're making progress
            (or aren't yet) without revealing the rubric. */}
        {focusedQuestion.questionType === "checklist" &&
          (focusedQuestion.keyPoints?.length ?? 0) > 0 &&
          (() => {
            const { covered, total } = checklistCoverage(focusedQuestion);
            return (
              <p className="mt-4 text-caption text-muted-foreground">
                <span className="tabular-nums font-medium text-foreground">
                  {covered}
                </span>{" "}
                of {total} points covered
              </p>
            );
          })()}

        {/* MCQ / multi-select tap area — no grading reveal until results */}
        {focusedQuestion.questionType === "multiple_choice" &&
          (() => {
            const options: { text: string; isCorrect: boolean }[] =
              focusedQuestion.config?.options ?? [];
            const tap = tapAnswers.get(focusedQuestion.id);
            const submitted = !!tap?.submitted;
            return (
              <div className="mt-6 space-y-2.5">
                {options.map((opt, i) => {
                  const isChosen = tap?.selectedIndex === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleMcTap(focusedQuestion, i)}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left text-[15px] transition-smooth active:scale-[0.99] disabled:cursor-default",
                        submitted && isChosen
                          ? "border-primary bg-primary/10 text-foreground"
                          : submitted
                            ? "border-border bg-card opacity-60"
                            : isChosen
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            );
          })()}

        {focusedQuestion.questionType === "multi_select" &&
          (() => {
            const options: { text: string; isCorrect: boolean }[] =
              focusedQuestion.config?.options ?? [];
            const correctCount = options.filter((o) => o.isCorrect).length;
            const threshold = (focusedQuestion.config?.threshold ?? correctCount) as number;
            const tap = tapAnswers.get(focusedQuestion.id);
            const submitted = !!tap?.submitted;
            const selected = new Set(tap?.selectedIndexes ?? []);
            return (
              <div className="mt-6 space-y-2.5">
                <p className="text-caption text-muted-foreground">
                  Pick at least {threshold} option
                  {threshold === 1 ? "" : "s"}.
                </p>
                {options.map((opt, i) => {
                  const isChecked = selected.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleMsToggle(focusedQuestion, i)}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left text-[15px] transition-smooth active:scale-[0.99] disabled:cursor-default",
                        submitted && isChecked
                          ? "border-primary bg-primary/10 text-foreground"
                          : submitted
                            ? "border-border bg-card opacity-60"
                            : isChecked
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      {opt.text}
                    </button>
                  );
                })}
                {!submitted && (
                  <Button
                    size="sm"
                    onClick={() => handleMsSubmit(focusedQuestion)}
                    disabled={selected.size === 0}
                    className="mt-2 rounded-full"
                  >
                    Submit
                  </Button>
                )}
              </div>
            );
          })()}

        {/* Skip — escape hatch when STT undershoots on free_text / checklist */}
        {focusIdx < questions.length - 1 &&
          (focusedQuestion.questionType === "free_text" ||
            focusedQuestion.questionType === "checklist") && (
            <Button
              variant="outline"
              size="sm"
              onClick={goNext}
              className="mt-6 self-start gap-1.5 rounded-full"
            >
              Next question
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
      </div>

      {/* Bottom bar — mirrors Gemini Live examiner layout */}
      <div className="border-t border-border/60 bg-background/80 px-5 pt-5 pb-6 backdrop-blur-xl">
        <div className="flex items-center justify-center gap-5">
          <button
            onClick={() => setIsListenMuted((v) => !v)}
            aria-label={isListenMuted ? "Unmute mic" : "Mute mic"}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.96]",
              isListenMuted
                ? "bg-muted text-muted-foreground"
                : "bg-transparent text-foreground hover:bg-muted",
            )}
          >
            {isListenMuted ? (
              <VolumeX className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </button>

          <MicButton
            state={micState}
            onClick={() => setIsListenMuted((v) => !v)}
            analyser={narration.analyser ?? null}
            className="h-[72px] w-[72px]"
          />

          <button
            onClick={() => {
              setTtsMuted((v) => {
                const next = !v;
                if (next) cleanupAudio();
                return next;
              });
            }}
            aria-label={ttsMuted ? "Unmute readout" : "Mute readout"}
            title={ttsMuted ? "Read-aloud off" : "Read-aloud on"}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.96]",
              ttsMuted
                ? "bg-muted text-muted-foreground"
                : "bg-transparent text-foreground hover:bg-muted",
            )}
          >
            <Volume className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={onPause}
            className="h-10 rounded-full gap-1.5 px-4 text-[13px]"
          >
            <Pause className="h-3.5 w-3.5" />
            Pause
          </Button>
          <Button
            variant="default"
            onClick={onEndSession}
            className="h-10 rounded-full gap-1.5 px-5 text-[13px] font-semibold"
          >
            <Square className="h-3 w-3" />
            End session
          </Button>
        </div>

        <div className="mt-3 flex items-center justify-center">
          <button
            type="button"
            onClick={onDiscardSession}
            className="text-caption text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline"
          >
            Discard session
          </button>
        </div>
      </div>
    </div>
  );
}
