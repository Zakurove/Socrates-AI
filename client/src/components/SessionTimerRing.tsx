import { Eye, EyeOff } from "lucide-react";
import { cn, formatTime } from "@/lib/utils";

/**
 * Rich session timer used during the active practice phase. Mirrors the
 * pre-session reading-countdown visual (SVG ring + central tabular-nums),
 * scaled down for the sticky header. Replaces the legacy thin TimerBar.
 *
 * Behavior:
 *  - Ring fills from full → empty as elapsed → totalSeconds.
 *  - Color ramp: primary (calm) → amber (warning) → emerald (final stretch) →
 *    amber (overtime).
 *  - Overtime: ring stays empty, central text shows `+m:ss` in amber, label
 *    flips to "Over time" so the user can see by how much they've gone past.
 *  - `hidden=true` collapses the ring to a small "Show timer" pill so the
 *    user can practice without time-anxiety. Default is shown.
 */
export function SessionTimerRing({
  totalSeconds,
  elapsedSeconds,
  hidden,
  onToggleHide,
  className,
}: {
  totalSeconds: number;
  elapsedSeconds: number;
  hidden?: boolean;
  onToggleHide?: () => void;
  className?: string;
}) {
  if (hidden) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <button
          type="button"
          onClick={onToggleHide}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label="Show timer"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          Show timer
        </button>
      </div>
    );
  }

  const remaining = totalSeconds - elapsedSeconds;
  const isOver = remaining < 0;
  const overBy = isOver ? -remaining : 0;
  const progress = Math.min(Math.max(elapsedSeconds / totalSeconds, 0), 1);

  // Calm palette mirroring the pre-session reading ring: amber by default,
  // emerald in the final stretch, amber again when overtime kicks in.
  const ringColor =
    progress >= 0.85 && !isOver ? "text-success" : "text-brand-accent";
  const textColor = isOver
    ? "text-brand-accent"
    : progress >= 0.85
      ? "text-success"
      : "text-foreground";

  // Match the pre-session reading ring exactly: 160px ring + 6px stroke.
  const ringSize = 160;
  const stroke = 6;
  const radius = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // In overtime the ring is empty (full dashOffset).
  const fillFraction = isOver ? 0 : 1 - progress;
  const dashOffset = circumference * (1 - fillFraction);

  const centerText = isOver ? `+${formatTime(overBy)}` : formatTime(Math.max(remaining, 0));

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className="relative flex items-center justify-center"
        style={{ width: ringSize, height: ringSize }}
        role="timer"
        aria-live="off"
        aria-label={isOver ? `${formatTime(overBy)} over time` : `${formatTime(Math.max(remaining, 0))} remaining`}
      >
        <svg
          width={ringSize}
          height={ringSize}
          viewBox={`0 0 ${ringSize} ${ringSize}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-border/50"
            fill="none"
          />
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={stroke}
            className={cn(
              "transition-[stroke-dashoffset,color] duration-700 ease-linear",
              ringColor,
            )}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <p
          className={cn(
            "absolute font-display font-semibold leading-none tabular-nums",
            isOver ? "text-[34px]" : "text-[40px]",
            textColor,
          )}
        >
          {centerText}
        </p>
      </div>

      {onToggleHide && (
        <button
          type="button"
          onClick={onToggleHide}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label="Hide timer"
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          Hide timer
        </button>
      )}
    </div>
  );
}
