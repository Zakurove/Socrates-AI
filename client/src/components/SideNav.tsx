import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isNavItemActive } from "@/lib/nav-items";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY = "sidenav-collapsed";

/**
 * Desktop / iPad-landscape left nav. Hidden below `lg` (<1024px) — at smaller
 * sizes `BottomNav` is the source of truth. Both shells render unconditionally
 * and the visibility flip is purely CSS (`hidden lg:flex` here, `lg:hidden` on
 * `BottomNav`) so Capacitor — which always renders <lg — never hits this code
 * path.
 *
 * Supports a collapsible icon-only mode (64px) toggled by the header button.
 * Preference is persisted in localStorage under `sidenav-collapsed`.
 */
export function SideNav() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // ignore — storage may be unavailable
    }
  }, [collapsed]);

  return (
    <aside
      className={cn(
        "hidden lg:flex sticky top-0 h-screen shrink-0 flex-col border-r border-border/60 bg-background/85 backdrop-blur-xl overflow-x-hidden transition-[width] duration-200 ease-in-out",
        collapsed ? "w-16" : "w-[248px]",
      )}
      aria-label="Primary"
    >
      {/* ── Header ── */}
      <div
        className={cn(
          "flex items-center pt-6 pb-4",
          collapsed ? "flex-col gap-2 px-0" : "gap-3 px-5",
        )}
      >
        <img
          src="/brand/icon.png"
          alt=""
          className="h-9 w-9 shrink-0 rounded-xl"
          aria-hidden
        />

        {/* Brand text — hidden when collapsed */}
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-h3 text-foreground">Socrates AI</div>
            <div className="text-caption text-muted-foreground">OSCE practice</div>
          </div>
        )}

        {/* Collapse / expand toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-muted/60 hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronLeft className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>

      {/* ── Nav items ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(item.path, location);
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <button
                  type="button"
                  onClick={() => navigate(item.path)}
                  aria-current={isActive ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex w-full items-center rounded-xl py-2.5 text-[15px] font-semibold transition-smooth",
                    collapsed ? "justify-center px-0" : "gap-3 px-3",
                    isActive
                      ? "bg-primary/[0.08] text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {/* Active left-edge accent bar (V70 brand echo) */}
                  {isActive && !collapsed && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary"
                    />
                  )}
                  <Icon
                    className="h-[18px] w-[18px] shrink-0"
                    strokeWidth={isActive ? 2.25 : 2}
                    aria-hidden
                  />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Account footer ── */}
      {user && (
        <div className="border-t border-border/60 px-2 py-3">
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className={cn(
              "flex w-full items-center rounded-lg py-2 text-left transition-smooth hover:bg-muted/60",
              collapsed ? "justify-center px-0" : "gap-3 px-2",
            )}
            aria-label="Account settings"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-caption font-semibold uppercase">
              {(user.email ?? "?").slice(0, 1)}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-caption font-semibold text-foreground">
                  {user.email ?? "Signed in"}
                </div>
              </div>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
