import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { BottomNav } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { shouldHideBottomNav, shouldHideSideNav } from "@/lib/navigation";

/**
 * Owns the responsive layout decision. Branches:
 *
 * - **fullBleed** (`/auth*`) — children render raw, no shell.
 * - **wide** (`/admin/*`) — existing 960px wrapper, no nav.
 * - **immersive** (practice runners, station detail with bottom CTA, etc., as
 *   determined by `shouldHideBottomNav`) — phone-frame on `<lg`, full-width
 *   main at `lg+`. No nav at any size; these pages own the viewport.
 * - **default** (tab pages) — phone-frame + BottomNav on `<lg`; SideNav-left
 *   + wider main at `lg+`.
 *
 * Both `SideNav` (`hidden lg:flex`) and `BottomNav` (`lg:hidden`) are always
 * rendered for the default branch — visibility is purely CSS so Capacitor (which
 * always loads at `<lg`) never executes the desktop branch.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  if (location.startsWith("/auth")) {
    return <>{children}</>;
  }

  if (location.startsWith("/admin/")) {
    return (
      <div className="app-backdrop min-h-screen w-full">
        <div className="relative mx-auto w-full max-w-[960px] min-h-screen bg-background">
          {children}
        </div>
      </div>
    );
  }

  // True immersive runners / editors / auth: no SideNav at any size. The
  // BottomNav is also hidden (these routes own their own viewport).
  if (shouldHideSideNav(location)) {
    return (
      <div className="app-backdrop min-h-screen w-full">
        <div className="phone-frame relative mx-auto w-full max-w-[440px] min-h-screen overflow-x-clip bg-background lg:max-w-screen-xl lg:overflow-visible lg:shadow-none">
          {children}
        </div>
      </div>
    );
  }

  // Default + "keep-sidenav-but-hide-bottomnav" routes share this branch. The
  // BottomNav is rendered conditionally so detail/browse pages with their own
  // bottom CTA don't double up on mobile.
  const hideBottomNav = shouldHideBottomNav(location);
  return (
    <div className="app-backdrop min-h-screen w-full">
      <div className="lg:flex lg:min-h-screen">
        <SideNav />
        <div className="phone-frame relative mx-auto w-full max-w-[440px] min-h-screen overflow-x-clip bg-background lg:mx-0 lg:max-w-none lg:flex-1 lg:overflow-visible lg:shadow-none">
          <EmailVerificationBanner />
          {children}
        </div>
      </div>
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}
