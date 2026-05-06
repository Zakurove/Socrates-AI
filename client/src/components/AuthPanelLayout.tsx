import type { ReactNode } from "react";

/**
 * Two-column auth shell for /auth, /auth/forgot, /auth/reset/:token.
 *
 * - **Below lg** (mobile / tablet portrait): renders identically to the prior
 *   shell — a single `auth-bg fixed inset-0 overflow-y-auto` container with the
 *   form motion.div centered inside it. Capacitor + iPad both fall in here.
 * - **At lg+**: switches to a 2-col grid `[1fr 480px]`. Left column is a
 *   purple-gradient info panel with brand copy. Right column is a plain
 *   `bg-background` surface that holds the same form content, vertically
 *   centered.
 *
 * Implementation notes:
 * - Single DOM tree — children are rendered once, no double-mount of form
 *   state. The panel is `hidden lg:flex`; the right column reuses the same
 *   wrapper at all sizes.
 * - The page-level form components (AuthPage / ForgotPasswordPage /
 *   ResetPasswordPage) keep their existing motion.div centered card layout for
 *   mobile. Their leading logo+title block hides at `lg:hidden` (added in each
 *   page) because the panel covers brand identity at desktop.
 */
export function AuthPanelLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-bg fixed inset-0 overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[1fr_480px] lg:[background:none]">
      <aside
        aria-hidden
        className="hidden lg:flex relative bg-gradient-to-br from-primary-700 via-primary-800 to-primary-900 overflow-hidden"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_30%_20%,white_0%,transparent_45%),radial-gradient(circle_at_80%_80%,white_0%,transparent_50%)]"
        />
        <div className="relative z-10 w-full max-w-2xl mx-auto px-12 py-16 flex flex-col justify-between">
          <div>
            <img
              src="/brand/logo-dark.png"
              alt="Socrates AI"
              className="h-10 w-auto"
            />

            <h2 className="mt-14 text-h1 leading-tight text-primary-foreground">
              OSCE practice, built around how you study.
            </h2>

            <p className="mt-5 text-body text-primary-100/90 leading-relaxed max-w-xl">
              Build your own stations and checklists. Practice with Socrates —
              an AI patient who responds the way real patients do.
            </p>

            <ul className="mt-10 space-y-4 max-w-xl">
              {[
                "Build any case type — history taking, physical exam, image ID, communication skills.",
                "Run timed mock exams in a realistic multi-station circuit.",
                "Share your stations with colleagues through the community library.",
              ].map((bullet) => (
                <li
                  key={bullet}
                  className="flex items-start gap-3 text-body text-primary-100/90 leading-relaxed"
                >
                  <span
                    aria-hidden
                    className="mt-[10px] h-1.5 w-1.5 rounded-full bg-brand-accent shrink-0"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-caption text-primary-200/70">
            Used by medical students and residents preparing for OSCE exams.
          </p>
        </div>
      </aside>

      <div className="lg:bg-background lg:overflow-y-auto lg:flex lg:flex-col lg:justify-center">
        {children}
      </div>
    </div>
  );
}
