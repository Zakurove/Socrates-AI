import { Crown, Pencil, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollectionRole } from "@shared/schema";

/**
 * Visual role indicator per UX.md:
 * - Owner: filled Owl Purple (primary) with Crown
 * - Editor: outlined primary with Pencil
 * - Viewer: warm-gray outline with Eye
 */
export function RoleBadge({
  role,
  className,
}: {
  role: CollectionRole;
  className?: string;
}) {
  const label = role === "owner" ? "Owner" : role === "editor" ? "Editor" : "Viewer";
  const Icon = role === "owner" ? Crown : role === "editor" ? Pencil : Eye;

  const variant =
    role === "owner"
      ? "bg-primary text-primary-foreground border-transparent"
      : role === "editor"
        ? "border-primary/60 text-primary bg-primary/5"
        : "border-border text-muted-foreground bg-transparent";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none",
        variant,
        className
      )}
      aria-label={`Role: ${label}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
