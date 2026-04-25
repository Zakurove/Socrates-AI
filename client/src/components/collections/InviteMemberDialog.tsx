import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertCircle, Check, Copy } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useCreateInvite } from "@/hooks/use-invites";
import { useAuth } from "@/hooks/use-auth";
import type { CollectionRole } from "@shared/schema";

const schema = z.object({
  email: z.string().email("Please enter a valid email"),
  role: z.enum(["viewer", "editor"]),
});

type FormT = z.infer<typeof schema>;

interface InviteMemberDialogProps {
  collectionId: number;
  collectionTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({
  collectionId,
  collectionTitle,
  open,
  onOpenChange,
}: InviteMemberDialogProps) {
  const { toast } = useToast();
  const createInvite = useCreateInvite();
  const { user } = useAuth();
  const [successState, setSuccessState] = useState<
    | { kind: "sent"; email: string }
    | { kind: "link"; email: string; url: string }
    | null
  >(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors },
  } = useForm<FormT>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "viewer" },
  });
  const role = watch("role");

  // Reset when dialog closes so next open is fresh.
  useEffect(() => {
    if (!open) {
      setSuccessState(null);
      setCopied(false);
      reset({ email: "", role: "viewer" });
    }
  }, [open, reset]);

  const onSubmit = async (data: FormT) => {
    // Client-side guard: inviting yourself does nothing useful and the
    // server would reject it anyway. Show an inline error instead of
    // round-tripping to a toast.
    if (
      user?.email &&
      data.email.trim().toLowerCase() === user.email.toLowerCase()
    ) {
      setError("email", {
        type: "manual",
        message: "You&rsquo;re already the owner — no need to invite yourself.".replace("&rsquo;", "'"),
      });
      return;
    }
    try {
      const result = await createInvite.mutateAsync({
        collectionId,
        email: data.email,
        role: data.role,
      });
      if (result.sent) {
        setSuccessState({ kind: "sent", email: data.email });
      } else {
        setSuccessState({
          kind: "link",
          email: data.email,
          url: result.inviteUrl,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      if (msg.startsWith("409")) {
        setError("email", {
          type: "manual",
          message: "This user is already a member.",
        });
        return;
      }
      toast({
        title: "Couldn't send invite",
        description:
          "Couldn't send invite. Check connection and try again.",
        variant: "warning",
      });
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the link manually.",
        variant: "warning",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:max-w-full max-sm:p-5 data-[state=open]:max-sm:slide-in-from-bottom-[48%] data-[state=closed]:max-sm:slide-out-to-bottom-[48%]">
        {successState ? (
          <SuccessView
            state={successState}
            copied={copied}
            onCopy={handleCopy}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Invite someone to &ldquo;{collectionTitle}&rdquo;</DialogTitle>
              <DialogDescription>
                They&rsquo;ll get a link to join as a viewer or editor.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email" className="text-label text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="colleague@hospital.org"
                  aria-invalid={!!errors.email}
                  {...register("email")}
                />
                {errors.email?.message && (
                  <p
                    role="alert"
                    aria-live="polite"
                    className="flex items-start gap-1.5 text-caption text-warning"
                  >
                    <AlertCircle className="h-3.5 w-3.5 mt-[2px] shrink-0" aria-hidden />
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-role" className="text-label text-muted-foreground">
                  Role
                </Label>
                <Select
                  value={role}
                  onValueChange={(v) =>
                    setValue("role", v as Extract<CollectionRole, "viewer" | "editor">)
                  }
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createInvite.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createInvite.isPending}>
                {createInvite.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send invite"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuccessView({
  state,
  copied,
  onCopy,
  onDone,
}: {
  state:
    | { kind: "sent"; email: string }
    | { kind: "link"; email: string; url: string };
  copied: boolean;
  onCopy: (url: string) => void;
  onDone: () => void;
}) {
  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Check className="h-5 w-5 text-primary" aria-hidden />
          {state.kind === "sent" ? "Invite sent" : "Share this link"}
        </DialogTitle>
        <DialogDescription>
          {state.kind === "sent" ? (
            <>
              Invite sent to <strong>{state.email}</strong>. They&rsquo;ll get an
              email with a link to join.
            </>
          ) : (
            "Share this link. Valid for 7 days."
          )}
        </DialogDescription>
      </DialogHeader>

      {state.kind === "link" && (
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 p-2">
          <code className="flex-1 truncate px-2 text-caption text-foreground">
            {state.url}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCopy(state.url)}
            aria-label="Copy invite link"
            className="shrink-0"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copy
              </>
            )}
          </Button>
        </div>
      )}

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
