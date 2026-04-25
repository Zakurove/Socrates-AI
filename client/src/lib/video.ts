// Pure URL parsing for YouTube / Vimeo video links.
// No network calls; returns nulls gracefully for malformed input.

export type VideoPlatform = "youtube" | "vimeo";

export interface ParsedVideo {
  platform: VideoPlatform | null;
  id: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
}

const EMPTY: ParsedVideo = {
  platform: null,
  id: null,
  thumbnailUrl: null,
  embedUrl: null,
};

// Matches watch?v=, youtu.be/, embed/, shorts/, v/, live/
const YT_RE =
  /(?:youtu\.be\/|(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^&]*&)*v=|embed\/|shorts\/|v\/|live\/))([\w-]{11})/;

// Matches vimeo.com/{id} and player.vimeo.com/video/{id} and a few channel variants
const VIMEO_RE =
  /(?:player\.)?vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d+)/;

export function parseVideoUrl(url: string | null | undefined): ParsedVideo {
  if (!url || typeof url !== "string") return EMPTY;

  try {
    const ytMatch = url.match(YT_RE);
    if (ytMatch && ytMatch[1]) {
      const id = ytMatch[1];
      return {
        platform: "youtube",
        id,
        thumbnailUrl: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
        // Minimal params: no enablejsapi (would require `origin` and trigger
        // error 153 when missing). rel=0 hides related channels, modestbranding
        // reduces YT logo, playsinline keeps mobile inline playback.
        embedUrl: `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
      };
    }

    const vimeoMatch = url.match(VIMEO_RE);
    if (vimeoMatch && vimeoMatch[1]) {
      const id = vimeoMatch[1];
      return {
        platform: "vimeo",
        id,
        // Vimeo thumbnails require an API call; caller should render a placeholder.
        thumbnailUrl: null,
        embedUrl: `https://player.vimeo.com/video/${id}`,
      };
    }
  } catch {
    // fall through
  }

  return EMPTY;
}
