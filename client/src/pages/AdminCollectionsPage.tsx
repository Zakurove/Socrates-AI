import { useEffect, useState } from "react";
import { useLocation } from "wouter";
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
import { VisibilityBadge } from "@/components/admin/AdminBadges";
import { AdminGate } from "@/components/admin/AdminGate";
import {
  useAdminCollections,
  useAdminPatchCollectionVisibility,
  type AdminCollectionRow,
} from "@/hooks/use-admin";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
type Visibility = "all" | "public" | "shared" | "private";

function dateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

export default function AdminCollectionsPage() {
  return (
    <AdminGate>
      <AdminCollectionsInner />
    </AdminGate>
  );
}

function AdminCollectionsInner() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [visibility, setVisibility] = useState<Visibility>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);

  const [confirmPrivatize, setConfirmPrivatize] =
    useState<AdminCollectionRow | null>(null);

  const patch = useAdminPatchCollectionVisibility();

  useEffect(() => {
    document.title = "Collections — Admin";
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setOffset(0);
  }, [visibility]);

  const { data, isLoading, isError, refetch } = useAdminCollections({
    visibility,
    q: debounced,
    offset,
    limit: PAGE_SIZE,
  });

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const setVisibilityFor = async (
    row: AdminCollectionRow,
    next: "private" | "shared" | "public",
  ) => {
    if (row.visibility === next) return;
    if (row.visibility === "public" && next === "private") {
      setConfirmPrivatize(row);
      return;
    }
    try {
      await patch.mutateAsync({ id: row.id, visibility: next });
      toast({ title: `Set to ${next}` });
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: (err as Error).message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    }
  };

  const confirmPrivatizeAction = async () => {
    if (!confirmPrivatize) return;
    try {
      await patch.mutateAsync({
        id: confirmPrivatize.id,
        visibility: "private",
      });
      toast({ title: "Set to private" });
      setConfirmPrivatize(null);
    } catch (err) {
      toast({
        title: "Couldn't update",
        description: (err as Error).message.replace(/^\d+:\s*/, ""),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader
        title="Collections"
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
          <h1 className="font-display text-h1 text-foreground">Collections</h1>
          <p className="text-body text-muted-foreground">
            {total.toLocaleString()} total
          </p>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["all", "public", "shared", "private"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVisibility(v)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors",
                visibility === v
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="relative mb-4">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by title or owner"
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
            <p className="text-body text-foreground">
              Couldn't load collections.
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
              {debounced ? "No matching collections." : "No collections."}
            </p>
          </div>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              {rows.map((c) => (
                <CollectionRow
                  key={c.id}
                  row={c}
                  onOpen={() => navigate(`/collections/${c.id}`)}
                  onOwner={() => navigate(`/admin/users/${c.author.id}`)}
                  onSetVisibility={(v) => setVisibilityFor(c, v)}
                  busy={patch.isPending}
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
        open={confirmPrivatize !== null}
        onOpenChange={(open) => !open && setConfirmPrivatize(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish this collection?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmPrivatize?.title}" is currently public. Setting it to
              private will remove it from the community library. Existing forks
              are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPrivatizeAction}
              className="bg-destructive hover:bg-destructive/90"
              disabled={patch.isPending}
            >
              {patch.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Set to private"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CollectionRow({
  row,
  onOpen,
  onOwner,
  onSetVisibility,
  busy,
}: {
  row: AdminCollectionRow;
  onOpen: () => void;
  onOwner: () => void;
  onSetVisibility: (v: "private" | "shared" | "public") => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <button
          onClick={onOpen}
          className="block max-w-full truncate text-left text-[14px] font-semibold text-primary hover:underline"
        >
          {row.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
          <button
            onClick={onOwner}
            className="truncate hover:text-foreground hover:underline"
          >
            {row.author.displayName}
          </button>
          <span>·</span>
          <VisibilityBadge visibility={row.visibility} />
        </div>
      </div>

      <div className="hidden shrink-0 items-end gap-4 text-right text-[12px] text-muted-foreground sm:flex">
        <Stat label="Stars" value={row.starCount} />
        <Stat label="Forks" value={row.forkCount} />
        {row.stationCount !== undefined && (
          <Stat label="Stations" value={row.stationCount} />
        )}
        <Stat
          label="Reports"
          value={row.reportCount}
          accent={row.reportCount > 0 ? "warning" : undefined}
        />
        <Stat label="Created" value={dateShort(row.createdAt)} />
      </div>

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
          <DropdownMenuItem onClick={onOpen}>View collection</DropdownMenuItem>
          <DropdownMenuItem onClick={onOwner}>View owner</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onSetVisibility("public")}
            disabled={row.visibility === "public"}
          >
            Set public
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onSetVisibility("shared")}
            disabled={row.visibility === "shared"}
          >
            Set shared
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onSetVisibility("private")}
            disabled={row.visibility === "private"}
            className="text-destructive focus:text-destructive"
          >
            Set private
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "warning";
}) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span
        className={cn(
          "text-[13px] font-semibold tabular-nums text-foreground",
          accent === "warning" && "text-brand-accent",
        )}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
