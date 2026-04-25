import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Mic, Loader2, Volume2 } from "lucide-react";

type MicButtonState =
  | "idle"
  | "recording"
  | "processing"
  | "ai-speaking"
  // "listening" is the hero variant used in AI Listen mode: large disc with
  // pulsing ring + audio-level-driven breathing glow.
  | "listening";

interface MicButtonProps {
  state: MicButtonState;
  onClick?: () => void;
  analyser?: AnalyserNode | null;
  className?: string;
}

/**
 * Hook: reads RMS level from an AnalyserNode at ~30fps and returns a smoothed
 * 0..1 level. Returns 0 while the analyser is null.
 */
function useAudioLevel(analyser: AnalyserNode | null | undefined): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const smoothedRef = useRef(0);

  useEffect(() => {
    if (!analyser) {
      setLevel(0);
      smoothedRef.current = 0;
      return;
    }

    const buffer = new Uint8Array(analyser.fftSize);
    let lastWrite = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128; // -1..1
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length); // 0..~1
      // Smooth (attack fast, release slow) so the glow feels calm, not jittery.
      const prev = smoothedRef.current;
      const target = Math.min(1, rms * 2.5); // gently amplify typical speech
      const next = target > prev ? prev * 0.6 + target * 0.4 : prev * 0.85 + target * 0.15;
      smoothedRef.current = next;
      const now = performance.now();
      if (now - lastWrite > 33) {
        setLevel(next);
        lastWrite = now;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [analyser]);

  return level;
}

export function MicButton({ state, onClick, analyser, className }: MicButtonProps) {
  const isDisabled = state === "processing" || state === "ai-speaking";
  const level = useAudioLevel(state === "listening" ? analyser : null);

  // --- Hero "listening" variant for AI Listen mode -------------------------
  if (state === "listening") {
    // Audio-level-driven inner glow: grows subtly with speech. Clamped to a
    // calm range — we want "breathing," not "jumping."
    const glowScale = 1 + Math.min(level, 0.6) * 0.12; // 1.00 .. 1.07
    const glowOpacity = 0.35 + Math.min(level, 0.6) * 0.6; // 0.35 .. 0.71

    return (
      <div
        className={cn(
          "relative flex items-center justify-center",
          "h-[140px] w-[140px]",
          className,
        )}
        aria-label="Listening"
        role="status"
      >
        {/* Outer pulsing ring — calm Apple-easing pulse */}
        <span
          className="absolute inset-0 rounded-full border-2 border-primary/40 animate-pulse-listening"
          aria-hidden
        />
        {/* Secondary wider ring for depth */}
        <span
          className="absolute -inset-3 rounded-full border border-primary/20 animate-pulse-listening"
          style={{ animationDelay: "0.4s" }}
          aria-hidden
        />

        {/* Main disc */}
        <div className="relative flex h-full w-full items-center justify-center rounded-full bg-primary text-primary-foreground shadow-raised">
          {/* Audio-level breathing inner glow */}
          <span
            aria-hidden
            className="absolute inset-4 rounded-full bg-primary-foreground/15 blur-md transition-transform duration-150 ease-out"
            style={{
              transform: `scale(${glowScale})`,
              opacity: glowOpacity,
            }}
          />
          <Mic className="relative h-12 w-12" strokeWidth={1.75} />
        </div>
      </div>
    );
  }

  // --- Compact variants (unchanged behavior) -------------------------------
  return (
    <button
      onClick={onClick}
      disabled={isDisabled || !onClick}
      className={cn(
        "relative flex h-16 w-16 items-center justify-center rounded-full transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        state === "idle" && "bg-primary text-primary-foreground active:scale-95",
        state === "recording" && "bg-primary text-primary-foreground",
        state === "processing" &&
          "bg-primary/70 text-primary-foreground cursor-not-allowed",
        state === "ai-speaking" &&
          "bg-muted text-muted-foreground cursor-not-allowed opacity-70",
        className,
      )}
      aria-label={
        state === "idle"
          ? "Start recording"
          : state === "recording"
            ? "Stop recording"
            : state === "processing"
              ? "Processing"
              : "AI is speaking"
      }
    >
      {/* Pulsing ring for recording state */}
      {state === "recording" && (
        <span className="absolute inset-0 rounded-full animate-mic-pulse border-[3px] border-brand-accent" />
      )}

      {/* Icon */}
      {state === "processing" ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : state === "ai-speaking" ? (
        <Volume2 className="h-6 w-6" />
      ) : (
        <Mic className="h-6 w-6" />
      )}
    </button>
  );
}
