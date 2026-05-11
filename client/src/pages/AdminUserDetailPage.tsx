import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  MailCheck,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AdminBadge,
  UnverifiedBadge,
  VerifiedBadge,
  VisibilityBadge,
} from "@/components/admin/AdminBadges";
import { AdminGate } from "@/components/admin/AdminGate";
import {
  useAdminDeleteUser,
  useAdminPatchUser,
  useAdminUser,
} from "@/hooks/use-admin";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "U";
  return trimmed
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function dateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminUserDetailPage() {
  return (
    <AdminGate>
      <AdminUserDetailInner />
    </AdminGate>
  );
}

function AdminUserDetailInner() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/admin/users/:id");
  const userId = params?.id ? Number(params.id) : null;
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const { data, isLoading, isError, refetch } = useAdminUser(userId);
  const patchUser = useAdminPatchUser();
  const deleteUser = useAdminDeleteUser();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const u = data?.user;
  const counts = data?.counts;
  const isSelf = !!(currentUser && u && currentUser.id === u.id);

  useEffect(() => {
    document.title = u ? `${u.displayName} — Admin` : "User — Admin";
  }, [u]);

  const initials = useMemo(
    () => (u ? initialsOf(u.displayName) : "U"),
    [u],
  );

  const handlePromoteToggle = async () => {
    if (!u) return;
    try {
      await patchUser.mutateAsync({
        id: u.id,
        body: { isAdmin: !u.isAdmin },
      });
      toast({ title: u.isAdmin ? "Demoted" : "Promoted to admin" });
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: (err as Error).message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    }
  };

  const handleVerify = async () => {
    if (!u) return;
    try {
      await patchUser.mutateAsync({
        id: u.id,
        body: { emailVerifiedAt: new Date().toISOString() },
      });
      toast({ title: "Email marked verified" });
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: (err as Error).message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!u) return;
    try {
      await deleteUser.mutateAsync(u.id);
      toast({ title: `Deleted ${u.displayName}` });
      navigate("/admin/users");
    } catch (err) {
      toast({
        title: "Couldn't delete",
        description: (err as Error).message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader
        title="User"
        backTo="/admin/users"
        actions={
          <div className="flex items-center gap-1.5 pr-1 text-caption text-muted-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Admin
          </div>
        }
      />

      <main className="mx-auto max-w-[900px] px-5 pt-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data || !u || !counts ? (
          <div className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-5 py-6 text-center">
            <p className="text-body text-foreground">Couldn't load user.</p>
            <Button
              variant="outline"
              className="mt-3 rounded-full"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* Header card */}
            <Card className="mb-6">
              <CardContent className="flex items-center gap-4 p-5">
                <Avatar className="h-14 w-14">
                  <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h1 className="truncate font-display text-h2 text-foreground">
                      {u.displayName}
                    </h1>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      #{u.id}
                    </span>
                    {u.isAdmin && <AdminBadge />}
                    {u.emailVerifiedAt ? (
                      <VerifiedBadge />
                    ) : (
                      <UnverifiedBadge />
                    )}
                  </div>
                  <p className="truncate text-body text-muted-foreground">
                    {u.email}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    Joined {dateShort(u.createdAt)}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Stat strip */}
            <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard label="Sessions" value={String(counts.sessions)} />
              <StatCard label="Stations" value={String(counts.stations)} />
              <StatCard
                label="Public"
                value={String(counts.publicStations)}
              />
              <StatCard
                label="Spend (total)"
                value={`$${counts.aiSpendUsdTotal.toFixed(2)}`}
              />
              <StatCard
                label="Spend (30d)"
                value={`$${counts.aiSpendUsd30d.toFixed(2)}`}
              />
            </section>

            {/* Recent sessions */}
            <section className="mb-8 space-y-3">
              <h2 className="text-h2 text-foreground">Recent sessions</h2>
              {data.recentSessions.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  No sessions yet.
                </p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.recentSessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/session/${s.id}/results`)}
                        className="block w-full px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-medium text-foreground">
                              {s.stationTitle ?? `Station #${s.stationId}`}
                            </p>
                            <p className="text-caption text-muted-foreground">
                              {dateShort(s.startedAt)}
                              {s.endedAt ? " · completed" : " · incomplete"}
                            </p>
                          </div>
                          {s.totalScore !== null && (
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                              {Math.round(s.totalScore)}%
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Stations */}
            <section className="mb-8 space-y-3">
              <h2 className="text-h2 text-foreground">All stations</h2>
              {data.stations.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  No stations yet.
                </p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border/60 p-0">
                    {data.stations.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/station/${s.id}`)}
                        className="block w-full px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-medium text-foreground">
                              {s.title}
                            </p>
                            <p className="text-caption text-muted-foreground">
                              {s.type} · {dateShort(s.createdAt)}
                            </p>
                          </div>
                          <VisibilityBadge visibility={s.visibility} />
                        </div>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Admin actions */}
            <section className="space-y-3">
              <h2 className="text-h2 text-foreground">Admin actions</h2>
              <Card>
                <CardContent className="flex flex-wrap gap-2 p-4">
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={handlePromoteToggle}
                    disabled={
                      patchUser.isPending || (isSelf && u.isAdmin)
                    }
                    title={
                      isSelf && u.isAdmin
                        ? "You can't demote yourself — would lock you out of admin"
                        : undefined
                    }
                  >
                    {u.isAdmin ? (
                      <ShieldOff className="mr-2 h-4 w-4" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}
                    {u.isAdmin ? "Demote from admin" : "Promote to admin"}
                  </Button>
                  {!u.emailVerifiedAt && (
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={handleVerify}
                      disabled={patchUser.isPending}
                    >
                      <MailCheck className="mr-2 h-4 w-4" />
                      Force-verify email
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className={cn(
                      "rounded-full border-destructive/40 text-destructive hover:bg-destructive/10",
                    )}
                    onClick={() => setConfirmDelete(true)}
                    disabled={deleteUser.isPending || isSelf}
                    title={
                      isSelf
                        ? "You can't delete your own account from here"
                        : undefined
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete user
                  </Button>
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </main>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold text-foreground">
                {u?.displayName}
              </span>
              , their {counts?.sessions ?? 0} session
              {counts?.sessions === 1 ? "" : "s"},{" "}
              {counts?.stations ?? 0} station
              {counts?.stations === 1 ? "" : "s"}, and all related data. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-[22px] font-bold tabular-nums text-foreground">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
