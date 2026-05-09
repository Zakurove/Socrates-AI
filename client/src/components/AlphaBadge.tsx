import { cn } from "@/lib/utils";

/**
 * Tiny pre-release badge. V70 eyebrow-chip vocabulary, scaled down so it
 * sits inline next to the wordmark without competing with the brand mark.
 */
export function AlphaBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-primary/[0.08] px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-[0.16em] text-primary leading-none",
        className,
      )}
      aria-label="Alpha release"
    >
      Alpha
    </span>
  );
}
