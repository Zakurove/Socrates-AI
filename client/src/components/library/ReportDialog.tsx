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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useSubmitReport, type SubmitReportPayload } from "@/hooks/use-reports";

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Omit<SubmitReportPayload, "reason">;
  targetLabel?: string;
}

const REASONS = [
  { value: "inaccurate", label: "Inaccurate content" },
  { value: "inappropriate", label: "Inappropriate" },
  { value: "copyright", label: "Copyright concern" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

export function ReportDialog({
  open,
  onOpenChange,
  target,
  targetLabel,
}: ReportDialogProps) {
  const { toast } = useToast();
  const submit = useSubmitReport();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
      setDetails("");
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!reason) return;
    try {
      const label = REASONS.find((r) => r.value === reason)?.label ?? reason;
      const fullReason = details.trim()
        ? `${label}: ${details.trim()}`
        : label;
      await submit.mutateAsync({
        targetType: target.targetType,
        targetId: target.targetId,
        reason: fullReason,
      });
      toast({
        title: "Thanks",
        description: "We'll review shortly.",
      });
      onOpenChange(false);
    } catch (err) {
      const raw = (err as Error).message;
      const match = raw.match(/^(\d+):\s*(.*)$/);
      const status = match ? parseInt(match[1], 10) : 0;
      const msg = match ? match[2] : raw;
      if (status === 429) {
        toast({
          title: "Slow down",
          description:
            "You've submitted several reports recently. Please try again in a minute.",
          variant: "warning",
        });
      } else {
        toast({
          title: "Couldn't submit",
          description: msg || "Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const titleLabel = target.targetType === "collection"
    ? "Report this collection"
    : target.targetType === "user"
      ? "Report this user"
      : "Report this station";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titleLabel}</DialogTitle>
          {targetLabel && (
            <DialogDescription>{targetLabel}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-caption text-muted-foreground">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-caption text-muted-foreground">
              Tell us more (optional)
            </Label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Add any details that help us review"
              className="resize-none rounded-xl"
            />
            <p className="text-right text-caption text-muted-foreground tabular-nums">
              {details.length}/500
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason || submit.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submit.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
