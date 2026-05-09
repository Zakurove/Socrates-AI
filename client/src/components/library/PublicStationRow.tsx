import { Link } from "wouter";
import {
  ClipboardList,
  Stethoscope,
  MessagesSquare,
  Image as ImageIcon,
  FileText,
  GitFork,
  Play,
  Star,
  ChevronRight,
} from "lucide-react";
import type { PublicStationSummary, StationType } from "@shared/schema";
import { stationTypeLabel, cn } from "@/lib/utils";

interface PublicStationRowProps {
  station: PublicStationSummary;
  className?: string;
}

function typeIcon(type: StationType) {
  switch (type) {
    case "history_taking":
      return ClipboardList;
    case "physical_exam":
      return Stethoscope;
    case "communication":
      return MessagesSquare;
    case "image_id":
      return ImageIcon;
    default:
      return FileText;
  }
}

export function PublicStationRow({ station, className }: PublicStationRowProps) {
  const Icon = typeIcon(station.type);
  return (
    <Link
      href={`/library/stations/${station.id}?from=/library`}
      className={cn(
        "flex w-full items-center gap-3 px-5 py-4 min-h-[72px] transition-colors hover:bg-muted/30 dark:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">
          {station.title}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
          <span className="truncate">
            {station.author.displayName}
            <span aria-hidden className="ml-1 text-[11px] tracking-tight tabular-nums opacity-70">
              #{station.author.id}
            </span>
          </span>
          <span aria-hidden>·</span>
          <span>{stationTypeLabel(station.type)}</span>
          {station.specialty && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{station.specialty}</span>
            </>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-caption text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3 text-brand-accent" aria-hidden />
            {station.starCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <GitFork className="h-3 w-3" aria-hidden />
            {station.forkCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Play className="h-3 w-3" aria-hidden />
            {station.practiceCount}
          </span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export function PublicStationRowSkeleton() {
  return (
    <div className="flex w-full items-center gap-3 px-5 py-4 min-h-[72px]">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
