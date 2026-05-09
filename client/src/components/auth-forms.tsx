/**
 * Shared form pieces used by every auth variant. The state and submission
 * logic is identical across variants — only the chrome around them differs.
 *
 * Variants typically render `<AuthFormBlock view setView ... />` to get the
 * default segmented-tabs + login-or-register form bundle. A variant that
 * wants a different segmented-tab styling can compose lower-level pieces:
 * `<LoginForm />`, `<RegisterForm />`, and a custom segmented control.
 */
import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

export type AuthView = "login" | "register";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export type LoginFormT = z.infer<typeof loginSchema>;
export type RegisterFormT = z.infer<typeof registerSchema>;

export function friendlyAuthError(error: unknown, mode: "login" | "register"): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (msg.startsWith("401")) return "Incorrect email or password";
  if (msg.startsWith("429")) return "Too many attempts. Please wait a few minutes and try again.";
  if (mode === "register" && msg.startsWith("409")) return "An account with this email already exists";
  if (msg.startsWith("400")) return "Please check your details and try again.";
  return mode === "login"
    ? "Couldn't sign you in. Please try again."
    : "Couldn't create your account. Please try again.";
}

/* ───────── Default segmented tab control (rounded pill) ───────── */

export function SegmentedTabs({
  view,
  onChange,
  variant = "pill",
}: {
  view: AuthView;
  onChange: (v: AuthView) => void;
  /** `pill` = rounded pill (default). `square` = sharp segmented control. `underline` = no surface, just bottom borders. */
  variant?: "pill" | "square" | "underline";
}) {
  if (variant === "underline") {
    return (
      <div role="tablist" aria-label="Authentication mode" className="flex border-b border-border/40">
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
                "flex-1 px-4 pb-3 pt-2 text-[14px] font-semibold transition-smooth -mb-px border-b-2",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "login" ? "Sign in" : "Register"}
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === "square") {
    return (
      <div role="tablist" aria-label="Authentication mode" className="grid grid-cols-2 border border-foreground">
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
                "h-11 text-[13px] font-bold uppercase tracking-wider transition-smooth",
                active ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-muted",
              )}
            >
              {v === "login" ? "Sign in" : "Register"}
            </button>
          );
        })}
      </div>
    );
  }

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
              active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "login" ? "Sign in" : "Register"}
          </button>
        );
      })}
    </div>
  );
}

/* ───────── Form atoms ───────── */

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
    <div role="alert" className="flex items-start gap-2 text-caption text-warning">
      <AlertCircle className="h-4 w-4 shrink-0 mt-[1px]" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

function SubmitCTA({ label, isPending }: { label: string; isPending: boolean }) {
  return (
    <Button type="submit" size="lg" disabled={isPending} className="w-full">
      {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : label}
    </Button>
  );
}

/* ───────── Login form ───────── */

export function LoginForm({ isPending }: { isPending: boolean }) {
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
      setFormError(message);
      toast({ variant: "warning", title: "Sign in failed", description: message });
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
          autoComplete="username"
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
        <Link href="/auth/forgot" className="text-caption text-muted-foreground hover:text-foreground transition-smooth">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

/* ───────── Register form ───────── */

export function RegisterForm({ isPending }: { isPending: boolean }) {
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
        sessionStorage.setItem("socrates_just_registered", "1");
        navigate("/auth/verify-email");
      }
    } catch (err) {
      const message = friendlyAuthError(err, "register");
      setServerMsg(message);
      toast({ variant: "warning", title: "Couldn't create account", description: message });
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
          autoComplete="username"
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

/* ───────── Default form block (segmented tabs + form + legal) ───────── */

export function AuthFormBlock({
  view,
  setView,
  isLoginPending,
  isRegisterPending,
  tabsVariant = "pill",
  className,
}: {
  view: AuthView;
  setView: (v: AuthView) => void;
  isLoginPending: boolean;
  isRegisterPending: boolean;
  tabsVariant?: "pill" | "square" | "underline";
  className?: string;
}) {
  return (
    <div className={cn("space-y-6", className)}>
      <SegmentedTabs view={view} onChange={setView} variant={tabsVariant} />
      {view === "login" ? (
        <LoginForm isPending={isLoginPending} />
      ) : (
        <RegisterForm isPending={isRegisterPending} />
      )}
      <p className="text-caption text-muted-foreground text-center">
        By continuing you agree to our Terms &amp; Privacy.
      </p>
    </div>
  );
}
