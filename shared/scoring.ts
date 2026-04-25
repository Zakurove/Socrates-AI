/**
 * Session scoring — composite of checklist + examiner.
 *
 * Weighting when both parts exist: checklist 60%, examiner 40%.
 * Edge cases:
 *   - No examiner questions → composite = checklist only.
 *   - No checklist leaves → composite = examiner only (unusual).
 *   - Examiner questions exist but NONE answered → examiner = 0% (included).
 *
 * This is the single source of truth for how a session is scored. Keep it
 * pure + dependency-free so both client and server can import it.
 */

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
  /** 0..100 — weighted composite (or single part when only one exists). */
  compositeScore: number;
  /** True when the station has any leaf checklist items. */
  hasChecklist: boolean;
  /** True when the station has any examiner questions. */
  hasExaminer: boolean;
  /** Convenience fractional sub-counts (for "12/14" style display). */
  checklistFraction: { covered: number; total: number };
  examinerFraction: { earned: number; total: number };
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
  // unanswered questions count as 0, not "not included". This is the core
  // fix for iter10 item 2.
  const examinerScore = hasExaminer
    ? (examinerEarned / examinerTotal) * 100
    : 0;

  let compositeScore: number;
  if (hasChecklist && hasExaminer) {
    compositeScore =
      checklistScore * CHECKLIST_WEIGHT + examinerScore * EXAMINER_WEIGHT;
  } else if (hasChecklist) {
    compositeScore = checklistScore;
  } else if (hasExaminer) {
    compositeScore = examinerScore;
  } else {
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
  };
}
