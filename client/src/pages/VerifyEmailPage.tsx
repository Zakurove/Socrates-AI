import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { AuthPanelLayout } from "@/components/AuthPanelLayout";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { usePrefs } from "@/hooks/use-prefs";

/**
 * "Check your inbox" page shown immediately after registration.
 * Soft-gate — user can navigate away at any time.
 * Routes: /auth/verify-email
 */
export default function VerifyEmailPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { resolvedTheme } = usePrefs();
  const logoSrc = resolvedTheme === "dark" ? "/brand/logo-dark.png" : "/brand/logo.png";

  const [resendState, setResendState] = useState<"idle" | "pending" | "sent" | "error">("idle");

  // Clear the registration flag so AuthPage doesn't suppress future redirects
  useEffect(() => {
    sessionStorage.removeItem("socrates_just_registered");
  }, []);

  const handleResend = async () => {
    setResendState("pending");
    try {
      await apiRequest("POST", "/api/auth/verify-email/send", {});
      setResendState("sent");
    } catch {
      setResendState("error");
    }
  };

  return (
    <AuthPanelLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        className="relative max-w-sm mx-auto px-5 pt-16 pb-10 flex flex-col items-center lg:pt-10 lg:pb-10"
      >
        {/* Mobile: logo + title */}
        <div className="lg:hidden flex flex-col items-center">
          <img src={logoSrc} alt="Socrates AI" className="h-[72px] w-auto" />
          <h1 className="mt-5 text-h1 text-foreground text-center">Check your inbox</h1>
          <p className="mt-2 text-body text-muted-foreground text-center max-w-xs">
            We sent a verification link to confirm your email address.
          </p>
        </div>

        {/* Desktop: plain heading */}
        <div className="hidden lg:block w-full">
          <h1 className="text-h1 text-foreground">Check your inbox</h1>
          <p className="mt-1 text-body text-muted-foreground">
            We sent a verification link to confirm your email address.
          </p>
        </div>

        <div className="w-full mt-8 lg:mt-6 space-y-5">
          {/* Mail icon card */}
          <div className="flex items-start gap-3 rounded-card bg-muted/60 p-4">
            <Mail className="h-5 w-5 shrink-0 text-primary mt-[1px]" aria-hidden />
            <div className="text-body text-foreground">
              Verification email sent to{" "}
              <span className="font-semibold">{user?.email ?? "your email address"}</span>.
              Check your inbox — the link expires in 24 hours.
            </div>
          </div>

          {/* Resend */}
          {resendState === "sent" ? (
            <div className="flex items-center gap-2 text-caption text-primary">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              <span>Resent! Check your inbox again.</span>
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                disabled={resendState === "pending"}
                onClick={handleResend}
              >
                {resendState === "pending" ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  "Resend verification email"
                )}
              </Button>
              {resendState === "error" && (
                <p role="alert" className="text-caption text-warning text-center">
                  Something went wrong. Please try again.
                </p>
              )}
            </div>
          )}

          {/* Skip */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="text-caption text-muted-foreground hover:text-foreground transition-smooth"
            >
              I'll verify later →
            </button>
          </div>
        </div>
      </motion.div>
    </AuthPanelLayout>
  );
}
