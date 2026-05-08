import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Star, Clock, MessageSquare, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthFormBlock, type AuthView } from "@/components/auth-forms";
import { AuthShell, AuthHero, StackedAuthCard } from "@/components/auth-shell";

/**
 * Sign in / Register page.
 *
 * Hero (For Medical Learners · Welcome back · Build · Practice · Learn) sits
 * above a stacked auth card flanked by two decorative station previews
 * (Headache + Shoulder Examination) at `lg+`. Mobile collapses to just the
 * hero + main card.
 */
export default function AuthPage() {
  const { user, isLoginPending, isRegisterPending } = useAuth();
  const [, navigate] = useLocation();
  const [view, setView] = useState<AuthView>("login");

  // One-time cleanup of leftover state from the variant-prototype era —
  // strip `?v=N` from the URL and clear the persisted localStorage key.
  // Safe to remove this block in a future commit once everyone's browsers
  // have hit /auth at least once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("v")) {
      url.searchParams.delete("v");
      window.history.replaceState({}, "", url.toString());
    }
    try {
      localStorage.removeItem("auth-variant");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (user) {
      // Unverified users go to the verify-email landing page first.
      if (!user.emailVerifiedAt) {
        navigate("/auth/verify-email");
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
    <AuthShell>
      <main className="px-6 pb-14 flex flex-col items-center min-h-[calc(100vh-72px)] justify-center">
        <AuthHero
          eyebrow="For Medical Learners"
          headline={view === "login" ? "Welcome back" : "Begin your practice"}
        />

        <div className="relative flex items-center justify-center w-full">
          {/* Left preview — Headache */}
          <div
            aria-hidden
            className="hidden lg:block absolute right-[calc(50%+250px)] -rotate-6 translate-y-12 pointer-events-none select-none"
          >
            <PreviewStation
              title="Headache"
              type="History Taking"
              icon={<MessageSquare className="h-4 w-4" />}
              accentBg="#F0E8FA"
              accentTint="#7B4DB8"
              meta="7 min · 12 items"
              sections={["History", "Examination", "Diagnosis"]}
              stars={42}
            />
          </div>

          {/* Main auth card */}
          <div className="relative z-10 w-full max-w-[460px]">
            <StackedAuthCard>
              <AuthFormBlock
                view={view}
                setView={setView}
                isLoginPending={isLoginPending}
                isRegisterPending={isRegisterPending}
                tabsVariant="pill"
              />
            </StackedAuthCard>
          </div>

          {/* Right preview — Shoulder Examination */}
          <div
            aria-hidden
            className="hidden lg:block absolute left-[calc(50%+250px)] rotate-6 translate-y-12 pointer-events-none select-none"
          >
            <PreviewStation
              title="Shoulder Examination"
              type="Physical Exam"
              icon={<Stethoscope className="h-4 w-4" />}
              accentBg="#FFF3DC"
              accentTint="#E8A520"
              meta="12 min · 49 items"
              sections={["Inspection", "Palpation", "Special Tests"]}
              stars={87}
            />
          </div>
        </div>

        <p className="mt-12 lg:mt-16 text-[12px] tracking-wide text-zinc-400">
          Trusted by trainees preparing for OSCE exams.
        </p>
      </main>
    </AuthShell>
  );
}

/* ───────── Decorative preview station card ───────── */

function PreviewStation({
  title,
  type,
  icon,
  accentBg,
  accentTint,
  meta,
  sections,
  stars,
}: {
  title: string;
  type: string;
  icon: React.ReactNode;
  accentBg: string;
  accentTint: string;
  meta: string;
  sections: string[];
  stars: number;
}) {
  return (
    <div
      className={cn(
        "w-[210px] rounded-2xl bg-white border border-zinc-100 p-4 space-y-3.5",
        "shadow-[0_18px_50px_-12px_rgba(0,0,0,0.10)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center"
          style={{ background: accentBg, color: accentTint }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[12px] font-bold text-zinc-900 leading-tight truncate">
            {title}
          </p>
          <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">{type}</p>
        </div>
      </div>
      <ul className="space-y-1.5 pl-0.5">
        {sections.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: accentTint }}
            />
            <span className="text-[11px] text-zinc-600 leading-tight">{s}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between pt-2.5 border-t border-zinc-100">
        <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 font-medium tabular-nums">
          <Clock className="h-3 w-3" aria-hidden />
          {meta}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold tabular-nums"
          style={{ color: accentTint }}
        >
          <Star className="h-3 w-3 fill-current" aria-hidden />
          {stars}
        </span>
      </div>
    </div>
  );
}
