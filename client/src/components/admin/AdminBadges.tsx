import { cn } from "@/lib/utils";

export function AdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-destructive",
        className,
      )}
    >
      Admin
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400",
        className,
      )}
    >
      Verified
    </span>
  );
}

export function UnverifiedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      Unverified
    </span>
  );
}

export function VisibilityBadge({
  visibility,
  className,
}: {
  visibility: "private" | "shared" | "public";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
        visibility === "public" &&
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        visibility === "shared" && "bg-primary/10 text-primary",
        visibility === "private" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {visibility}
    </span>
  );
}
