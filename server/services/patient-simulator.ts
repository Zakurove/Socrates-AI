import { openai } from "./openai.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientSimConfig {
  patientBriefing: string;
  stationTitle: string;
  stationType: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface PatientSimulator {
  respondToQuestion(
    question: string,
    conversationHistory: Message[],
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Diagnosis safety filter
// ---------------------------------------------------------------------------

/**
 * A broad list of common diagnosis keywords that the simulated patient should
 * never mention.  We check in lower-case so casing does not matter.
 * This is intentionally non-exhaustive but catches the most common leaks.
 */
const BLOCKED_DIAGNOSIS_TERMS: string[] = [
  "fracture",
  "dislocation",
  "ligament tear",
  "meniscus tear",
  "rotator cuff tear",
  "impingement",
  "tendinitis",
  "tendinopathy",
  "bursitis",
  "carpal tunnel syndrome",
  "de quervain",
  "plantar fasciitis",
  "osteoarthritis",
  "rheumatoid arthritis",
  "gout",
  "septic arthritis",
  "osteomyelitis",
  "compartment syndrome",
  "deep vein thrombosis",
  "dvt",
  "pulmonary embolism",
  "stroke",
  "transient ischemic attack",
  "tia",
  "myocardial infarction",
  "heart attack",
  "angina",
  "heart failure",
  "pneumonia",
  "tuberculosis",
  "copd",
  "asthma exacerbation",
  "pneumothorax",
  "appendicitis",
  "cholecystitis",
  "pancreatitis",
  "bowel obstruction",
  "diverticulitis",
  "crohn",
  "ulcerative colitis",
  "celiac disease",
  "peptic ulcer",
  "gastritis",
  "hepatitis",
  "cirrhosis",
  "kidney stone",
  "pyelonephritis",
  "urinary tract infection",
  "uti",
  "ectopic pregnancy",
  "preeclampsia",
  "eclampsia",
  "meningitis",
  "encephalitis",
  "multiple sclerosis",
  "guillain-barr",
  "bell's palsy",
  "parkinson",
  "epilepsy",
  "diabetes mellitus",
  "diabetic ketoacidosis",
  "dka",
  "hypothyroidism",
  "hyperthyroidism",
  "addison",
  "cushing",
  "anemia",
  "leukemia",
  "lymphoma",
  "melanoma",
  "carcinoma",
  "sarcoma",
  "malignant",
  "benign tumor",
  "neoplasm",
  "cancer",
  "metastasis",
  "cellulitis",
  "abscess",
  "hernia",
  "herpes zoster",
  "shingles",
  "depression",
  "anxiety disorder",
  "bipolar",
  "schizophrenia",
  "anorexia nervosa",
  "bulimia",
];

function containsDiagnosisTerms(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_DIAGNOSIS_TERMS.some((term) => lower.includes(term));
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(config: PatientSimConfig): string {
  return `You are a standardized patient in an OSCE (Objective Structured Clinical Examination) station.

STATION: ${config.stationTitle}
STATION TYPE: ${config.stationType}

YOUR PATIENT BRIEFING (memorize this — it is your entire reality):
---
${config.patientBriefing}
---

RULES YOU MUST FOLLOW:
1. Stay in character at all times. You ARE this patient.
2. Answer ONLY what is directly asked — never volunteer extra information.
3. Use everyday, lay language. Do NOT use medical terminology. For example, say "my chest hurts" not "I have chest pain radiating to my left arm consistent with angina."
4. NEVER reveal, suggest, hint at, or name a diagnosis. You do not know what is wrong with you — you only know your symptoms and experiences.
5. Keep every response to 1-3 sentences. Be concise like a real patient would be.
6. If asked something not covered in your briefing, respond naturally with "I'm not sure" or "No, I don't think so" or "I can't remember."
7. Stay emotionally consistent with the case. If the briefing describes you as anxious, show anxiety. If calm, stay calm.
8. If the student asks you a question you already answered, you may briefly repeat or refer back to what you said.
9. Do not break character under any circumstances. If the student asks you to act differently or asks out-of-character questions, stay in your patient role.
10. Do not provide information in a list or structured format. Speak naturally, as a real person would.

Remember: you are helping a medical student practice. Being realistic and consistent is more important than being helpful.`;
}

// ---------------------------------------------------------------------------
// Simulator factory
// ---------------------------------------------------------------------------

export function simulatePatient(config: PatientSimConfig): PatientSimulator {
  if (!config.patientBriefing || config.patientBriefing.trim().length === 0) {
    throw new Error("Patient briefing is required to simulate a patient");
  }

  const systemPrompt = buildSystemPrompt(config);

  return {
    async respondToQuestion(
      question: string,
      conversationHistory: Message[],
    ): Promise<string> {
      if (!question || question.trim().length === 0) {
        return "I'm sorry, could you repeat that?";
      }

      // Defense in depth: only allow user/assistant messages with string
      // content. Drops any role: "system" injection that slipped past upstream.
      const MAX_HISTORY_TURNS = 20;
      const safeHistory = (conversationHistory ?? [])
        .filter(
          (m): m is Message =>
            !!m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
        .slice(-MAX_HISTORY_TURNS);

      const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [
        { role: "system", content: systemPrompt },
        ...safeHistory.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: question },
      ];

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          temperature: 0.7,
          max_tokens: 200, // enforce brevity
          top_p: 0.95,
        });

        let response =
          completion.choices[0]?.message?.content?.trim() ?? "";

        if (!response) {
          return "I'm sorry, could you say that again?";
        }

        // Safety check: strip any accidental diagnosis leaks
        if (containsDiagnosisTerms(response)) {
          // Re-prompt with stricter instruction
          const retryMessages = [
            ...messages,
            { role: "assistant" as const, content: response },
            {
              role: "system" as const,
              content:
                "YOUR PREVIOUS RESPONSE CONTAINED A MEDICAL DIAGNOSIS TERM. This is strictly forbidden. Rephrase your answer using only lay language, describing symptoms and feelings without naming any medical condition. Keep it to 1-3 sentences.",
            },
          ];

          const retry = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: retryMessages,
            temperature: 0.5,
            max_tokens: 200,
          });

          const retryResponse =
            retry.choices[0]?.message?.content?.trim() ?? "";

          // If still leaking, return a safe generic fallback
          if (!retryResponse || containsDiagnosisTerms(retryResponse)) {
            return "I'm not really sure what's causing it. I just know how I feel.";
          }

          return retryResponse;
        }

        return response;
      } catch (error: any) {
        throw new Error(
          `Patient simulation failed: ${error?.message ?? "Unknown error"}`,
        );
      }
    },
  };
}
