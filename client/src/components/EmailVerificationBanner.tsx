import { useState } from "react";
import { MailWarning, X, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * Soft-gate verification nudge. Rendered inside AppShell when the signed-in
 * user has not yet verified their email (`user.emailVerifiedAt` is null).
 *
 * Dismissible per-session (survives navigation but reappears on page reload
 * until the user clicks the verification link). All routes remain accessible.
 */
export function EmailVerificationBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "pending" | "sent" | "error">("idle");

  // Only show when signed in + not yet verified + not dismissed
  if (!user || user.emailVerifiedAt || dismissed) return null;

  const handleResend = async () => {
    if (resendState === "pending" || resendState === "sent") return;
    setResendState("pending");
    try {
      await apiRequest("POST", "/api/auth/verify-email/send", {});
      setResendState("sent");
      // Re-check verification status after a successful resend (in case the
      // user clicked the link in another tab between now and the resend)
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {
      setResendState("error");
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-center gap-3 bg-warning/10 border-b border-warning/20 px-4 py-2.5 text-[13px] text-foreground"
    >
      <MailWarning className="h-4 w-4 shrink-0 text-warning" aria-hidden />

      <span className="flex-1 leading-snug">
        Verify your email address.{" "}
        {resendState === "sent" ? (
          <span className="inline-flex items-center gap-1 text-primary font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Resent!
          </span>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            disabled={resendState === "pending"}
            className="font-semibold text-primary hover:underline disabled:opacity-60 inline-flex items-center gap-1"
          >
            {resendState === "pending" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Sending…
              </>
            ) : (
              "Resend email"
            )}
          </button>
        )}
        {resendState === "error" && (
          <span className="ml-1 text-warning"> — couldn't send, try again.</span>
        )}
      </span>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss verification reminder"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-smooth"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
