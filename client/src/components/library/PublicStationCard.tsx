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
} from "lucide-react";
import type { PublicStationSummary, StationType } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { AuthorBadge } from "./AuthorBadge";
import { StarButton } from "./StarButton";
import { stationTypeLabel, cn } from "@/lib/utils";

interface PublicStationCardProps {
  station: PublicStationSummary & { scenario?: string | null };
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

export function PublicStationCard({
  station,
  className,
}: PublicStationCardProps) {
  const Icon = typeIcon(station.type);

  return (
    <Link
      href={`/library/stations/${station.id}`}
      className={cn(
        "block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <Card
        className={cn(
          "transition-shadow hover:shadow-md active:shadow-sm",
        )}
      >
      <CardContent className="p-4">
        <div className="mb-2 flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-tight text-foreground">
              {station.title}
            </h3>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {stationTypeLabel(station.type)}
              {station.specialty ? ` · ${station.specialty}` : ""}
            </p>
          </div>
        </div>

        {station.scenario && (
          <p className="mb-3 line-clamp-2 text-caption text-muted-foreground">
            {station.scenario}
          </p>
        )}

        <div className="mb-3">
          <AuthorBadge author={station.author} size="sm" />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-caption text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3 text-brand-accent" aria-hidden />
              {station.starCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              {station.forkCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <Play className="h-3 w-3" />
              {station.practiceCount}
            </span>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <StarButton
              target={{ type: "station", id: station.id }}
              count={station.starCount}
              isStarred={!!station.isStarred}
              size="sm"
            />
          </div>
        </div>
      </CardContent>
      </Card>
    </Link>
  );
}

export function PublicStationCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex gap-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mb-3 h-8 w-full animate-pulse rounded bg-muted" />
        <div className="flex items-center justify-between">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-14 animate-pulse rounded-full bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
