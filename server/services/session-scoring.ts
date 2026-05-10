import { storage } from "../storage.js";
import {
  computeCompositeScore,
  type ScoringBreakdown,
} from "../../shared/scoring.js";

/**
 * Count the number of LEAF checklist items on a station. Parent items
 * (those with children) are headings and don't contribute to the
 * denominator — this mirrors the client-side scoring model.
 */
export function countLeafItems(
  station: Awaited<ReturnType<typeof storage.getStation>>,
): number {
  if (!station) return 0;
  let count = 0;
  for (const section of station.sections ?? []) {
    for (const item of section.items ?? []) {
      const subs = (item as any).subItems ?? [];
      if (subs.length === 0) {
        count += 1;
        continue;
      }
      for (const sub of subs) {
        const subSubs = (sub as any).subItems ?? [];
        if (subSubs.length === 0) {
          count += 1;
        } else {
          count += subSubs.length;
        }
      }
    }
  }
  return count;
}

/**
 * Collect all leaf item ids for a station (used to filter item_results so
 * parent-heading rows don't inflate the covered count).
 */
function collectLeafItemIds(
  station: Awaited<ReturnType<typeof storage.getStation>>,
): Set<number> {
  const ids = new Set<number>();
  if (!station) return ids;
  for (const section of station.sections ?? []) {
    for (const item of section.items ?? []) {
      const subs = (item as any).subItems ?? [];
      if (subs.length === 0) {
        ids.add(item.id);
        continue;
      }
      for (const sub of subs) {
        const subSubs = (sub as any).subItems ?? [];
        if (subSubs.length === 0) {
          ids.add(sub.id);
        } else {
          for (const ss of subSubs) ids.add(ss.id);
        }
      }
    }
  }
  return ids;
}

/**
 * Compute the scoring breakdown for a session by re-aggregating the
 * source-of-truth tables (item_results, examiner_question_results) against
 * the station's current checklist/question counts. Returning this from the
 * read path means stored `totalScore` values are authoritative only if the
 * caller uses them — the breakdown itself is always derived, so older
 * sessions get the new weighting for free.
 */
export async function buildSessionScoring(
  sessionId: number,
  stationId: number,
  itemResults: Array<{ itemId: number; status: string }>,
  examinerQuestionResults: Array<{ score: number | null }>,
): Promise<ScoringBreakdown> {
  const station = await storage.getStation(stationId);
  const checklistTotal = countLeafItems(station);
  const leafIds = collectLeafItemIds(station);

  const checklistCovered = itemResults.filter(
    (r) =>
      leafIds.has(r.itemId) &&
      (r.status === "checked" || r.status === "checked_after_time"),
  ).length;

  const examinerTotal = station?.examinerQuestions?.length ?? 0;
  const examinerScores = examinerQuestionResults
    .map((r) => (typeof r.score === "number" ? r.score : null))
    .filter((s): s is number => s !== null);

  return computeCompositeScore({
    checklistTotal,
    checklistCovered,
    examinerTotal,
    examinerScores,
  });
}

/**
 * Re-aggregate a session's score from the source-of-truth tables, write the
 * rounded composite back to sessions.totalScore, and return the new value.
 * Called after a user correction so the persisted totalScore stays in sync
 * with the corrected item/question results.
 */
export async function recomputeSessionTotalScore(
  sessionId: number,
): Promise<number> {
  const session = await storage.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const station = await storage.getStation(session.stationId);
  const checklistTotal = countLeafItems(station);
  const leafIds = collectLeafItemIds(station);

  const itemRows = await storage.getItemResultsBySession(sessionId);
  // Match practice-page semantics: only `checked` and `checked_after_time`
  // count toward coverage. Filter to leaves so parent headings don't inflate.
  const checklistCovered = itemRows.filter(
    (r) =>
      leafIds.has(r.itemId) &&
      (r.status === "checked" || r.status === "checked_after_time"),
  ).length;

  const examinerTotal = station?.examinerQuestions?.length ?? 0;
  const questionRows =
    await storage.getExaminerQuestionResultsBySession(sessionId);
  const examinerScores = questionRows
    .map((r) => (typeof r.score === "number" ? r.score : null))
    .filter((s): s is number => s !== null);

  const breakdown = computeCompositeScore({
    checklistTotal,
    checklistCovered,
    examinerTotal,
    examinerScores,
  });

  const totalScore = Math.round(breakdown.compositeScore);
  await storage.updateSession(sessionId, { totalScore });
  return totalScore;
}

