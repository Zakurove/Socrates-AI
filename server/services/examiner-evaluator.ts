import { openai } from "./openai.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PointResult {
  point: string;
  status: "present" | "partial" | "absent";
  feedback: string;
}

export interface EvaluationResult {
  /** Overall score from 0 to 1 */
  score: number;
  /** Per-key-point results */
  pointResults: PointResult[];
  /** Summary feedback for the student */
  feedback: string;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a student's answer to an examiner question using GPT-4o as a
 * rubric-based grader.
 *
 * @param question     - The examiner's question.
 * @param idealAnswer  - The model / ideal answer.
 * @param keyPoints    - Specific key points that should be present.
 * @param studentAnswer - The student's transcribed answer.
 */
export async function evaluateAnswer(
  question: string,
  idealAnswer: string,
  keyPoints: string[],
  studentAnswer: string,
): Promise<EvaluationResult> {
  if (!studentAnswer || studentAnswer.trim().length === 0) {
    return {
      score: 0,
      pointResults: keyPoints.map((p) => ({
        point: p,
        status: "absent",
        feedback: "No answer provided.",
      })),
      feedback:
        "No answer was provided. Try to give a response even if you are unsure.",
    };
  }

  // If there are no key points, do a holistic evaluation
  if (keyPoints.length === 0) {
    return evaluateHolistic(question, idealAnswer, studentAnswer);
  }

  const keyPointsList = keyPoints
    .map((kp, i) => `  ${i + 1}. ${kp}`)
    .join("\n");

  const prompt = `You are an OSCE examiner grading a medical student's answer.

QUESTION:
"${question}"

IDEAL / MODEL ANSWER:
"${idealAnswer}"

KEY POINTS TO ASSESS:
${keyPointsList}

STUDENT'S ANSWER:
"${studentAnswer}"

INSTRUCTIONS:
- For each key point, determine if the student's answer demonstrates it:
  - PRESENT (1.0): The student clearly addressed this point, even if using different words or synonyms (e.g. "teres minor" = "the small teres muscle").
  - PARTIAL (0.5): The student partially addressed this point or alluded to it without being specific enough.
  - ABSENT (0.0): The student did not address this point at all.
- Be fair about synonym recognition and paraphrasing. Medical concepts can be expressed many ways.
- Provide brief, constructive feedback for each point (1 sentence).
- Provide an overall feedback summary (2-3 sentences).

Respond with ONLY a JSON object in this exact format:
{
  "pointResults": [
    { "point": "key point text", "status": "present" | "partial" | "absent", "feedback": "brief feedback" }
  ],
  "overallFeedback": "2-3 sentence summary"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a fair, experienced OSCE examiner. Respond only with valid JSON. No markdown fences, no explanation outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: return a conservative result
      return buildFallbackResult(keyPoints, studentAnswer);
    }

    // Build validated result
    const pointResults: PointResult[] = [];
    let totalScore = 0;

    for (let i = 0; i < keyPoints.length; i++) {
      const modelResult = parsed.pointResults?.[i];

      const status = validateStatus(modelResult?.status);
      const feedback =
        typeof modelResult?.feedback === "string"
          ? modelResult.feedback
          : "";

      pointResults.push({
        point: keyPoints[i],
        status,
        feedback,
      });

      totalScore += status === "present" ? 1 : status === "partial" ? 0.5 : 0;
    }

    const score =
      keyPoints.length > 0 ? totalScore / keyPoints.length : 0;

    const overallFeedback =
      typeof parsed.overallFeedback === "string"
        ? parsed.overallFeedback
        : "Review the key points above.";

    return {
      score: Math.round(score * 100) / 100,
      pointResults,
      feedback: overallFeedback,
    };
  } catch (error: any) {
    throw new Error(
      `Answer evaluation failed: ${error?.message ?? "Unknown error"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Holistic evaluation (when no key points are provided)
// ---------------------------------------------------------------------------

async function evaluateHolistic(
  question: string,
  idealAnswer: string,
  studentAnswer: string,
): Promise<EvaluationResult> {
  const prompt = `You are an OSCE examiner. Compare the student's answer to the ideal answer.

QUESTION: "${question}"
IDEAL ANSWER: "${idealAnswer}"
STUDENT'S ANSWER: "${studentAnswer}"

Score the answer from 0.0 to 1.0 based on completeness and accuracy.
Provide 2-3 sentences of constructive feedback.

Respond with ONLY JSON: { "score": number, "feedback": "string" }`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a fair OSCE examiner. Respond only with valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    const parsed = JSON.parse(cleaned);

    return {
      score: Math.min(1, Math.max(0, Number(parsed.score) || 0)),
      pointResults: [],
      feedback: parsed.feedback ?? "No detailed feedback available.",
    };
  } catch {
    return {
      score: 0,
      pointResults: [],
      feedback:
        "Unable to evaluate your answer automatically. Please review the ideal answer.",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateStatus(
  status: unknown,
): "present" | "partial" | "absent" {
  if (status === "present" || status === "partial" || status === "absent") {
    return status;
  }
  return "absent";
}

function buildFallbackResult(
  keyPoints: string[],
  _studentAnswer: string,
): EvaluationResult {
  return {
    score: 0,
    pointResults: keyPoints.map((p) => ({
      point: p,
      status: "absent" as const,
      feedback: "Unable to evaluate automatically.",
    })),
    feedback:
      "Automatic evaluation encountered an error. Please review the ideal answer and key points manually.",
  };
}

// ---------------------------------------------------------------------------
// Conversational examiner: extract per-question answers from a full transcript
// and score each one in a single LLM call.
// ---------------------------------------------------------------------------

export interface TranscriptEvaluationInput {
  id: number;
  question: string;
  idealAnswer: string;
  keyPoints: string[];
}

export interface TranscriptEvaluationResult {
  questionId: number;
  score: number;
  userAnswerTranscript: string;
  feedback: string;
}

export async function evaluateExaminerTranscript(
  transcript: string,
  questions: TranscriptEvaluationInput[],
): Promise<TranscriptEvaluationResult[]> {
  if (questions.length === 0) return [];
  if (!transcript || transcript.trim().length === 0) {
    return questions.map((q) => ({
      questionId: q.id,
      score: 0,
      userAnswerTranscript: "",
      feedback: "No answer provided.",
    }));
  }

  const questionBlock = questions
    .map((q, i) => {
      const kp =
        q.keyPoints.length > 0
          ? `\n   Key points: ${q.keyPoints.map((k) => `"${k}"`).join(", ")}`
          : "";
      return `Question ${i + 1} (id=${q.id}): "${q.question}"
   Ideal answer: "${q.idealAnswer}"${kp}`;
    })
    .join("\n\n");

  const prompt = `You are a fair, experienced OSCE examiner reviewing a transcript of a spoken Q&A between an AI examiner and a medical student. Your job is to grade what the student actually said, generously crediting partial understanding. Real OSCE examiners do not penalise students for imperfect phrasing or missing one of several points — they give partial credit.

QUESTIONS:
${questionBlock}

TRANSCRIPT (AI = examiner, Student = candidate):
${transcript}

HOW TO GRADE (read carefully):

1. LOCATE THE ANSWER. Match student utterances to questions by CONTENT, not by transcript order. The examiner may paraphrase, ask follow-ups, or ask questions out of the original listed order; the student may answer question 2's topic while question 1 is on-screen. Pick the utterances that are topically relevant to each question.

2. IGNORE TRANSCRIPTION NOISE. The transcript comes from automatic speech recognition and will contain filler words ("um", "uh"), false starts, repeats, mishearings, and minor typos. Read through them to the substantive content.

3. ACCEPT SYNONYMS AND LAY LANGUAGE GENEROUSLY. Medical concepts can be expressed many ways. Treat these as equivalent:
   - "EF" = "ejection fraction" = "how well the heart squeezes"
   - "diastolic dysfunction" = "stiff heart" = "impaired relaxation"
   - "MR" = "mitral regurg" = "leaky mitral valve"
   - "PISA" = "proximal isovelocity surface area" = "the flow convergence method"
   - "LVH" = "thick heart muscle" = "left ventricular hypertrophy"
   - Any reasonable paraphrase of the ideal-answer concept counts.

4. SCORING SCALE — emit partial scores generously:
   - 1.0: covers all or nearly all of the ideal answer / key points (may use different words).
   - 0.7–0.9: covers most of the concepts, minor omissions.
   - 0.4–0.6: ON-TOPIC but incomplete — student identified the right domain and got SOME of the points. Use this range liberally. Examples: names 2 of 4 differentials, describes the right pathophysiology but misses a mechanism detail, identifies the condition but not the specific grading criteria.
   - 0.2–0.3: attempted the topic but got only a fragment right.
   - 0.0: the transcript shows NO relevant content for this question at all — student was silent, said "I don't know", or talked about an unrelated topic.

5. DO NOT SCORE 0 JUST BECAUSE THE STUDENT DIDN'T USE THE EXACT JARGON FROM THE IDEAL ANSWER. If they described the concept in their own words correctly, that is a PASSING answer.

6. WORKED EXAMPLE:
   Question: "What is your differential diagnosis for this murmur?"
   Ideal answer: "Aortic stenosis, aortic sclerosis, hypertrophic cardiomyopathy, mitral regurgitation radiating to base."
   Student said: "Um, so I'd think about aortic stenosis for sure, maybe some HOCM, and I guess MR could do it too."
   Correct grade: 0.7 (three of four differentials, phrased informally; acceptable for an OSCE).
   WRONG grade: 0.0 (would be absurd — the student clearly demonstrated knowledge).

7. ANOTHER WORKED EXAMPLE:
   Question: "How do you assess severity of mitral regurgitation?"
   Ideal answer: "Use PISA to calculate EROA, measure vena contracta width, assess LA size and pulmonary vein flow reversal."
   Student said: "I'd look at the jet size, measure the narrowest part of the jet, and check if the left atrium is enlarged."
   Correct grade: 0.5 (vena contracta in lay terms + LA dilation, missed PISA/EROA and pulm vein flow).
   WRONG grade: 0.0.

8. FEEDBACK. For each question give ONE short sentence of constructive feedback ("Nicely covered X; next time also mention Y"). Keep it supportive and specific.

OUTPUT:
Respond with ONLY a JSON array in this exact shape, one entry per question (matching questionId):
[
  { "questionId": <id>, "score": 0.0-1.0, "userAnswerTranscript": "<what the student said on this topic, verbatim-ish>", "feedback": "<1 sentence>" }
]

If the transcript has no Student: lines at all, return score=0 for every question — but NOTE in feedback that no student audio was captured, so Nasser can distinguish "I answered wrong" from "the mic/transcript pipeline broke".`;

  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    const transcriptLines = transcript.split("\n");
    // eslint-disable-next-line no-console
    console.log("[examiner-evaluator] prompt summary", {
      promptChars: prompt.length,
      transcriptChars: transcript.length,
      transcriptLineCount: transcriptLines.length,
      studentLineCount: transcriptLines.filter((l) =>
        l.startsWith("Student:"),
      ).length,
      aiLineCount: transcriptLines.filter((l) => l.startsWith("AI:")).length,
      questionCount: questions.length,
      // Show just the first question + first 300 chars of transcript so we
      // can sanity-check the data flowing into OpenAI without blasting
      // everything into the console.
      firstQuestion: questions[0]?.question.slice(0, 120),
      transcriptHead: transcript.slice(0, 300),
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a fair, experienced OSCE examiner. Respond only with a valid JSON array. No markdown fences, no explanation outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    if (isDev) {
      // eslint-disable-next-line no-console
      console.log("[examiner-evaluator] raw GPT response", {
        chars: raw.length,
        preview: raw.slice(0, 800),
      });
    }

    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return questions.map((q) => ({
        questionId: q.id,
        score: 0,
        userAnswerTranscript: "",
        feedback: "Automatic evaluation failed to parse.",
      }));
    }
    if (!Array.isArray(parsed)) {
      return questions.map((q) => ({
        questionId: q.id,
        score: 0,
        userAnswerTranscript: "",
        feedback: "Automatic evaluation returned an unexpected shape.",
      }));
    }

    const byId = new Map<number, TranscriptEvaluationResult>();
    for (const entry of parsed as Array<Record<string, unknown>>) {
      const qid = Number(entry.questionId);
      if (!Number.isFinite(qid)) continue;
      const score = Math.min(1, Math.max(0, Number(entry.score) || 0));
      byId.set(qid, {
        questionId: qid,
        score,
        userAnswerTranscript:
          typeof entry.userAnswerTranscript === "string"
            ? entry.userAnswerTranscript
            : "",
        feedback:
          typeof entry.feedback === "string" ? entry.feedback : "",
      });
    }

    return questions.map(
      (q) =>
        byId.get(q.id) ?? {
          questionId: q.id,
          score: 0,
          userAnswerTranscript: "",
          feedback: "No evaluation returned for this question.",
        },
    );
  } catch (error: any) {
    throw new Error(
      `Transcript evaluation failed: ${error?.message ?? "Unknown error"}`,
    );
  }
}
