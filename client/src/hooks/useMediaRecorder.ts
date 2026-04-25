import { useCallback, useEffect, useRef, useState } from "react";

interface UseMediaRecorderProps {
  /**
   * Called each time a standalone audio chunk is ready.
   * Chunks are independent files (with their own headers) — no growing buffer.
   */
  onChunk?: (blob: Blob) => void;
  /** Milliseconds between chunk emissions. Default 10_000. */
  chunkInterval?: number;
}

interface UseMediaRecorderReturn {
  start: () => Promise<void>;
  stop: () => void;
  isRecording: boolean;
  latestBlob: Blob | null;
  error: string | null;
  permissionState: "prompt" | "granted" | "denied" | "unsupported";
  analyser: AnalyserNode | null;
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  // Chrome/Firefox strongly prefer WebM/Opus; Safari only supports MP4/AAC.
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }
  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4";
  }
  return "";
}

export function useMediaRecorder(
  props: UseMediaRecorderProps = {},
): UseMediaRecorderReturn {
  const { onChunk, chunkInterval = 10_000 } = props;

  const [isRecording, setIsRecording] = useState(false);
  const [latestBlob, setLatestBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<
    "prompt" | "granted" | "denied" | "unsupported"
  >("prompt");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("");
  // When true, the hook is in rolling-restart mode — an onstop from the
  // rotation should NOT mark the hook as stopped.
  const rotatingRef = useRef(false);
  const stoppingRef = useRef(false);
  const onChunkRef = useRef(onChunk);

  // Keep callback ref fresh without re-triggering effects.
  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  // Check permission state on mount (if permissions API available).
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setPermissionState("unsupported");
      return;
    }
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((status) => {
          setPermissionState(
            status.state === "granted"
              ? "granted"
              : status.state === "denied"
                ? "denied"
                : "prompt",
          );
          status.onchange = () => {
            setPermissionState(
              status.state === "granted"
                ? "granted"
                : status.state === "denied"
                  ? "denied"
                  : "prompt",
            );
          };
        })
        .catch(() => {
          // permissions API not fully supported, stay at 'prompt'
        });
    }
  }, []);

  const cleanup = useCallback(() => {
    stoppingRef.current = true;
    rotatingRef.current = false;
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    try {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAnalyser(null);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  /**
   * Attach handlers to a MediaRecorder that will emit a single standalone
   * chunk on stop. Used for both the initial recorder and each rotation.
   */
  const attachRecorderHandlers = useCallback(
    (recorder: MediaRecorder, mimeType: string) => {
      const segmentChunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          segmentChunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        // Build a standalone blob for this segment (has headers — decodable).
        const segmentBlob = new Blob(segmentChunks, { type: mimeType });
        if (segmentBlob.size > 0) {
          setLatestBlob(segmentBlob);
          onChunkRef.current?.(segmentBlob);
        }

        // If we're fully stopping (not rotating), mark not recording.
        if (stoppingRef.current) {
          setIsRecording(false);
          return;
        }

        // Otherwise, rotation: immediately start a fresh recorder on the
        // same stream so the next ~chunkInterval of audio becomes the next
        // standalone segment.
        if (!rotatingRef.current) return;
        if (!streamRef.current || !streamRef.current.active) {
          setIsRecording(false);
          return;
        }

        try {
          const next = new MediaRecorder(streamRef.current, { mimeType });
          mediaRecorderRef.current = next;
          attachRecorderHandlers(next, mimeType);
          next.start();
        } catch (err) {
          // If we can't restart, surface and stop cleanly.
          console.error("[useMediaRecorder] restart failed:", err);
          setError("Recorder restart failed.");
          setIsRecording(false);
        }
      };
    },
    [],
  );

  const start = useCallback(async () => {
    setError(null);
    stoppingRef.current = false;
    rotatingRef.current = false;

    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setPermissionState("unsupported");
      setError("Media recording is not supported in this browser.");
      return;
    }

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      setError("No supported audio MIME type found.");
      return;
    }
    mimeTypeRef.current = mimeType;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setPermissionState("granted");

      // AudioContext + AnalyserNode (must be created during user gesture).
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 2048;
      source.connect(analyserNode);
      setAnalyser(analyserNode);

      // Initial recorder.
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      attachRecorderHandlers(recorder, mimeType);
      recorder.start();
      setIsRecording(true);

      // Rolling-restart loop: every chunkInterval, stop the current recorder
      // which triggers onstop → emits a standalone chunk → starts a new
      // recorder. This is compatible with both WebM (Chrome/Firefox) and MP4
      // (Safari) because each segment carries its own container headers.
      if (onChunkRef.current) {
        rotatingRef.current = true;
        chunkTimerRef.current = setInterval(() => {
          const rec = mediaRecorderRef.current;
          if (rec && rec.state === "recording") {
            try {
              rec.stop();
            } catch (err) {
              console.error("[useMediaRecorder] rotate stop failed:", err);
            }
          }
        }, chunkInterval);
      }
    } catch (err: any) {
      if (
        err.name === "NotAllowedError" ||
        err.name === "PermissionDeniedError"
      ) {
        setPermissionState("denied");
        setError("Microphone permission was denied.");
      } else {
        setError(err.message || "Failed to start recording.");
      }
      cleanup();
    }
  }, [chunkInterval, cleanup, attachRecorderHandlers]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    rotatingRef.current = false;
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    try {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        // Final stop — onstop will emit the last segment and set isRecording=false.
        mediaRecorderRef.current.stop();
      } else {
        setIsRecording(false);
      }
    } catch {
      setIsRecording(false);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      setAnalyser(null);
    }
  }, []);

  return {
    start,
    stop,
    isRecording,
    latestBlob,
    error,
    permissionState,
    analyser,
  };
}
