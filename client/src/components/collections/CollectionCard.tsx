import { Link } from "wouter";
import { Users, Layers, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleBadge } from "./RoleBadge";
import { VisibilityBadge } from "./VisibilityBadge";
import type { CollectionRole, Visibility } from "@shared/schema";

/**
 * Deterministic FNV-1a-ish hash → 0..359 hue. Stable for the same title.
 */
function hashHue(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

function gradientFor(title: string): string {
  // Restrict hue to the brand's purple arc (255..295) so every collection
  // cover stays on-palette with Owl Purple instead of drifting into
  // unrelated tints (green / red / mustard etc.). Still deterministic
  // per-title so covers remain stable across renders.
  const base = hashHue(title);
  const h1 = 255 + (base % 41); // 255..295
  const h2 = 255 + ((base + 19) % 41);
  return `linear-gradient(135deg, hsl(${h1}, 55%, 70%), hsl(${h2}, 60%, 58%))`;
}

export interface CollectionCardProps {
  collection: {
    id: number;
    title: string;
    description?: string | null;
    stationCount: number;
    memberCount: number;
    visibility: Visibility;
    role: CollectionRole;
    starCount?: number;
  };
  className?: string;
}

export function CollectionCard({
  collection,
  className,
}: CollectionCardProps) {
  const {
    id,
    title,
    description,
    stationCount,
    memberCount,
    visibility,
    role,
    starCount,
  } = collection;
  return (
    <Link
      href={`/collections/${id}`}
      className={cn(
        "group block rounded-2xl bg-card border border-border/60 overflow-hidden shadow-card transition-smooth hover:border-border active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      aria-label={`Open collection ${title}`}
    >
      {/* Cover gradient (16:9) */}
      <div
        className="aspect-[16/9] w-full"
        style={{ backgroundImage: gradientFor(title) }}
        aria-hidden
      />

      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <h3 className="line-clamp-1 text-[15px] font-semibold leading-tight text-foreground">
            {title}
          </h3>
          {description && (
            <p className="line-clamp-2 text-caption text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums">
              {stationCount} station{stationCount === 1 ? "" : "s"}
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums">
              {memberCount} member{memberCount === 1 ? "" : "s"}
            </span>
          </span>
          {typeof starCount === "number" && starCount > 0 && (
            <span className="inline-flex items-center gap-1 text-brand-accent">
              <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
              <span className="tabular-nums">{starCount}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <VisibilityBadge
            visibility={visibility}
            memberCount={visibility === "shared" ? memberCount : undefined}
          />
          <RoleBadge role={role} />
        </div>
      </div>
    </Link>
  );
}

export function CollectionCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border/60 overflow-hidden shadow-card">
      <div className="aspect-[16/9] w-full animate-pulse bg-muted" />
      <div className="p-4 space-y-3">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    </div>
  );
}
