import { useState } from "react";
import { PlayCircle, ExternalLink } from "lucide-react";
import { parseVideoUrl } from "@/lib/video";
import { cn } from "@/lib/utils";

interface VideoEmbedProps {
  url: string;
  title?: string;
  className?: string;
}

/**
 * Renders a responsive 16:9 iframe for a YouTube or Vimeo URL.
 * Falls back to a small "unsupported URL" card if parsing fails, or to an
 * "Open on YouTube" link if the iframe errors (e.g. embedding disabled).
 */
export function VideoEmbed({ url, title, className }: VideoEmbedProps) {
  const parsed = parseVideoUrl(url);
  const [iframeError, setIframeError] = useState(false);

  const showFallback = !parsed.embedUrl || iframeError;

  if (showFallback) {
    return (
      <div
        className={cn(
          "flex aspect-video items-center justify-center rounded-xl border border-border/60 bg-warm-100/50 p-4 text-center",
          className,
        )}
      >
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <PlayCircle className="h-6 w-6" />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 break-all text-caption font-medium text-brand-accent underline-offset-2 hover:underline"
          >
            {parsed.platform === "youtube" ? "Open on YouTube" : "Open video"}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  const iframeTitle =
    title ||
    (parsed.platform === "youtube" ? "YouTube video" : "Vimeo video");

  return (
    <div
      className={cn(
        "aspect-video overflow-hidden rounded-xl border border-border/60 bg-black",
        className,
      )}
    >
      <iframe
        src={parsed.embedUrl!}
        title={iframeTitle}
        className="h-full w-full"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        onError={() => setIframeError(true)}
      />
    </div>
  );
}

export default VideoEmbed;
