import { storage } from "../storage.js";
import type { StationWithDetails, ReportTarget } from "../../shared/schema.js";

/**
 * Strip internal fields from a station record before returning it to
 * an unauthenticated consumer. Keeps everything pedagogically useful
 * (scenario, sections/items, examiner questions, patient briefing —
 * per Nasser, public viewers see checklist answers) while hiding
 * userId/internal timestamps and leaving only an author projection.
 */
export function sanitizePublicStation(
  station: StationWithDetails & { author: { id: number; displayName: string } },
): any {
  const {
    userId: _userId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    forkOf,
    ...rest
  } = station as any;

  return {
    ...rest,
    // Preserve forkOf only if it's a plain id; attribution resolution is
    // a future concern. Storage already filters orphans via ON DELETE SET NULL.
    forkOf: forkOf ?? null,
  };
}

/**
 * Force-unpublish a reported target. Used by the admin review flow when
 * the moderator decides the report is actionable. Safe for targets that
 * are already private (no-op in that case).
 */
export async function forceUnpublishTarget(
  targetType: ReportTarget,
  targetId: number,
): Promise<void> {
  if (targetType === "station") {
    await storage.unpublishStation(targetId);
  } else if (targetType === "collection") {
    await storage.unpublishCollection(targetId);
  }
  // `user` reports don't auto-unpublish anything — admin handles manually.
}
