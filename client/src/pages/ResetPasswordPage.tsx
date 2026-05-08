import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { AuthShell, AuthHero, StackedAuthCard } from "@/components/auth-shell";

const resetSchema = z
  .object({
    password: z.string().min(10, "Password must be at least 10 characters"),
    confirm: z.string().min(10, "Please confirm your new password"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });
type ResetFormT = z.infer<typeof resetSchema>;

/**
 * Route: /auth/reset/:token
 */
export default function ResetPasswordPage() {
  const [, params] = useRoute<{ token: string }>("/auth/reset/:token");
  const [, navigate] = useLocation();
  const token = params?.token ?? "";

  const [pending, setPending] = useState(false);
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormT>({ resolver: zodResolver(resetSchema) });

  const onSubmit = async (data: ResetFormT) => {
    setServerMsg(null);
    setPending(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", {
        token,
        password: data.password,
      });
      setDone(true);
      setTimeout(() => navigate("/auth"), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("expired")) {
        setServerMsg("This reset link has expired. Request a new one.");
      } else if (msg.includes("used")) {
        setServerMsg("This link has already been used. Request a new one.");
      } else if (msg.startsWith("429")) {
        setServerMsg("Too many attempts. Please wait a few minutes.");
      } else {
        setServerMsg("Invalid or expired link. Please request a new one.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell>
      <main className="px-6 pb-14 flex flex-col items-center min-h-[calc(100vh-72px)] justify-center">
        <AuthHero
          eyebrow="Account Recovery"
          headline={done ? "Password updated" : "Choose a new password"}
        />

        <div className="relative z-10 w-full max-w-[460px]">
          <StackedAuthCard>
            {done ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="text-[13px] leading-relaxed text-zinc-700">
                    Your password has been updated. Redirecting you to sign
                    in…
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <p className="text-[14px] text-zinc-600">
                  At least 10 characters. You'll be signed out of other
                  sessions.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="reset-password" className="text-label text-muted-foreground">
                    New password
                  </Label>
                  <div className="relative">
                    <Input
                      id="reset-password"
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="At least 10 characters"
                      className="pr-16"
                      aria-invalid={!!errors.password}
                      {...register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-muted-foreground hover:text-foreground transition-smooth"
                    >
                      {showPw ? "Hide" : "Show"}
                    </button>
                  </div>
                  {errors.password?.message && (
                    <p role="alert" className="text-caption text-warning">
                      {errors.password.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-confirm" className="text-label text-muted-foreground">
                    Confirm new password
                  </Label>
                  <Input
                    id="reset-confirm"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    aria-invalid={!!errors.confirm}
                    {...register("confirm")}
                  />
                  {errors.confirm?.message && (
                    <p role="alert" className="text-caption text-warning">
                      {errors.confirm.message}
                    </p>
                  )}
                </div>

                {serverMsg && (
                  <div role="alert" className="flex items-start gap-2 text-caption text-warning">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-[1px]" aria-hidden />
                    <span>{serverMsg}</span>
                  </div>
                )}

                <Button type="submit" size="lg" disabled={pending || !token} className="w-full">
                  {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Update password"}
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
              </form>
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
