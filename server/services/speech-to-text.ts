import { openai } from "./openai.js";
import { toFile } from "openai";

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 *
 * @param audioBuffer - Raw audio data (webm, mp3, wav, m4a, etc.)
 * @param language    - Optional ISO-639-1 language code (e.g. "en", "ar")
 * @returns The transcribed text.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  language?: string,
): Promise<string> {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("Audio buffer is empty");
  }

  // Whisper has a 25 MB limit
  const MAX_SIZE = 25 * 1024 * 1024;
  if (audioBuffer.length > MAX_SIZE) {
    throw new Error(
      `Audio file too large (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.`,
    );
  }

  try {
    const file = await toFile(audioBuffer, "audio.webm", {
      type: "audio/webm",
    });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      ...(language ? { language } : {}),
    });

    return transcription.text.trim();
  } catch (error: any) {
    if (error?.status === 400) {
      throw new Error(
        "Invalid audio format. Supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm.",
      );
    }
    throw new Error(`Transcription failed: ${error?.message ?? "Unknown error"}`);
  }
}
