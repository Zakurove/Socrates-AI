import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { AuthShell, AuthHero, StackedAuthCard } from "@/components/auth-shell";

const forgotSchema = z.object({
  email: z.string().email("Please enter a valid email"),
});
type ForgotFormT = z.infer<typeof forgotSchema>;

/**
 * Route: /auth/forgot
 * Same V70 chrome as the sign-in page. Always shows the success-shaped UI
 * after submit to prevent email enumeration.
 */
export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotFormT>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = async (data: ForgotFormT) => {
    setPending(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", data);
    } catch {
      // Always show the same success-shaped UI to prevent email enumeration.
    } finally {
      setPending(false);
      setSubmitted(true);
    }
  };

  return (
    <AuthShell>
      <main className="px-6 pb-14 flex flex-col items-center min-h-[calc(100vh-72px)] justify-center">
        <AuthHero
          eyebrow="Account Recovery"
          headline={submitted ? "Check your inbox" : "Forgot password?"}
        />

        <div className="relative z-10 w-full max-w-[460px]">
          <StackedAuthCard>
            {submitted ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 border border-zinc-100 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F0E8FA] text-[#5A2E9A]">
                    <CheckCircle2 className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="text-[13px] leading-relaxed text-zinc-700">
                    If an account exists for that email, we've sent a reset
                    link. The link expires in 60 minutes.
                  </div>
                </div>

                <div className="flex justify-center">
                  <Link
                    href="/auth"
                    className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to sign in
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <p className="text-[14px] text-zinc-600">
                  Enter your email and we'll send a reset link.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="forgot-email" className="text-label text-muted-foreground">
                    Email
                  </Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@medical.edu"
                    aria-invalid={!!errors.email}
                    {...register("email")}
                  />
                  {errors.email?.message && (
                    <p role="alert" className="text-caption text-warning">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <Button type="submit" size="lg" disabled={pending} className="w-full">
                  {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send reset link"}
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
