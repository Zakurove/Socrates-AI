import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function stationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    history_taking: "History",
    physical_exam: "Physical Exam",
    communication: "Communication",
    image_id: "Image ID",
    qa: "Q&A",
    custom: "Custom",
    // Legacy values — render as their replacements until data is migrated.
    equipment_id: "Image ID",
    oral_qa: "Q&A",
  };
  return labels[type] || type;
}

export function stationTypeColor(_type: string): string {
  // Color removed from station type in Phase A. Kept as no-op for back-compat.
  return "";
}

export function difficultyColor(_difficulty: string): string {
  return "";
}

export function hasScore(session: { totalScore?: number | null } | null | undefined): boolean {
  if (!session) return false;
  return typeof session.totalScore === "number" && session.totalScore > 0;
}

export function scoreRampClasses(score: number): string {
  if (score >= 75) return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "bg-brand-accent/15 text-brand-accent";
  return "bg-muted text-muted-foreground";
}

export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 75) return { label: `${Math.round(score)}%`, color: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 60) return { label: `${Math.round(score)}%`, color: "text-brand-accent" };
  return { label: `${Math.round(score)}%`, color: "text-muted-foreground" };
}
