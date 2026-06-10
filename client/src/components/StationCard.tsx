import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { stationTypeLabel } from "@/lib/utils";
import { Clock, ListChecks } from "lucide-react";
import type { Station } from "@shared/schema";

interface StationCardProps {
  station: Station;
  itemCount?: number;
  lastPracticed?: string | null;
}

export function StationCard({
  station,
  itemCount,
  lastPracticed,
}: StationCardProps) {
  const [, navigate] = useLocation();

  const isDraft = station.isDraft;
  return (
    <Card
      className={`cursor-pointer transition-shadow hover:shadow-md active:shadow-sm${
        isDraft ? " opacity-70" : ""
      }`}
      onClick={() => navigate(`/station/${station.id}`)}
    >
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-base font-semibold leading-tight text-foreground">
            {station.title}
          </h3>
          {isDraft && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Draft
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{stationTypeLabel(station.type)}</span>
          {station.specialty && <span>{station.specialty}</span>}
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">{station.defaultTimeMinutes}m</span>
          </div>
          {itemCount !== undefined && (
            <div className="flex items-center gap-1">
              <ListChecks className="h-3 w-3" />
              <span className="tabular-nums">{itemCount} items</span>
            </div>
          )}
        </div>

        {lastPracticed && (
          <p className="mt-2 text-xs text-muted-foreground">
            Last practiced:{" "}
            {new Date(lastPracticed).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function StationCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mb-3 flex gap-1.5">
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="flex gap-3">
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
