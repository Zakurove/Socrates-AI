import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Flag, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
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
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useAdminReports, useResolveReport } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type Status = "open" | "reviewed_ok" | "removed";

export default function AdminReportsPage() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("open");
  const { data, isLoading, isError, refetch } = useAdminReports(status);
  const resolve = useResolveReport();
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);

  // Gate: redirect non-admins.
  useEffect(() => {
    if (authLoading) return;
    if (!user || !(user as { isAdmin?: boolean }).isAdmin) {
      toast({ title: "Admins only.", variant: "warning" });
      navigate("/");
    }
  }, [authLoading, user, navigate, toast]);

  useEffect(() => {
    document.title = "Reports — Socrates AI";
  }, []);

  if (authLoading || !user || !(user as { isAdmin?: boolean }).isAdmin) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleDismiss = async (id: number) => {
    try {
      await resolve.mutateAsync({ id, status: "reviewed_ok" });
      toast({ title: "Report dismissed" });
    } catch (err) {
      const msg = (err as Error).message.replace(/^\d+:\s*/, "");
      toast({
        title: "Couldn't update",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await resolve.mutateAsync({ id, status: "removed" });
      toast({
        title: "Removed",
        description: "The target has been unpublished.",
      });
      setConfirmRemoveId(null);
    } catch (err) {
      const msg = (err as Error).message.replace(/^\d+:\s*/, "");
      toast({
        title: "Couldn't remove",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const rows = data ?? [];

  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader
        title="Reports"
        backTo="/settings"
        wide
        actions={
          <div className="flex items-center gap-1.5 pr-1 text-caption text-muted-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Admin
          </div>
        }
      />

      <main className="mx-auto max-w-[900px] px-5 pt-6">
        <header className="mb-6">
          <h1 className="font-display text-h1 text-foreground">
            Reports
          </h1>
          <p className="text-body text-muted-foreground">
            Community moderation queue.
          </p>
        </header>

        <Tabs
          value={status}
          onValueChange={(v) => setStatus(v as Status)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-3 md:w-auto">
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="reviewed_ok">Dismissed</TabsTrigger>
            <TabsTrigger value="removed">Removed</TabsTrigger>
          </TabsList>

          <TabsContent value={status} className="mt-4">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl bg-warm-100"
                  />
                ))}
              </div>
            ) : isError ? (
              <div className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-5 py-6 text-center">
                <p className="text-body text-foreground">
                  Couldn't load reports.
                </p>
                <Button
                  variant="outline"
                  className="mt-3 rounded-full"
                  onClick={() => refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-5 py-10 text-center">
                <p className="text-body text-muted-foreground">
                  {status === "open"
                    ? "No open reports."
                    : "Nothing here."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((r) => {
                  const date = new Date(r.createdAt).toLocaleDateString(
                    undefined,
                    { month: "short", day: "numeric", year: "numeric" },
                  );
                  // Admins need access to the underlying content even if it
                  // has been unpublished. Route to the private station/
                  // collection pages (admin bypass on GET /api/stations/:id
                  // + /api/collections/:id grants read) rather than the
                  // public /library/* routes which 404 after removal.
                  const targetHref =
                    r.targetType === "station"
                      ? `/station/${r.targetId}`
                      : r.targetType === "collection"
                        ? `/collections/${r.targetId}`
                        : `/u/${r.targetId}`;
                  return (
                    <article
                      key={r.id}
                      className="rounded-2xl border border-border/60 bg-card p-4"
                    >
                      <header className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            onClick={() => navigate(targetHref)}
                            className="block truncate text-left text-body font-semibold text-primary hover:underline"
                          >
                            {r.targetPreview.title ||
                              `${r.targetType} #${r.targetId}`}
                          </button>
                          <p className="mt-0.5 text-caption text-muted-foreground capitalize">
                            {r.targetType} · {date}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                            r.status === "open" &&
                              "bg-primary/10 text-primary",
                            r.status === "reviewed_ok" &&
                              "bg-muted text-muted-foreground",
                            r.status === "removed" &&
                              "bg-destructive/10 text-destructive",
                          )}
                        >
                          {r.status.replace("_", " ")}
                        </span>
                      </header>

                      <div className="mt-3 flex items-start gap-2 text-caption text-foreground">
                        <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <p className="flex-1 break-words">{r.reason}</p>
                      </div>

                      <p className="mt-2 text-caption text-muted-foreground">
                        Reporter: <span className="tabular-nums">{r.reporterId ?? "—"}</span>
                      </p>

                      {r.status === "open" && (
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDismiss(r.id)}
                            disabled={resolve.isPending}
                            className="h-8 rounded-full"
                          >
                            Dismiss
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmRemoveId(r.id)}
                            disabled={resolve.isPending}
                            className="h-8 rounded-full border-destructive/40 text-destructive hover:bg-destructive/10"
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <AlertDialog
        open={confirmRemoveId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRemoveId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this item?</AlertDialogTitle>
            <AlertDialogDescription>
              The reported station or collection will be unpublished
              (visibility set to private). This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmRemoveId !== null && handleRemove(confirmRemoveId)
              }
              className="bg-destructive hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
