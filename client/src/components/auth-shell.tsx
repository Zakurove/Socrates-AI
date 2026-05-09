import type { ReactNode } from "react";
import { AlphaBadge } from "@/components/AlphaBadge";

/**
 * Shared chrome for every auth-flow page (sign in / register / verify email /
 * forgot password / reset password / invite accept).
 *
 * - `AuthShell` — pure white surface + decorative Owl glyph in the lower
 *   right + the brand header at the top. Wraps the page content.
 * - `StackedAuthCard` — V25-shape layered card: two rotated brand-purple
 *   cards behind a frosted glass frame around a white inner card. The
 *   shadow is intentionally neutral (not purple) so the chroma stays
 *   contained to the stack itself.
 *
 * Hero typography (eyebrow chip + display headline + sub) is page-specific
 * and lives in each page file, not here.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      {/* Decorative Owl glyph — lower-right, very subtle */}
      <img
        src="/brand/icon.png"
        alt=""
        aria-hidden
        className="hidden md:block absolute -bottom-20 -right-20 h-[420px] w-[420px] rotate-[-12deg] pointer-events-none opacity-[0.05]"
      />

      <div className="relative">
        <header className="px-6 sm:px-10 py-6 flex items-center gap-2.5">
          <img
            src="/brand/icon.png"
            alt=""
            aria-hidden
            className="h-8 w-8 rounded-lg"
          />
          <span className="text-[15px] font-bold tracking-tight text-zinc-900">
            Socrates AI
          </span>
          <AlphaBadge />
        </header>
        {children}
      </div>
    </div>
  );
}

export function StackedAuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-full max-w-[460px]">
      {/* Back stack card */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-3xl -rotate-2 translate-y-3 -translate-x-1.5 opacity-90 bg-[#2D1152]"
      />
      {/* Mid stack card */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-3xl rotate-1 translate-y-1.5 translate-x-1.5 opacity-95 bg-[#5A2E9A]"
      />
      {/* Glass frame + inner white card */}
      <div className="relative rounded-3xl border border-white/55 bg-white/55 backdrop-blur-2xl p-2 shadow-[0_25px_60px_-20px_rgba(0,0,0,0.12)]">
        <div className="rounded-[20px] bg-white p-7 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

/**
 * Hero block — pulse-dot eyebrow + display headline + Build · Practice · Learn
 * motto. Used by AuthPage; verify/forgot/reset use a similar pattern but
 * with their own contextual eyebrow + headline.
 */
export function AuthHero({
  eyebrow,
  headline,
  sub,
}: {
  eyebrow: string;
  headline: string;
  /** Defaults to the brand motto. Pass a custom node to override. */
  sub?: ReactNode;
}) {
  return (
    <div className="text-center mb-10 lg:mb-12 max-w-2xl">
      <div className="inline-flex items-center gap-2.5 mb-6">
        <span aria-hidden className="relative inline-flex h-2 w-2">
          <span className="absolute inset-0 rounded-full bg-[#E8A520] opacity-50 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8A520]" />
        </span>
        <span className="text-[11px] uppercase tracking-[0.3em] font-bold text-[#5A2E9A]">
          {eyebrow}
        </span>
      </div>
      <h1 className="text-[clamp(38px,6vw,56px)] font-bold tracking-[-0.025em] leading-[0.98] text-zinc-900 mb-5">
        {headline}
      </h1>
      {sub ?? <BrandMotto />}
    </div>
  );
}

export function BrandMotto() {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[16px] sm:text-[17px] tracking-tight">
      <span className="font-semibold text-zinc-800">Build</span>
      <span aria-hidden className="text-zinc-300 font-bold">·</span>
      <span className="font-semibold text-zinc-800">Practice</span>
      <span aria-hidden className="text-zinc-300 font-bold">·</span>
      <span className="font-semibold text-zinc-800">Learn</span>
    </p>
  );
}
