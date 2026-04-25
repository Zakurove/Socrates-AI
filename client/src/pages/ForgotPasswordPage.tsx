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
import { motion } from "framer-motion";
import { usePrefs } from "@/hooks/use-prefs";

const forgotSchema = z.object({
  email: z.string().email("Please enter a valid email"),
});
type ForgotFormT = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const { resolvedTheme } = usePrefs();
  const logoSrc = resolvedTheme === "dark" ? "/brand/logo-dark.png" : "/brand/logo.png";
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
    <div className="auth-bg fixed inset-0 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        className="relative max-w-sm mx-auto px-5 pt-16 pb-10 flex flex-col items-center"
      >
        <img src={logoSrc} alt="Socrates AI" className="h-[72px] w-auto" />
        <h1 className="mt-5 text-h1 text-foreground text-center">
          Forgot password?
        </h1>
        <p className="mt-2 text-body text-muted-foreground text-center max-w-xs">
          Enter your email and we'll send a reset link.
        </p>

        <div className="w-full mt-8">
          {submitted ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3 rounded-card bg-muted/60 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary mt-[1px]" />
                <div className="text-body text-foreground">
                  If an account exists for that email, we've sent a reset link.
                  Check your inbox — the link expires in 60 minutes.
                </div>
              </div>
              <Link
                href="/auth"
                className="flex items-center justify-center gap-2 text-caption text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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

              <div className="text-center">
                <Link
                  href="/auth"
                  className="text-caption text-muted-foreground hover:text-foreground transition-smooth"
                >
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
