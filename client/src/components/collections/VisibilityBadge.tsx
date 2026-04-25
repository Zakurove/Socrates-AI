import { Lock, Users, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Visibility } from "@shared/schema";

/**
 * Visibility indicator pill per UX.md:
 * - Private: Lock, warm-gray fill
 * - Shared: Users, outline; shows "Shared · N members" when memberCount provided
 * - Public: Globe2, Wisdom Amber fill
 */
export function VisibilityBadge({
  visibility,
  memberCount,
  className,
}: {
  visibility: Visibility;
  memberCount?: number;
  className?: string;
}) {
  if (visibility === "private") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold leading-none text-muted-foreground",
          className
        )}
      >
        <Lock className="h-3 w-3" aria-hidden />
        Private
      </span>
    );
  }

  if (visibility === "shared") {
    const label =
      typeof memberCount === "number"
        ? `Shared · ${memberCount} member${memberCount === 1 ? "" : "s"}`
        : "Shared";
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold leading-none text-foreground",
          className
        )}
      >
        <Users className="h-3 w-3" aria-hidden />
        {label}
      </span>
    );
  }

  // public
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-brand-accent/15 px-2 py-0.5 text-[11px] font-semibold leading-none text-brand-accent",
        className
      )}
      title="Anyone can find and fork this"
    >
      <Globe2 className="h-3 w-3" aria-hidden />
      Public
    </span>
  );
}
