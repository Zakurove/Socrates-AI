/**
 * Session scoring — composite of checklist + examiner.
 *
 * Weighting is proportional to the COUNT of scoring units in the station:
 *   1 checklist leaf = 1 unit.
 *   1 examiner question = EXAMINER_QUESTION_UNITS units (default 3).
 *
 * So a station with 80 leaves and 1 examiner question splits as
 * 80/(80+3)=96% checklist, 3/(80+3)=4% examiner — the lone question can't
 * dominate. A station with 10 leaves and 5 examiner questions splits as
 * 10/(10+15)=40% checklist, 15/(10+15)=60% examiner — questions matter.
 *
 * Why per-question weight > 1: an examiner Q&A typically requires
 * synthesis (differentials, management, interpretation) so it's worth more
 * than a single tick item like "wash hands." 3 was picked empirically;
 * adjustable via EXAMINER_QUESTION_UNITS.
 *
 * Edge cases:
 *   - No examiner questions → composite = checklist only.
 *   - No checklist leaves → composite = examiner only (unusual).
 *   - Examiner questions exist but NONE answered → examiner = 0% (included).
 *
 * This is the single source of truth for how a session is scored. Keep it
 * pure + dependency-free so both client and server can import it.
 */

/** Each examiner question counts as N units (each leaf is 1 unit). */
export const EXAMINER_QUESTION_UNITS = 3;

// Legacy exports kept so any external consumers don't break compile. Both
// values are now derived per-station from item counts; these constants are
// no longer authoritative for the composite math.
export const CHECKLIST_WEIGHT = 0.6;
export const EXAMINER_WEIGHT = 0.4;

export interface ScoringInput {
  /** Number of leaf checklist items in the station. */
  checklistTotal: number;
  /** Number of leaf checklist items the user got credit for (checked or checked_after_time). */
  checklistCovered: number;
  /** Number of examiner questions configured on the station. */
  examinerTotal: number;
  /**
   * Per-question scores that WERE recorded (0..1). Unanswered questions are
   * NOT included here — they count as 0 against `examinerTotal`. If the
   * examiner phase was never reached, pass an empty array.
   */
  examinerScores: number[];
}

export interface ScoringBreakdown {
  /** 0..100 — leaf coverage as a percentage. 0 if no leaves. */
  checklistScore: number;
  /** 0..100 — sum(examinerScores)/examinerTotal as a percentage. 0 if no questions. */
  examinerScore: number;
  /** 0..100 — count-weighted composite (or single part when only one exists). */
  compositeScore: number;
  /** True when the station has any leaf checklist items. */
  hasChecklist: boolean;
  /** True when the station has any examiner questions. */
  hasExaminer: boolean;
  /** Convenience fractional sub-counts (for "12/14" style display). */
  checklistFraction: { covered: number; total: number };
  examinerFraction: { earned: number; total: number };
  /**
   * Effective weight (0..1) of each component in this specific station's
   * composite score. Useful for "Checklist worth 96%, Examiner worth 4%"
   * style display so users understand why a wrong examiner answer barely
   * moved the dial.
   */
  weights: { checklist: number; examiner: number };
}

export function computeCompositeScore(input: ScoringInput): ScoringBreakdown {
  const checklistTotal = Math.max(0, input.checklistTotal | 0);
  const checklistCovered = Math.max(
    0,
    Math.min(input.checklistCovered | 0, checklistTotal),
  );
  const examinerTotal = Math.max(0, input.examinerTotal | 0);

  // Clamp every examiner score into [0,1]; non-finite values are treated as 0.
  const safeScores = input.examinerScores
    .filter((s) => typeof s === "number" && Number.isFinite(s))
    .map((s) => Math.max(0, Math.min(1, s)));
  const examinerEarned = safeScores.reduce((a, b) => a + b, 0);

  const hasChecklist = checklistTotal > 0;
  const hasExaminer = examinerTotal > 0;

  const checklistScore = hasChecklist
    ? (checklistCovered / checklistTotal) * 100
    : 0;

  // Examiner score uses the TOTAL configured questions as denominator —
  // unanswered questions count as 0, not "not included".
  const examinerScore = hasExaminer
    ? (examinerEarned / examinerTotal) * 100
    : 0;

  // Count-weighted composite. checklistUnits = leaves; examinerUnits =
  // questions × EXAMINER_QUESTION_UNITS.
  const checklistUnits = checklistTotal;
  const examinerUnits = examinerTotal * EXAMINER_QUESTION_UNITS;
  const totalUnits = checklistUnits + examinerUnits;

  let compositeScore: number;
  let checklistWeight: number;
  let examinerWeight: number;
  if (hasChecklist && hasExaminer) {
    checklistWeight = checklistUnits / totalUnits;
    examinerWeight = examinerUnits / totalUnits;
    compositeScore =
      checklistScore * checklistWeight + examinerScore * examinerWeight;
  } else if (hasChecklist) {
    checklistWeight = 1;
    examinerWeight = 0;
    compositeScore = checklistScore;
  } else if (hasExaminer) {
    checklistWeight = 0;
    examinerWeight = 1;
    compositeScore = examinerScore;
  } else {
    checklistWeight = 0;
    examinerWeight = 0;
    compositeScore = 0;
  }

  return {
    checklistScore,
    examinerScore,
    compositeScore,
    hasChecklist,
    hasExaminer,
    checklistFraction: { covered: checklistCovered, total: checklistTotal },
    examinerFraction: { earned: examinerEarned, total: examinerTotal },
    weights: { checklist: checklistWeight, examiner: examinerWeight },
  };
}
