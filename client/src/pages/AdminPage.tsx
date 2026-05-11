import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  Loader2,
  ShieldAlert,
  Users,
  BookOpen,
  Users2,
  Flag,
  MessageSquareWarning,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAdminOverview } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export default function AdminPage() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError, error } = useAdminOverview();

  useEffect(() => {
    document.title = "Admin — Socrates AI";
  }, []);

  const isAdmin = !!(user as { isAdmin?: boolean } | null)?.isAdmin;
  const status = (error as Error | null)?.message?.match(/^(\d+):/)?.[1];
  const forbidden = status === "403" || status === "401";

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin || forbidden) {
    return (
      <div className="min-h-screen bg-background pb-12">
        <PageHeader title="Admin" backTo="/settings" />
        <main className="mx-auto max-w-[900px] px-5 pt-12 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="text-h2 text-foreground">Admin access required</h2>
          <p className="mt-2 text-body text-muted-foreground">
            You don't have permission to view this page.
          </p>
          <Button
            variant="outline"
            className="mt-4 rounded-full"
            onClick={() => navigate("/home")}
          >
            Back to home
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader
        title="Admin"
        backTo="/settings"
        actions={
          <div className="flex items-center gap-1.5 pr-1 text-caption text-muted-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Admin
          </div>
        }
      />

      <main className="mx-auto max-w-[900px] px-5 pt-6">
        <header className="mb-6">
          <h1 className="font-display text-h1 text-foreground">Admin</h1>
          <p className="text-body text-muted-foreground">
            Operations, moderation, and analytics.
          </p>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl bg-warm-100"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-5 py-6 text-center">
            <p className="text-body text-foreground">
              Couldn't load admin overview.
            </p>
          </div>
        ) : data ? (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total users" value={String(data.totalUsers)} />
            <StatCard label="Stations" value={String(data.totalStations)} />
            <StatCard
              label="Sessions today"
              value={String(data.sessionsToday)}
            />
            <StatCard
              label="AI spend today"
              value={`$${(data.aiSpendTodayUsd ?? data.aiCostUsdToday ?? 0).toFixed(2)}`}
            />
          </section>
        ) : null}

        <section className="mt-8 grid gap-3 lg:grid-cols-2">
          <NavCard
            icon={Users}
            title="User accounts"
            subtitle={
              data ? `${data.totalUsers.toLocaleString()} total` : "—"
            }
            onClick={() => navigate("/admin/users")}
          />
          <NavCard
            icon={BookOpen}
            title="Stations"
            subtitle={
              data
                ? `${data.totalStations.toLocaleString()} total · ${data.publicStations.toLocaleString()} public`
                : "—"
            }
            onClick={() => navigate("/admin/stations")}
          />
          <NavCard
            icon={Users2}
            title="Collections"
            subtitle={
              data
                ? data.publicCollections !== undefined
                  ? `${data.totalCollections.toLocaleString()} total · ${data.publicCollections.toLocaleString()} public`
                  : `${data.totalCollections.toLocaleString()} total`
                : "—"
            }
            onClick={() => navigate("/admin/collections")}
          />
          <NavCard
            icon={Flag}
            title="Moderation queue"
            subtitle={
              data && data.openReports !== undefined
                ? `${data.openReports.toLocaleString()} open report${data.openReports === 1 ? "" : "s"}`
                : "Open reports + community moderation"
            }
            onClick={() => navigate("/admin/reports")}
          />
          <NavCard
            icon={MessageSquareWarning}
            title="Grading corrections"
            subtitle="Matcher feedback telemetry"
            onClick={() => navigate("/admin/corrections")}
          />
          <NavCard
            icon={BarChart3}
            title="Analytics"
            subtitle="Growth, sessions, AI spend"
            onClick={() => navigate("/admin/analytics")}
          />
        </section>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "warning";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 text-[28px] font-bold tabular-nums text-foreground",
            accent === "warning" && "text-brand-accent",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function NavCard({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {title}
          </p>
          <p className="mt-0.5 truncate text-caption text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
