import { openai } from "./openai.js";

export type TTSVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

const VALID_VOICES: TTSVoice[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];

/**
 * Generate speech audio from text using OpenAI TTS-1.
 *
 * @param text  - The text to synthesize (max 4096 chars).
 * @param voice - One of the supported voices. Defaults to "nova".
 * @returns MP3 audio as a Buffer.
 */
export async function generateSpeech(
  text: string,
  voice: TTSVoice = "nova",
): Promise<Buffer> {
  if (!text || text.trim().length === 0) {
    throw new Error("Text for speech synthesis cannot be empty");
  }

  // TTS-1 has a 4096 character limit
  const MAX_CHARS = 4096;
  if (text.length > MAX_CHARS) {
    throw new Error(
      `Text too long (${text.length} chars). Maximum is ${MAX_CHARS} characters.`,
    );
  }

  if (!VALID_VOICES.includes(voice)) {
    throw new Error(
      `Invalid voice "${voice}". Must be one of: ${VALID_VOICES.join(", ")}`,
    );
  }

  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: text,
      response_format: "mp3",
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error: any) {
    throw new Error(
      `Speech generation failed: ${error?.message ?? "Unknown error"}`,
    );
  }
}
