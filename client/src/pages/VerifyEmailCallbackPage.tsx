import { useEffect, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { CheckCircle2, XCircle, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { AuthShell, AuthHero, StackedAuthCard } from "@/components/auth-shell";

type State = "loading" | "success" | "error";

/**
 * Email-verification callback (deep-link from the verification email).
 * Calls GET /api/auth/verify-email/:token on mount.
 * Route: /auth/verify/:token
 */
export default function VerifyEmailCallbackPage() {
  const params = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>("loading");
  const [errorMessage, setErrorMessage] = useState<string>(
    "The link may have expired or already been used.",
  );

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch(
          `/api/auth/verify-email/${encodeURIComponent(params.token ?? "")}`,
          { credentials: "include" },
        );
        if (cancelled) return;
        if (res.ok) {
          setState("success");
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          setTimeout(() => {
            if (!cancelled) navigate("/home");
          }, 2000);
        } else {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) {
            setErrorMessage(
              (body as { message?: string }).message ??
                "The link may have expired or already been used.",
            );
            setState("error");
          }
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Something went wrong. Please try again.");
          setState("error");
        }
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [params.token, queryClient, navigate]);

  const eyebrow =
    state === "loading"
      ? "Verifying"
      : state === "success"
      ? "Verified"
      : "Verification Failed";
  const headline =
    state === "loading"
      ? "Verifying your email…"
      : state === "success"
      ? "Email verified"
      : "Couldn't verify";

  return (
    <AuthShell>
      <main className="px-6 pb-14 flex flex-col items-center min-h-[calc(100vh-72px)] justify-center">
        <AuthHero eyebrow={eyebrow} headline={headline} />

        <div className="relative z-10 w-full max-w-[460px]">
          <StackedAuthCard>
            {state === "loading" && (
              <div className="flex flex-col items-center justify-center py-6 gap-4 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-[#5A2E9A]" aria-hidden />
                <p className="text-[14px] text-zinc-600">
                  Confirming your email — one moment.
                </p>
              </div>
            )}

            {state === "success" && (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="text-[13px] leading-relaxed text-zinc-700">
                    Your email is confirmed. Taking you home in a moment…
                  </div>
                </div>
                <Button type="button" size="lg" className="w-full" onClick={() => navigate("/home")}>
                  Go to home
                </Button>
              </div>
            )}

            {state === "error" && (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-100 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <XCircle className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="text-[13px] leading-relaxed text-zinc-700">
                    {errorMessage}
                  </div>
                </div>

                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={() => navigate("/auth/verify-email")}
                >
                  Request a new link
                </Button>

                <div className="flex justify-center pt-1">
                  <Link
                    href="/auth"
                    className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to sign in
                  </Link>
                </div>
              </div>
            )}
          </StackedAuthCard>
        </div>

        <p className="mt-12 lg:mt-16 text-[12px] tracking-wide text-zinc-400">
          Trusted by trainees preparing for OSCE exams.
        </p>
      </main>
    </AuthShell>
  );
}
