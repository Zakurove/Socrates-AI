/**
 * Canonical AI model registry.
 *
 * All model IDs and pricing live here so cost logs never drift from the
 * model actually being called. Every `openai.*.create({ model })` or
 * Gemini Live session setup should reference these constants.
 */

export type ModelId =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "whisper-1"
  | "tts-1"
  | "text-embedding-3-small"
  | "gemini-3.1-flash-live-preview";

export interface ModelPricing {
  /** USD per 1M input tokens (or per-minute for audio, see `unit`). */
  inPerMillion: number;
  /** USD per 1M output tokens. */
  outPerMillion: number;
  unit: "token" | "audio_minute";
}

export const AI_MODELS = {
  /** Persona-quality reasoning. Use sparingly — see `checklistMatcher` / `evaluator` which use mini. */
  patientSimulator: "gpt-4o" as const,
  /** Checklist matching, answer evaluation, session feedback. */
  checklistMatcher: "gpt-4o-mini" as const,
  examinerEvaluator: "gpt-4o-mini" as const,
  feedbackGenerator: "gpt-4o-mini" as const,
  /** Speech-to-text. Always force `language: "en"` at call sites. */
  whisper: "whisper-1" as const,
  /** Text-to-speech. */
  tts: "tts-1" as const,
  /** Embeddings for checklist pre-filter. */
  embedding: "text-embedding-3-small" as const,
  /** Real-time voice. Keep in sync with the model actually called in gemini-live.ts. */
  geminiLive: "gemini-3.1-flash-live-preview" as const,
} as const;

export const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  "gpt-4o": { inPerMillion: 2.5, outPerMillion: 10.0, unit: "token" },
  "gpt-4o-mini": { inPerMillion: 0.15, outPerMillion: 0.6, unit: "token" },
  "whisper-1": { inPerMillion: 0, outPerMillion: 0, unit: "audio_minute" },
  "tts-1": { inPerMillion: 0, outPerMillion: 0, unit: "audio_minute" },
  "text-embedding-3-small": { inPerMillion: 0.02, outPerMillion: 0, unit: "token" },
  "gemini-3.1-flash-live-preview": {
    inPerMillion: 0.3,
    outPerMillion: 2.5,
    unit: "token",
  },
};

export function estimateCostUsd(
  model: ModelId,
  tokensIn: number,
  tokensOut: number,
): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (
    (tokensIn / 1_000_000) * p.inPerMillion +
    (tokensOut / 1_000_000) * p.outPerMillion
  );
}
