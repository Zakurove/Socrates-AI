import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { motion } from "framer-motion";
import { usePrefs } from "@/hooks/use-prefs";
import { AuthPanelLayout } from "@/components/AuthPanelLayout";

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

export default function ResetPasswordPage() {
  const [, params] = useRoute<{ token: string }>("/auth/reset/:token");
  const [, navigate] = useLocation();
  const { resolvedTheme } = usePrefs();
  const logoSrc = resolvedTheme === "dark" ? "/brand/logo-dark.png" : "/brand/logo.png";
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
    <AuthPanelLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        className="relative max-w-sm mx-auto px-5 pt-16 pb-10 flex flex-col items-center lg:pt-10 lg:pb-10"
      >
        <div className="lg:hidden flex flex-col items-center">
          <img src={logoSrc} alt="Socrates AI" className="h-[72px] w-auto" />
          <h1 className="mt-5 text-h1 text-foreground text-center">
            Choose a new password
          </h1>
          <p className="mt-2 text-body text-muted-foreground text-center max-w-xs">
            At least 10 characters. You'll be signed out of other sessions.
          </p>
        </div>

        <div className="hidden lg:block w-full">
          <h1 className="text-h1 text-foreground">Choose a new password</h1>
          <p className="mt-1 text-body text-muted-foreground">
            At least 10 characters. You'll be signed out of other sessions.
          </p>
        </div>

        <div className="w-full mt-8 lg:mt-6">
          {done ? (
            <div className="flex items-start gap-3 rounded-card bg-muted/60 p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary mt-[1px]" />
              <div className="text-body text-foreground">
                Password updated. Redirecting you to sign in...
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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
                <div
                  role="alert"
                  className="flex items-start gap-2 text-caption text-warning"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-[1px]" aria-hidden />
                  <span>{serverMsg}</span>
                </div>
              )}

              <Button type="submit" size="lg" disabled={pending || !token} className="w-full">
                {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Update password"}
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
    </AuthPanelLayout>
  );
}
