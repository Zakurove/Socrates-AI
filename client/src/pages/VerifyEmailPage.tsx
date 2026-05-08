import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Mail, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell, AuthHero, StackedAuthCard } from "@/components/auth-shell";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

/**
 * "Check your inbox" page shown immediately after registration.
 *
 * Shares the AuthPage chrome — pure white surface, Owl glyph, hero
 * typography, stacked auth card. Soft-gate: the user can dismiss with
 * "I'll verify later" and continue using the app.
 *
 * Route: /auth/verify-email
 */
export default function VerifyEmailPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

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
    <AuthShell>
      <main className="px-6 pb-14 flex flex-col items-center min-h-[calc(100vh-72px)] justify-center">
        <AuthHero
          eyebrow="One More Step"
          headline="Check your inbox"
        />

        <div className="relative z-10 w-full max-w-[460px]">
          <StackedAuthCard>
            <div className="space-y-6">
              {/* Email-sent confirmation block */}
              <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F0E8FA] text-[#5A2E9A]">
                  <Mail className="h-5 w-5" aria-hidden />
                </div>
                <div className="text-[13px] leading-relaxed text-zinc-700">
                  We sent a verification link to{" "}
                  <span className="font-semibold text-zinc-900">
                    {user?.email ?? "your email address"}
                  </span>
                  . Open it from your inbox to confirm your account. The link
                  expires in 24 hours.
                </div>
              </div>

              {/* Resend */}
              {resendState === "sent" ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-[13px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  <span>Resent — check your inbox again.</span>
                </div>
              ) : (
                <div className="space-y-2">
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
                    <p
                      role="alert"
                      className="text-[12px] text-amber-700 text-center"
                    >
                      Couldn't send — please try again.
                    </p>
                  )}
                </div>
              )}

              {/* Skip */}
              <div className="pt-1 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => navigate("/home")}
                  className="inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  I'll verify later
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </StackedAuthCard>
        </div>

        <p className="mt-12 lg:mt-16 text-[12px] tracking-wide text-zinc-400">
          Trusted by trainees preparing for OSCE exams.
        </p>
      </main>
    </AuthShell>
  );
}
