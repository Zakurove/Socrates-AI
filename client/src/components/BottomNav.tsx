import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Home, BookOpen, Globe2, Users, Settings, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { path: "/home", label: "Home", icon: Home },
  { path: "/my-stations", label: "Stations", icon: BookOpen },
  { path: "/mock-exam", label: "Mock", icon: Timer },
  { path: "/collections", label: "Groups", icon: Users },
  { path: "/library", label: "Library", icon: Globe2 },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  const [location, navigate] = useLocation();
  const navRef = useRef<HTMLElement>(null);

  // Expose actual rendered nav height as a CSS var so pages can pad accurately.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const setVar = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--bottom-nav-h", `${h}px`);
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    window.addEventListener("resize", setVar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-[440px] -translate-x-1/2 border-t border-border/30 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 safe-bottom"
    >
      <div className="flex h-[76px] items-stretch justify-around px-1">
        {tabs.map((tab) => {
          const isActive =
            location === tab.path || location.startsWith(tab.path + "/");
          const Icon = tab.icon;

          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-smooth active:scale-[0.98]",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon
                className="h-[22px] w-[22px]"
                strokeWidth={isActive ? 2.25 : 2}
                aria-hidden
              />
              <span className="text-[10px] font-semibold tracking-tight">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
