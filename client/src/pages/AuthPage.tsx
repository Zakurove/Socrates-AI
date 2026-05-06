import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { usePrefs } from "@/hooks/use-prefs";
import { motion } from "framer-motion";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { AuthPanelLayout } from "@/components/AuthPanelLayout";

/**
 * Map a mutation error to a user-friendly message for the auth forms.
 * Never leaks server detail. Generic for 401 so email enumeration isn't possible.
 */
function friendlyAuthError(error: unknown, mode: "login" | "register"): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (msg.startsWith("401")) return "Incorrect email or password";
  if (msg.startsWith("429"))
    return "Too many attempts. Please wait a few minutes and try again.";
  if (mode === "register" && msg.startsWith("409"))
    return "An account with this email already exists";
  if (msg.startsWith("400")) return "Please check your details and try again.";
  // Generic fallback — never surface the raw server/status string.
  return mode === "login"
    ? "Couldn't sign you in. Please try again."
    : "Couldn't create your account. Please try again.";
}

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const registerSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

type LoginFormT = z.infer<typeof loginSchema>;
type RegisterFormT = z.infer<typeof registerSchema>;

type View = "login" | "register";

export default function AuthPage() {
  const { user, isLoginPending, isRegisterPending } = useAuth();
  const [, navigate] = useLocation();
  const [view, setView] = useState<View>("login");
  const { resolvedTheme } = usePrefs();
  const isDark = resolvedTheme === "dark";
  const logoSrc = isDark ? "/brand/logo-dark.png" : "/brand/logo.png";

  useEffect(() => {
    if (user) {
      // If the user just registered, RegisterForm set a sessionStorage flag and
      // already called navigate("/auth/verify-email"). Don't override it here.
      if (sessionStorage.getItem("socrates_just_registered")) {
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const from = params.get("from");
      const safeFrom =
        from && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/auth")
          ? from
          : "/home";
      navigate(safeFrom);
    }
  }, [user, navigate]);

  if (user) return null;

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
            Socrates AI
          </h1>
          <p className="mt-2 text-body text-muted-foreground text-center max-w-xs">
            Practice OSCEs with a patient who listens.
          </p>
        </div>

        <div className="hidden lg:block w-full">
          <h1 className="text-h1 text-foreground">Welcome</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Sign in or create an account to continue.
          </p>
        </div>

        <div className="w-full mt-8 lg:mt-6">
          <SegmentedTabs view={view} onChange={setView} />

          <div className="mt-6">
            {view === "login" ? (
              <LoginForm isPending={isLoginPending} />
            ) : (
              <RegisterForm isPending={isRegisterPending} />
            )}
          </div>

          <p className="text-caption text-muted-foreground mt-8 text-center lg:text-left">
            By continuing you agree to our Terms &amp; Privacy.
          </p>
        </div>
      </motion.div>
    </AuthPanelLayout>
  );
}

function SegmentedTabs({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Authentication mode"
      className="grid grid-cols-2 gap-1 p-1 rounded-full bg-muted/60 backdrop-blur"
    >
      {(["login", "register"] as const).map((v) => {
        const active = view === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v)}
            className={cn(
              "h-10 rounded-full text-[14px] font-semibold transition-smooth active:scale-[0.98]",
              active
                ? "bg-card text-foreground shadow-card"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {v === "login" ? "Sign in" : "Register"}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Login ---------- */

function LoginForm({ isPending }: { isPending: boolean }) {
  const { login } = useAuth();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    resetField,
    setFocus,
    formState: { errors },
  } = useForm<LoginFormT>({ resolver: zodResolver(loginSchema) });
  const [showPw, setShowPw] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (data: LoginFormT) => {
    setFormError(null);
    try {
      await login(data);
    } catch (err) {
      const message = friendlyAuthError(err, "login");
      // Inline error keeps the user on the page; toast makes it unmissable.
      setFormError(message);
      toast({
        variant: "warning",
        title: "Sign in failed",
        description: message,
      });
      // Keep email populated; clear password only so they can retry quickly.
      resetField("password");
      setFocus("password");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field id="login-email" label="Email" error={errors.email?.message}>
        <Input
          id="login-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@medical.edu"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
      </Field>

      <Field id="login-password" label="Password" error={errors.password?.message}>
        <div className="relative">
          <Input
            id="login-password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            className="pr-12"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-smooth"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>

      <InlineError message={formError} />

      <SubmitCTA label="Sign in" isPending={isPending} />

      <div className="text-center pt-1">
        <Link
          href="/auth/forgot"
          className="text-caption text-muted-foreground hover:text-foreground transition-smooth"
        >
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

/* ---------- Register (single step) ---------- */

function RegisterForm({ isPending }: { isPending: boolean }) {
  const { register: registerAccount } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    resetField,
    setFocus,
    formState: { errors },
  } = useForm<RegisterFormT>({ resolver: zodResolver(registerSchema) });
  const [showPw, setShowPw] = useState(false);
  const [serverMsg, setServerMsg] = useState<string | null>(null);

  const onSubmit = async (data: RegisterFormT) => {
    setServerMsg(null);
    try {
      const result = await registerAccount(data);
      if (!result.pending) {
        // New registration: show the "check your inbox" page.
        // Set a flag so AuthPage's useEffect doesn't override this navigation.
        sessionStorage.setItem("socrates_just_registered", "1");
        navigate("/auth/verify-email");
      }
    } catch (err) {
      const message = friendlyAuthError(err, "register");
      setServerMsg(message);
      toast({
        variant: "warning",
        title: "Couldn't create account",
        description: message,
      });
      resetField("password");
      setFocus("password");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field id="reg-name" label="Display name" error={errors.displayName?.message}>
        <Input
          id="reg-name"
          autoComplete="name"
          placeholder="Dr. Jane Smith"
          aria-invalid={!!errors.displayName}
          {...register("displayName")}
        />
      </Field>

      <Field id="reg-email" label="Email" error={errors.email?.message}>
        <Input
          id="reg-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@medical.edu"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
      </Field>

      <Field id="reg-password" label="Password" error={errors.password?.message}>
        <div className="relative">
          <Input
            id="reg-password"
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
      </Field>

      <InlineError message={serverMsg} />

      <SubmitCTA label="Create account" isPending={isPending} />
    </form>
  );
}

/* ---------- shared bits ---------- */

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-label text-muted-foreground">
        {label}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-caption text-warning">
          {error}
        </p>
      )}
    </div>
  );
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 text-caption text-warning"
    >
      <AlertCircle className="h-4 w-4 shrink-0 mt-[1px]" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

function SubmitCTA({
  label,
  isPending,
}: {
  label: string;
  isPending: boolean;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      disabled={isPending}
      className="w-full"
    >
      {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : label}
    </Button>
  );
}
