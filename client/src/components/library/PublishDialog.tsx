import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Copy, Check } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
  usePublishStation,
  usePublishCollection,
} from "@/hooks/use-publish";
import { cn } from "@/lib/utils";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { type: "station" | "collection"; id: number; title: string };
  currentUserName: string;
  onPublished?: () => void;
}

export function PublishDialog({
  open,
  onOpenChange,
  target,
  currentUserName,
  onPublished,
}: PublishDialogProps) {
  const { toast } = useToast();
  const publishStation = usePublishStation();
  const publishCollection = usePublishCollection();

  const [cb1, setCb1] = useState(false);
  const [cb2, setCb2] = useState(false);
  const [cb3, setCb3] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setCb1(false);
      setCb2(false);
      setCb3(false);
      setError(null);
      setPublishedUrl(null);
      setCopied(false);
    }
  }, [open]);

  const allChecked = cb1 && cb2 && cb3;
  const pending = publishStation.isPending || publishCollection.isPending;

  const handlePublish = async () => {
    setError(null);
    try {
      if (target.type === "station") {
        await publishStation.mutateAsync(target.id);
      } else {
        await publishCollection.mutateAsync(target.id);
      }
      const base = window.location.origin;
      const path =
        target.type === "station"
          ? `/library/stations/${target.id}`
          : `/library/collections/${target.id}`;
      setPublishedUrl(`${base}${path}`);
      toast({
        title: "Published",
        description: "Anyone can find this in the library now.",
      });
      onPublished?.();
    } catch (err) {
      const raw = (err as Error).message;
      const match = raw.match(/^(\d+):\s*(.*)$/);
      const status = match ? parseInt(match[1], 10) : 0;
      const msg = match ? match[2] : raw;
      if (status === 422) {
        setError(
          "Add at least one checklist item or examiner question before publishing.",
        );
      } else {
        setError(msg || "Couldn't publish. Try again.");
      }
    }
  };

  const handleCopy = async () => {
    if (!publishedUrl) return;
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy link", variant: "warning" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {publishedUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Published</DialogTitle>
              <DialogDescription>
                Anyone can find this in the library now.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <p className="mb-2 text-caption text-muted-foreground">
                Share this link
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={publishedUrl}
                  className="min-w-0 flex-1 truncate rounded-lg border border-border/40 bg-background px-3 py-2 text-caption"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="shrink-0 h-9"
                  aria-label="Copy link"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Publish to community library</DialogTitle>
              <DialogDescription>
                Others will be able to view, fork, and practice with this
                station. You can unpublish at any time.
              </DialogDescription>
            </DialogHeader>

            <p className="text-caption text-muted-foreground">
              Published as{" "}
              <span className="font-semibold text-foreground">
                {currentUserName}
              </span>
            </p>

            <div className="space-y-3 py-2">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={cb1}
                  onCheckedChange={(v) => setCb1(v === true)}
                  className="mt-0.5"
                />
                <Label className="text-body text-foreground leading-snug cursor-pointer">
                  Content is original or appropriately credited
                </Label>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={cb2}
                  onCheckedChange={(v) => setCb2(v === true)}
                  className="mt-0.5"
                />
                <Label className="text-body text-foreground leading-snug cursor-pointer">
                  No patient identifiers or confidential hospital information
                </Label>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={cb3}
                  onCheckedChange={(v) => setCb3(v === true)}
                  className="mt-0.5"
                />
                <Label className="text-body text-foreground leading-snug cursor-pointer">
                  I agree to share under CC-BY 4.0 (attribution required)
                </Label>
              </label>
            </div>

            {error && (
              <p
                className={cn(
                  "rounded-lg bg-destructive/10 px-3 py-2 text-caption text-destructive",
                )}
                role="alert"
                aria-live="polite"
              >
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                onClick={handlePublish}
                disabled={!allChecked || pending}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {pending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Publish
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
