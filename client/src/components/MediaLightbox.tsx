import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt?: string;
  caption?: string | null;
}

/**
 * Full-screen zoomable image viewer.
 * Uses react-zoom-pan-pinch for pinch/scroll/drag zoom with keyboard + button controls.
 * Tailored for the Socrates brand — warm neutrals, owl-purple overlay, subtle chrome.
 */
export function MediaLightbox({
  open,
  onOpenChange,
  src,
  alt,
  caption,
}: MediaLightboxProps) {
  // Close on Escape is handled by Radix; we also lock the body scroll.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Auto-dismiss the gesture hint after 2s; reset when a new image opens.
  const [hintVisible, setHintVisible] = useState(true);
  useEffect(() => {
    if (!open) return;
    setHintVisible(true);
    const t = setTimeout(() => setHintVisible(false), 2000);
    return () => clearTimeout(t);
  }, [open, src]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-[rgba(15,5,32,0.88)] backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-50 flex flex-col outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {alt || "Image viewer"}
          </DialogPrimitive.Title>

          <TransformWrapper
            minScale={1}
            maxScale={6}
            doubleClick={{ mode: "toggle", step: 1.8 }}
            wheel={{ step: 0.12 }}
            pinch={{ step: 5 }}
            centerOnInit
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                {/* Top bar */}
                <div className="flex items-center justify-between gap-2 px-4 pt-3 safe-top">
                  <div className="min-w-0 flex-1">
                    {caption && (
                      <p className="truncate text-xs text-white/80">
                        {caption}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur">
                    <button
                      type="button"
                      aria-label="Zoom out"
                      onClick={() => zoomOut()}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Zoom in"
                      onClick={() => zoomIn()}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Reset zoom"
                      onClick={() => resetTransform()}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <DialogPrimitive.Close
                      aria-label="Close"
                      className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
                    >
                      <X className="h-4 w-4" />
                    </DialogPrimitive.Close>
                  </div>
                </div>

                {/* Zoomable image */}
                <div className="flex flex-1 items-center justify-center overflow-hidden">
                  <TransformComponent
                    wrapperClass="!w-full !h-full"
                    contentClass="!w-full !h-full flex items-center justify-center"
                  >
                    <img
                      src={src}
                      alt={alt || caption || ""}
                      className="max-h-full max-w-full select-none object-contain"
                      draggable={false}
                    />
                  </TransformComponent>
                </div>

                {/* Hint bar — auto-dismisses after 2s to stay uncluttered */}
                <div className="px-4 pb-4 text-center safe-bottom" aria-hidden={!hintVisible}>
                  <p
                    className={cn(
                      "text-[11px] uppercase tracking-[0.12em] text-white/50 transition-opacity duration-500",
                      hintVisible ? "opacity-100" : "opacity-0",
                    )}
                  >
                    Double-tap or pinch to zoom
                  </p>
                </div>
              </>
            )}
          </TransformWrapper>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default MediaLightbox;
