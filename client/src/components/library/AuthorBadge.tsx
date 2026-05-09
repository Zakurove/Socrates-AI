import { useLocation } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AuthorBadgeProps {
  author: { id: number; displayName: string };
  size?: "sm" | "md";
  className?: string;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

export function AuthorBadge({ author, size = "sm", className }: AuthorBadgeProps) {
  const [, navigate] = useLocation();
  const avatarClass = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const textClass = size === "sm" ? "text-caption" : "text-[15px]";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/u/${author.id}`);
      }}
      className={cn(
        "group inline-flex items-center gap-2 text-left min-h-[32px] rounded-full transition-colors cursor-pointer",
        className,
      )}
      aria-label={`Author: ${author.displayName} (id ${author.id}). Open profile.`}
    >
      <Avatar className={avatarClass}>
        <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
          {initials(author.displayName)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          textClass,
          "font-medium text-foreground truncate underline decoration-transparent underline-offset-2 transition-colors group-hover:text-primary group-hover:decoration-primary/60",
        )}
      >
        {author.displayName}
        <span
          aria-hidden
          className="ml-1.5 text-[11px] font-normal text-muted-foreground tracking-tight tabular-nums"
        >
          #{author.id}
        </span>
      </span>
    </button>
  );
}
