import { useState, useEffect } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { stationTypeLabel, cn } from "@/lib/utils";
import { SPECIALTIES } from "@/lib/specialties";
import type { StationSort } from "@/hooks/use-library";

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "__all__", label: "All" },
  { value: "history_taking", label: stationTypeLabel("history_taking") },
  { value: "physical_exam", label: stationTypeLabel("physical_exam") },
  { value: "communication", label: stationTypeLabel("communication") },
  { value: "image_id", label: stationTypeLabel("image_id") },
  { value: "qa", label: stationTypeLabel("qa") },
  { value: "custom", label: stationTypeLabel("custom") },
];

const SORTS: { value: StationSort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "popular", label: "Most starred" },
  { value: "forks", label: "Most forked" },
  { value: "practices", label: "Most practiced" },
];

interface LibraryFiltersProps {
  value: {
    type?: string;
    specialty?: string;
    sort?: StationSort;
  };
  onChange: (v: LibraryFiltersProps["value"]) => void;
}

const ALL = "__all__";

export function LibraryFilters({ value, onChange }: LibraryFiltersProps) {
  const [specialty, setSpecialty] = useState(value.specialty ?? "");

  useEffect(() => {
    setSpecialty(value.specialty ?? "");
  }, [value.specialty]);

  const activeType = value.type ?? ALL;
  const activeSpecialty = specialty || ALL;
  const activeSort = value.sort ?? "recent";

  return (
    <div className="space-y-3">
      {/* Type chips — horizontal scroll, edge fade */}
      <div
        className="-mx-5 flex flex-nowrap gap-2 overflow-x-auto px-5 pb-1 no-scrollbar"
        style={{
          maskImage: "linear-gradient(to right, black 88%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, black 88%, transparent)",
        }}
      >
        {TYPE_FILTERS.map((f) => {
          const active = activeType === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  type: f.value === ALL ? undefined : f.value,
                })
              }
              className={cn(
                "shrink-0 h-9 rounded-full px-4 text-[13px] font-medium transition-smooth",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Sort + Specialty row */}
      <div className="flex items-center gap-2">
        <Select
          value={activeSort}
          onValueChange={(v) => onChange({ ...value, sort: v as StationSort })}
        >
          <SelectTrigger className="h-9 w-auto rounded-full border-border/60 bg-muted/60 px-4 text-[13px] font-medium gap-1.5 [&>svg]:opacity-60">
            <span className="text-muted-foreground">Sort:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={activeSpecialty}
          onValueChange={(v) => {
            const next = v === ALL ? "" : v;
            setSpecialty(next);
            onChange({ ...value, specialty: next || undefined });
          }}
        >
          <SelectTrigger className="h-9 w-auto rounded-full border-border/60 bg-muted/60 px-4 text-[13px] font-medium gap-1.5 [&>svg]:opacity-60">
            <span className="text-muted-foreground">Specialty:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any</SelectItem>
            {SPECIALTIES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
