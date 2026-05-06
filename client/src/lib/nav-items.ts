import {
  BookOpen,
  Globe2,
  Home,
  LineChart,
  Settings,
  Timer,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Visible only on the desktop side-nav. */
  desktopOnly?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/home", label: "Home", icon: Home },
  { path: "/my-stations", label: "Stations", icon: BookOpen },
  { path: "/mock-exam", label: "Mock", icon: Timer },
  { path: "/collections", label: "Groups", icon: Users },
  { path: "/library", label: "Library", icon: Globe2 },
  { path: "/progress", label: "Progress", icon: LineChart, desktopOnly: true },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

export function isNavItemActive(itemPath: string, location: string): boolean {
  return location === itemPath || location.startsWith(itemPath + "/");
}
