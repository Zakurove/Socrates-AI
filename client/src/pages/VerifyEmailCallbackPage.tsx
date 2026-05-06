import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { CheckCircle2, XCircle, Loader2, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AuthPanelLayout } from "@/components/AuthPanelLayout";
import { useQueryClient } from "@tanstack/react-query";

type State = "loading" | "success" | "error";

/**
 * Handles the email verification deep-link.
 * Calls GET /api/auth/verify-email/:token on mount.
 * On success: invalidates /api/auth/me (so banner clears) then redirects to /home.
 * Routes: /auth/verify/:token
 */
export default function VerifyEmailCallbackPage() {
  const params = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("The link may have expired or already been used.");

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch(`/api/auth/verify-email/${encodeURIComponent(params.token ?? "")}`, {
          credentials: "include",
        });

        if (cancelled) return;

        if (res.ok) {
          setState("success");
          // Refresh user data so banner disappears
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          // Give the success screen a moment to show, then redirect
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

  return (
    <AuthPanelLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        className="relative max-w-sm mx-auto px-5 pt-16 pb-10 flex flex-col items-center justify-center min-h-[50vh] lg:pt-10 lg:pb-10 lg:min-h-0"
      >
        {state === "loading" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
            <p className="text-body text-muted-foreground">Verifying your email…</p>
          </div>
        )}

        {state === "success" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-primary" aria-hidden />
            <h1 className="text-h1 text-foreground">Email verified!</h1>
            <p className="text-body text-muted-foreground">
              Your email has been confirmed. Taking you to the app…
            </p>
            <Button
              type="button"
              size="lg"
              className="mt-2 w-full"
              onClick={() => navigate("/home")}
            >
              Go to home
            </Button>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-4 text-center w-full">
            <XCircle className="h-12 w-12 text-warning" aria-hidden />
            <h1 className="text-h1 text-foreground">Verification failed</h1>
            <p className="text-body text-muted-foreground">{errorMessage}</p>
            <div className="w-full space-y-3 mt-2">
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={() => navigate("/auth/verify-email")}
              >
                Request a new link
              </Button>
              <Link
                href="/auth"
                className="flex items-center justify-center gap-2 text-caption text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to sign in
              </Link>
            </div>
          </div>
        )}
      </motion.div>
    </AuthPanelLayout>
  );
}
