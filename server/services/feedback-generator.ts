import { openai } from "./openai.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionFeedbackInput {
  stationTitle: string;
  mode: string;
  checkedItems: string[];
  missedItems: string[];
  criticalMissed: string[];
  timeUsed: number;   // seconds
  timeLimit: number;  // seconds
  examinerResults: ExaminerResultSummary[];
}

export interface ExaminerResultSummary {
  question: string;
  score: number;        // 0-1
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Feedback generator
// ---------------------------------------------------------------------------

/**
 * Generate a constructive feedback paragraph for a completed OSCE session.
 * Tone: supportive but honest, like a kind attending physician.
 */
export async function generateSessionFeedback(
  session: SessionFeedbackInput,
): Promise<string> {
  const totalItems = session.checkedItems.length + session.missedItems.length;
  const checklistScore =
    totalItems > 0
      ? ((session.checkedItems.length / totalItems) * 100).toFixed(0)
      : "N/A";

  const timeUsedMin = (session.timeUsed / 60).toFixed(1);
  const timeLimitMin = (session.timeLimit / 60).toFixed(1);
  const timeStatus =
    session.timeUsed > session.timeLimit
      ? "OVER TIME"
      : session.timeUsed > session.timeLimit * 0.9
        ? "close to time limit"
        : "within time";

  const examinerSummary =
    session.examinerResults.length > 0
      ? session.examinerResults
          .map(
            (r) =>
              `  - Q: "${r.question}" => Score: ${(r.score * 100).toFixed(0)}%${r.feedback ? ` (${r.feedback})` : ""}`,
          )
          .join("\n")
      : "  No examiner questions in this session.";

  const prompt = `You are a kind, experienced attending physician providing feedback to a medical student after an OSCE practice session.

SESSION DETAILS:
- Station: ${session.stationTitle}
- Mode: ${session.mode}
- Time: ${timeUsedMin} min used of ${timeLimitMin} min (${timeStatus})

CHECKLIST PERFORMANCE:
- Score: ${checklistScore}% (${session.checkedItems.length} of ${totalItems} items)
- Items completed: ${session.checkedItems.length > 0 ? session.checkedItems.join("; ") : "None"}
- Items missed: ${session.missedItems.length > 0 ? session.missedItems.join("; ") : "None"}
- CRITICAL items missed: ${session.criticalMissed.length > 0 ? session.criticalMissed.join("; ") : "None"}

EXAMINER QUESTION RESULTS:
${examinerSummary}

INSTRUCTIONS:
- Write a brief, constructive feedback paragraph (4-6 sentences).
- Start by acknowledging what the student did well (specific items they covered).
- Then mention the most important gaps, especially any critical items missed.
- If they went over time, mention time management.
- End with 1-2 specific, actionable suggestions for improvement.
- Tone: supportive, warm, professional. Like a mentor who wants the student to succeed.
- Do NOT use bullet points or lists. Write in flowing paragraph form.
- Do NOT repeat the raw scores or percentages — the student can see those in the UI.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a supportive medical education faculty member. Write concise, encouraging feedback in paragraph form.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 400,
    });

    const feedback = completion.choices[0]?.message?.content?.trim();

    if (!feedback) {
      return buildFallbackFeedback(session);
    }

    return feedback;
  } catch (error: any) {
    console.error("Feedback generation failed:", error?.message);
    return buildFallbackFeedback(session);
  }
}

// ---------------------------------------------------------------------------
// Fallback (no AI)
// ---------------------------------------------------------------------------

function buildFallbackFeedback(session: SessionFeedbackInput): string {
  const totalItems = session.checkedItems.length + session.missedItems.length;
  const parts: string[] = [];

  if (session.checkedItems.length > 0) {
    parts.push(
      `You covered ${session.checkedItems.length} of ${totalItems} checklist items.`,
    );
  } else {
    parts.push("No checklist items were marked as completed in this session.");
  }

  if (session.criticalMissed.length > 0) {
    parts.push(
      `Important: you missed ${session.criticalMissed.length} critical item(s) that should be prioritized in your next attempt.`,
    );
  }

  if (session.timeUsed > session.timeLimit) {
    parts.push(
      "You went over the time limit. Practice prioritizing your approach to stay within the allotted time.",
    );
  }

  parts.push(
    "Review the checklist breakdown above and focus on the missed items in your next practice session.",
  );

  return parts.join(" ");
}
