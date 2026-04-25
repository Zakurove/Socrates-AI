import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaRecorder } from "./useMediaRecorder";
import {
  useChecklistMatcher,
  type ChecklistTreeNode,
} from "./useChecklistMatcher";

const TRIGGER_PHRASES = [
  "i'm done",
  "i am done",
  "finished examination",
  "finished exam",
  "end examination",
  "end exam",
];

/**
 * Hard ceiling on a single narration session. If a station legitimately needs
 * 20+ minutes, this covers it with margin. At ceiling we stop recording and
 * emit a distinct state so the UI can surface "Session time up" instead of a
 * destructive error.
 */
const MAX_SESSION_MS = 30 * 60 * 1000;

interface UseNarrationModeProps {
  /**
   * Checklist tree for the active station. Used to distinguish leaves
   * (which the LLM grades + contribute to the score) from parents
   * (headings, derived from leaves). Pass an empty array before the
   * station is loaded — the hook is safe.
   */
  tree: ChecklistTreeNode[];
}

interface UseNarrationModeReturn {
  transcript: string;
  isListening: boolean;
  isTranscribing: boolean;
  start: (sessionId: number) => Promise<void>;
  stop: () => void;
  triggerDetected: boolean;
  resetTrigger: () => void;
  /**
   * Coverage for every node in the checklist tree (leaves + parent headings).
   * Parents are derived client-side from the monotonic leaf state so a
   * heading goes ✓ as soon as all of its children are covered — no need for
   * the student to verbally say the heading text itself.
   */
  checkResults: Map<number, { covered: boolean; confidence: number }>;
  /** Leaf-only covered count (parents are headings, not scored). */
  coveredCount: number;
  /** Leaf-only total (the score denominator). */
  totalLeaves: number;
  isChecking: boolean;
  /**
   * Fatal error — recording could not start or was revoked. The UI should
   * surface this (e.g., toast) because the session can no longer proceed.
   */
  error: string | null;
  /**
   * Non-fatal per-chunk issue (e.g., one Whisper request failed, silence,
   * transient network). Recording keeps going. UI should show a subtle
   * indicator (amber dot) next to the timer, not a destructive toast.
   */
  chunkError: string | null;
  /**
   * True once the hard session ceiling is reached. UI should show a graceful
   * "Session time up" message and transition out of listening.
   */
  sessionTimeUp: boolean;
  analyser: AnalyserNode | null;
}

export function useNarrationMode(
  props: UseNarrationModeProps,
): UseNarrationModeReturn {
  const { tree } = props;

  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [triggerDetected, setTriggerDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [sessionTimeUp, setSessionTimeUp] = useState(false);

  const sessionIdRef = useRef<number | null>(null);
  const transcriptRef = useRef("");
  const mountedRef = useRef(true);
  const sessionCeilingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const {
    results: checkResults,
    coveredCount,
    totalItems: totalLeaves,
    isChecking,
    runCheck,
    setTree,
  } = useChecklistMatcher();

  // Keep the tree in sync with the caller.
  useEffect(() => {
    setTree(tree);
  }, [tree, setTree]);

  // Track mounted state for async safety.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (sessionCeilingTimerRef.current) {
        clearTimeout(sessionCeilingTimerRef.current);
        sessionCeilingTimerRef.current = null;
      }
    };
  }, []);

  const handleChunk = useCallback(
    async (blob: Blob) => {
      const sid = sessionIdRef.current;
      if (sid === null) return;
      // Ignore tiny blobs — Whisper rejects very short audio as invalid.
      if (blob.size < 1024) return;

      setIsTranscribing(true);

      try {
        const arrayBuffer = await blob.arrayBuffer();

        const res = await fetch(`/api/practice/${sid}/transcribe`, {
          method: "POST",
          headers: {
            // Forward the chunk's actual mime type so the server picks the
            // right filename/extension for Whisper.
            "Content-Type": blob.type || "application/octet-stream",
          },
          credentials: "include",
          body: arrayBuffer,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const msg = data?.error ?? `Transcription failed (${res.status})`;
          // Non-fatal: log, mark a subtle indicator, keep recording.
          if (mountedRef.current) setChunkError(msg);
          return;
        }

        const data: { text: string } = await res.json();
        const newText = data.text?.trim();

        // Clear any previous chunk error on a successful response.
        if (mountedRef.current) setChunkError(null);

        if (!newText) return;

        // Append to cumulative transcript.
        const updated = transcriptRef.current
          ? `${transcriptRef.current} ${newText}`
          : newText;
        transcriptRef.current = updated;
        if (mountedRef.current) setTranscript(updated);

        // Check for trigger phrases in the latest chunk.
        const lower = newText.toLowerCase();
        if (TRIGGER_PHRASES.some((phrase) => lower.includes(phrase))) {
          if (mountedRef.current) setTriggerDetected(true);
        }

        // Run checklist matching against full transcript.
        // Intentional: this may silently no-op once the per-session token cap
        // is reached server-side (keeps the session going).
        await runCheck(sid, updated);
      } catch (err: any) {
        // Network / unexpected — non-fatal for recording. Keep session alive.
        if (mountedRef.current) {
          setChunkError(err?.message || "Network error during transcription.");
        }
      } finally {
        if (mountedRef.current) setIsTranscribing(false);
      }
    },
    [runCheck],
  );

  const {
    start: startRecording,
    stop: stopRecording,
    isRecording,
    error: recorderError,
    analyser,
  } = useMediaRecorder({ onChunk: handleChunk, chunkInterval: 10_000 });

  const start = useCallback(
    async (sessionId: number) => {
      // Reset state for a fresh narration session.
      sessionIdRef.current = sessionId;
      transcriptRef.current = "";
      setTranscript("");
      setTriggerDetected(false);
      setError(null);
      setChunkError(null);
      setSessionTimeUp(false);

      if (sessionCeilingTimerRef.current) {
        clearTimeout(sessionCeilingTimerRef.current);
      }
      sessionCeilingTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setSessionTimeUp(true);
        stopRecording();
      }, MAX_SESSION_MS);

      await startRecording();
    },
    [startRecording, stopRecording],
  );

  const stop = useCallback(() => {
    if (sessionCeilingTimerRef.current) {
      clearTimeout(sessionCeilingTimerRef.current);
      sessionCeilingTimerRef.current = null;
    }
    stopRecording();
    sessionIdRef.current = null;
  }, [stopRecording]);

  const resetTrigger = useCallback(() => {
    setTriggerDetected(false);
  }, []);

  // Surface only fatal recorder errors. Per-chunk Whisper errors are
  // surfaced via `chunkError` (subtle indicator).
  const combinedError = error || recorderError;

  return {
    transcript,
    isListening: isRecording,
    isTranscribing,
    start,
    stop,
    triggerDetected,
    resetTrigger,
    checkResults,
    coveredCount,
    totalLeaves,
    isChecking,
    error: combinedError,
    chunkError,
    sessionTimeUp,
    analyser,
  };
}
