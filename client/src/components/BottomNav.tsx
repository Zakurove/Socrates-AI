import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isNavItemActive } from "@/lib/nav-items";

export function BottomNav() {
  const [location, navigate] = useLocation();
  const navRef = useRef<HTMLElement>(null);

  // Tabs visible on small screens. Desktop-only items live in the SideNav.
  const tabs = NAV_ITEMS.filter((item) => !item.desktopOnly);

  // Expose actual rendered nav height as a CSS var so pages can pad accurately.
  // At lg+ the element is `display:none` (height = 0) and the var resolves to 0,
  // so any `pb-[calc(var(--bottom-nav-h)+...)]` padding collapses gracefully.
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
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-[440px] -translate-x-1/2 border-t border-border/30 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 safe-bottom lg:hidden"
    >
      <div className="flex h-[76px] items-stretch justify-around px-1">
        {tabs.map((tab) => {
          const isActive = isNavItemActive(tab.path, location);
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
