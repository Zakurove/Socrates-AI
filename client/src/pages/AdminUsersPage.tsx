import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Search as SearchIcon,
  ShieldAlert,
  X as XIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
} from "@/components/admin/AdminBadges";
import { AdminGate } from "@/components/admin/AdminGate";
import {
  useAdminDeleteUser,
  useAdminPatchUser,
  useAdminUsers,
  type AdminUserRow,
} from "@/hooks/use-admin";
import { useToast } from "@/components/ui/use-toast";

const PAGE_SIZE = 50;

function relativeTime(iso: string): string {
  const date = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - date;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < day) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))}mo ago`;
  return `${Math.floor(diff / (365 * day))}y ago`;
}

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

export default function AdminUsersPage() {
  return (
    <AdminGate>
      <AdminUsersInner />
    </AdminGate>
  );
}

function AdminUsersInner() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const [searchInput, setSearchInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);

  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null);

  const patchUser = useAdminPatchUser();
  const deleteUser = useAdminDeleteUser();

  useEffect(() => {
    document.title = "User accounts — Admin";
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, refetch } = useAdminUsers({
    q: debounced,
    offset,
    limit: PAGE_SIZE,
  });

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handlePromoteToggle = async (u: AdminUserRow) => {
    try {
      await patchUser.mutateAsync({ id: u.id, body: { isAdmin: !u.isAdmin } });
      toast({
        title: u.isAdmin ? "Demoted" : "Promoted to admin",
      });
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: (err as Error).message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    }
  };

  const handleVerify = async (u: AdminUserRow) => {
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
    if (!confirmDelete) return;
    try {
      await deleteUser.mutateAsync(confirmDelete.id);
      toast({ title: `Deleted ${confirmDelete.displayName}` });
      setConfirmDelete(null);
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
        title="User accounts"
        backTo="/admin"
        actions={
          <div className="flex items-center gap-1.5 pr-1 text-caption text-muted-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Admin
          </div>
        }
      />

      <main className="mx-auto max-w-[900px] px-5 pt-6">
        <header className="mb-6">
          <h1 className="font-display text-h1 text-foreground">User accounts</h1>
          <p className="text-body text-muted-foreground">
            {total.toLocaleString()} total
          </p>
        </header>

        <div className="relative mb-4">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name or email"
            className="h-12 rounded-xl border-transparent bg-muted/50 pl-10 pr-10 text-[15px]"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-warm-100"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-5 py-6 text-center">
            <p className="text-body text-foreground">Couldn't load users.</p>
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
              {debounced ? "No matching users." : "No users yet."}
            </p>
          </div>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              {rows.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onOpen={() => navigate(`/admin/users/${u.id}`)}
                  onPromoteToggle={() => handlePromoteToggle(u)}
                  onVerify={() => handleVerify(u)}
                  onDelete={() => setConfirmDelete(u)}
                  busy={patchUser.isPending}
                  isSelf={!!currentUser && currentUser.id === u.id}
                />
              ))}
            </CardContent>
          </Card>
        )}

        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Prev
            </Button>
            <span className="text-caption tabular-nums text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}
      </main>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold text-foreground">
                {confirmDelete?.displayName}
              </span>
              , their {confirmDelete?.sessionCount ?? 0} session
              {confirmDelete?.sessionCount === 1 ? "" : "s"},{" "}
              {confirmDelete?.stationCount ?? 0} station
              {confirmDelete?.stationCount === 1 ? "" : "s"}, and all related
              data. This can't be undone.
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

function UserRow({
  user,
  onOpen,
  onPromoteToggle,
  onVerify,
  onDelete,
  busy,
  isSelf,
}: {
  user: AdminUserRow;
  onOpen: () => void;
  onPromoteToggle: () => void;
  onVerify: () => void;
  onDelete: () => void;
  busy: boolean;
  isSelf: boolean;
}) {
  const initials = useMemo(() => initialsOf(user.displayName), [user.displayName]);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="bg-primary/10 text-[12px] font-semibold text-primary">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-[14px] font-semibold text-foreground">
            {user.displayName}
          </p>
          {user.isAdmin && <AdminBadge />}
          {user.emailVerifiedAt ? <VerifiedBadge /> : <UnverifiedBadge />}
        </div>
        <p className="truncate text-caption text-muted-foreground">
          {user.email}
        </p>
      </div>

      <div className="hidden shrink-0 items-end gap-5 text-right text-[12px] text-muted-foreground sm:flex">
        <Stat label="Sessions" value={user.sessionCount} />
        <Stat label="Stations" value={user.stationCount} />
        <Stat label="Spend" value={`$${user.aiSpendUsd.toFixed(2)}`} />
        <Stat label="Joined" value={relativeTime(user.createdAt)} />
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              aria-label="Actions"
              disabled={busy}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>View profile</DropdownMenuItem>
            <DropdownMenuItem
              onClick={onPromoteToggle}
              disabled={isSelf && user.isAdmin}
            >
              {user.isAdmin ? "Demote from admin" : "Promote to admin"}
              {isSelf && user.isAdmin && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  (you)
                </span>
              )}
            </DropdownMenuItem>
            {!user.emailVerifiedAt && (
              <DropdownMenuItem onClick={onVerify}>
                Force-verify email
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              disabled={isSelf}
              className="text-destructive focus:text-destructive"
            >
              Delete user
              {isSelf && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  (you)
                </span>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[13px] font-semibold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
