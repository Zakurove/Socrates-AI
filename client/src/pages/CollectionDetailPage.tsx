import { useMemo, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  UserPlus,
  LogOut,
  Settings as SettingsIcon,
  X as XIcon,
  MessageSquare,
  Stethoscope,
  MessagesSquare,
  Image as ImageIcon,
  Sparkles,
  ClipboardList,
  Globe,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { MemberList } from "@/components/collections/MemberList";
import { InviteMemberDialog } from "@/components/collections/InviteMemberDialog";
import { VisibilityBadge } from "@/components/collections/VisibilityBadge";
import { RoleBadge } from "@/components/collections/RoleBadge";
import { PublishDialog } from "@/components/library/PublishDialog";
import { useUnpublishCollection } from "@/hooks/use-publish";
import {
  useCollection,
  useDeleteCollection,
  useUpdateCollection,
  useAddStationToCollection,
  useRemoveStationFromCollection,
  type CollectionStationRow,
} from "@/hooks/use-collections";
import { useInvites, useCancelInvite } from "@/hooks/use-invites";
import {
  useUpdateMemberRole,
  useRemoveMember,
} from "@/hooks/use-collection-members";
import { useStations } from "@/hooks/use-stations";
import { useAuth } from "@/hooks/use-auth";
import { cn, stationTypeLabel } from "@/lib/utils";
import type { CollectionRole } from "@shared/schema";

function stationTypeIcon(type: string) {
  switch (type) {
    case "history_taking":
      return MessageSquare;
    case "physical_exam":
      return Stethoscope;
    case "communication":
      return MessagesSquare;
    case "image_id":
      return ImageIcon;
    case "custom":
      return Sparkles;
    default:
      return ClipboardList;
  }
}

function rankRole(role: CollectionRole): number {
  return role === "owner" ? 2 : role === "editor" ? 1 : 0;
}
function canEdit(role: CollectionRole) {
  return rankRole(role) >= rankRole("editor");
}
function canOwn(role: CollectionRole) {
  return role === "owner";
}

export default function CollectionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: collection, isLoading, error } = useCollection(id);
  // Owner-only — error intentionally silenced for non-owners.
  const { data: pendingInvites } = useInvites(
    collection?.role === "owner" ? id : undefined
  );

  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();
  const addStation = useAddStationToCollection();
  const removeStation = useRemoveStationFromCollection();
  const updateMemberRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const cancelInvite = useCancelInvite();
  const unpublishCollection = useUnpublishCollection();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [addStationOpen, setAddStationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<number | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-body text-muted-foreground">
          Couldn&rsquo;t load this collection.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate("/collections")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to collections
        </Button>
      </div>
    );
  }

  const role = collection.role;
  const editAllowed = canEdit(role);
  const ownerActions = canOwn(role);

  const handleDelete = async () => {
    try {
      await deleteCollection.mutateAsync(id);
      toast({ title: "Collection deleted" });
      navigate("/collections");
    } catch (err) {
      toast({
        title: "Couldn't delete",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  const handleLeave = async () => {
    if (!user) return;
    try {
      await removeMember.mutateAsync({ collectionId: id, userId: user.id });
      toast({ title: "You left the collection" });
      navigate("/collections");
    } catch (err) {
      toast({
        title: "Couldn't leave",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  const handleRoleChange = async (userId: number, newRole: CollectionRole) => {
    setBusyMemberId(userId);
    try {
      await updateMemberRole.mutateAsync({
        collectionId: id,
        userId,
        role: newRole,
      });
      toast({ title: "Role updated" });
    } catch (err) {
      toast({
        title: "Couldn't update role",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    setBusyMemberId(userId);
    try {
      await removeMember.mutateAsync({ collectionId: id, userId });
      toast({ title: "Member removed" });
    } catch (err) {
      toast({
        title: "Couldn't remove member",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleCancelInvite = async (inviteId: number) => {
    setBusyInviteId(inviteId);
    try {
      await cancelInvite.mutateAsync({ collectionId: id, inviteId });
      toast({ title: "Invite cancelled" });
    } catch (err) {
      toast({
        title: "Couldn't cancel invite",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    } finally {
      setBusyInviteId(null);
    }
  };

  const handleUnpublish = async () => {
    try {
      await unpublishCollection.mutateAsync(id);
      toast({ title: "Unpublished" });
      setConfirmUnpublish(false);
    } catch (err) {
      toast({
        title: "Couldn't unpublish",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  const handleRemoveStation = async (stationId: number) => {
    try {
      await removeStation.mutateAsync({ collectionId: id, stationId });
      toast({ title: "Station removed" });
    } catch (err) {
      toast({
        title: "Couldn't remove station",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  return (
    <div className="min-h-screen pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)] bg-background">
      <PageHeader
        title={collection.title}
        backTo="/collections"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-11 w-11 -mr-2 grid place-items-center rounded-full hover:bg-muted transition-smooth"
                aria-label="Collection options"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {ownerActions && (
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Edit details
                </DropdownMenuItem>
              )}
              {ownerActions && collection.visibility !== "public" && (
                <DropdownMenuItem onSelect={() => setPublishOpen(true)}>
                  <Globe className="h-4 w-4 mr-2" />
                  Publish to library
                </DropdownMenuItem>
              )}
              {ownerActions && collection.visibility === "public" && (
                <DropdownMenuItem
                  onSelect={() => setConfirmUnpublish(true)}
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Unpublish
                </DropdownMenuItem>
              )}
              {ownerActions && <DropdownMenuSeparator />}
              {!ownerActions && (
                <DropdownMenuItem
                  onSelect={() => setConfirmLeave(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Leave collection
                </DropdownMenuItem>
              )}
              {ownerActions && (
                <DropdownMenuItem
                  onSelect={() => setConfirmDelete(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete collection
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mx-auto max-w-3xl px-5 pt-6 space-y-8">
        {/* Header */}
        <header className="space-y-3">
          <div>
            <p className="text-label text-muted-foreground uppercase">
              Collection
            </p>
            <h1 className="text-h1 text-foreground">{collection.title}</h1>
            {collection.description && (
              <p className="mt-1 text-body text-muted-foreground">
                {collection.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <VisibilityBadge
              visibility={collection.visibility}
              memberCount={
                collection.visibility === "shared"
                  ? collection.memberCount
                  : undefined
              }
            />
            <RoleBadge role={role} />
            <span className="text-caption text-muted-foreground">
              {collection.stationCount} station
              {collection.stationCount === 1 ? "" : "s"} ·{" "}
              {collection.memberCount} member
              {collection.memberCount === 1 ? "" : "s"}
            </span>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {editAllowed && (
              <Button
                size="sm"
                onClick={() => setAddStationOpen(true)}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Add station
              </Button>
            )}
            {ownerActions && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setInviteOpen(true)}
                className="gap-1.5"
              >
                <UserPlus className="h-4 w-4" />
                Invite
              </Button>
            )}
          </div>
        </header>

        {/* Stations */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase">
            Stations
          </h2>
          {collection.stations.length === 0 ? (
            <EmptyStations
              canAdd={editAllowed}
              onAdd={() => setAddStationOpen(true)}
            />
          ) : (
            <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
              {collection.stations.map((s) => (
                <StationRow
                  key={s.id}
                  station={s}
                  collectionId={collection.id}
                  canEdit={editAllowed}
                  onRemove={() => handleRemoveStation(s.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Members */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase">
            Members
          </h2>
          <MemberList
            members={collection.members}
            pendingInvites={pendingInvites}
            currentUserRole={role}
            currentUserId={user?.id}
            onRoleChange={ownerActions ? handleRoleChange : undefined}
            onRemove={ownerActions ? handleRemoveMember : undefined}
            onLeave={!ownerActions ? () => setConfirmLeave(true) : undefined}
            onCancelInvite={ownerActions ? handleCancelInvite : undefined}
            busyUserId={busyMemberId}
            busyInviteId={busyInviteId}
          />
        </section>
      </div>

      {/* Dialogs */}
      <InviteMemberDialog
        collectionId={id}
        collectionTitle={collection.title}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      <AddStationDialog
        open={addStationOpen}
        onOpenChange={setAddStationOpen}
        existingStationIds={collection.stations.map((s) => s.id)}
        onAdd={async (stationId) => {
          try {
            await addStation.mutateAsync({ collectionId: id, stationId });
            toast({ title: "Station added" });
            setAddStationOpen(false);
          } catch (err) {
            toast({
              title: "Couldn't add station",
              description: err instanceof Error ? err.message : undefined,
              variant: "warning",
            });
          }
        }}
        isPending={addStation.isPending}
      />

      <EditDetailsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTitle={collection.title}
        initialDescription={collection.description ?? ""}
        onSave={async ({ title, description }) => {
          try {
            await updateCollection.mutateAsync({
              id,
              data: { title, description },
            });
            toast({ title: "Details saved" });
            setSettingsOpen(false);
          } catch (err) {
            toast({
              title: "Couldn't save",
              description: err instanceof Error ? err.message : undefined,
              variant: "warning",
            });
          }
        }}
        isPending={updateCollection.isPending}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the collection and all member access. Your stations
              stay in My Stations. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCollection.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteCollection.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCollection.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this collection?</AlertDialogTitle>
            <AlertDialogDescription>
              You&rsquo;ll lose access to its stations. The owner can re-invite
              you later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              disabled={removeMember.isPending}
            >
              {removeMember.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Leave"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        target={{ type: "collection", id, title: collection.title }}
        currentUserName={user?.displayName ?? ""}
      />

      <AlertDialog open={confirmUnpublish} onOpenChange={setConfirmUnpublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish this collection?</AlertDialogTitle>
            <AlertDialogDescription>
              It won&rsquo;t appear in the community library anymore. Existing
              forks keep their copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unpublishCollection.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnpublish}
              disabled={unpublishCollection.isPending}
            >
              {unpublishCollection.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Unpublish"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StationRow({
  station,
  collectionId,
  canEdit,
  onRemove,
}: {
  station: CollectionStationRow;
  collectionId: number;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const Icon = stationTypeIcon(station.type);
  const href = `/station/${station.id}?from=${encodeURIComponent(`/collections/${collectionId}`)}`;
  return (
    <div className="flex items-center gap-3 px-5 py-4 min-h-[72px] hover:bg-muted/30 transition-colors">
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">
            {station.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
            <span>{stationTypeLabel(station.type)}</span>
            {station.specialty && (
              <>
                <span aria-hidden>·</span>
                <span>{station.specialty}</span>
              </>
            )}
            {station.addedByName && (
              <>
                <span aria-hidden>·</span>
                <span>Added by {station.addedByName}</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Options for ${station.title}`}
              className="h-8 w-8 grid place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-smooth"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={onRemove}
              className="text-destructive focus:text-destructive"
            >
              <XIcon className="h-4 w-4 mr-2" />
              Remove from collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function EmptyStations({
  canAdd,
  onAdd,
}: {
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border/70 bg-card/40 py-12 text-center px-5">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Plus className="h-6 w-6" />
      </div>
      <h3 className="mb-1 text-h3 text-foreground">No stations yet</h3>
      <p className="mb-5 max-w-xs text-body text-muted-foreground">
        {canAdd
          ? "Add your first station to this collection."
          : "The owner hasn't added any stations yet."}
      </p>
      {canAdd && (
        <Button onClick={onAdd} className="gap-2">
          <Plus className="h-4 w-4" />
          Add station
        </Button>
      )}
    </div>
  );
}

function AddStationDialog({
  open,
  onOpenChange,
  existingStationIds,
  onAdd,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingStationIds: number[];
  onAdd: (stationId: number) => void | Promise<void>;
  isPending: boolean;
}) {
  const { data: stations, isLoading } = useStations();
  const [query, setQuery] = useState("");
  const existing = useMemo(() => new Set(existingStationIds), [existingStationIds]);
  const filtered = useMemo(() => {
    const all = stations ?? [];
    const available = all.filter((s) => !existing.has(s.id));
    if (!query.trim()) return available;
    const q = query.toLowerCase();
    return available.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.specialty ?? "").toLowerCase().includes(q)
    );
  }, [stations, existing, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add station</DialogTitle>
          <DialogDescription>
            Pick one of your stations to add to this collection.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your stations"
          />

          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/60">
            {isLoading ? (
              <div className="px-4 py-6 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-body text-muted-foreground">
                {(stations?.length ?? 0) === 0
                  ? "You don't have any stations yet."
                  : existing.size > 0 && (stations?.length ?? 0) === existing.size
                    ? "All your stations are already in this collection."
                    : "No stations match your search."}
              </div>
            ) : (
              filtered.map((s) => {
                const Icon = stationTypeIcon(s.type);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => onAdd(s.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30",
                      isPending && "opacity-60"
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-foreground">
                        {s.title}
                      </div>
                      <div className="text-caption text-muted-foreground">
                        {stationTypeLabel(s.type)}
                        {s.specialty ? ` · ${s.specialty}` : ""}
                      </div>
                    </div>
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDetailsDialog({
  open,
  onOpenChange,
  initialTitle,
  initialDescription,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  initialDescription: string;
  onSave: (patch: { title: string; description?: string }) => void | Promise<void>;
  isPending: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Sync when dialog reopens with fresh data.
  const handleOpenChange = (o: boolean) => {
    if (o) {
      setTitle(initialTitle);
      setDescription(initialDescription);
      setTitleError(null);
    }
    onOpenChange(o);
  };

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError("Give the collection a name.");
      return;
    }
    if (trimmed.length > 255) {
      setTitleError("Title must be 255 characters or fewer.");
      return;
    }
    onSave({ title: trimmed, description: description.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit collection</DialogTitle>
          <DialogDescription>
            Update the title and description.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title" className="text-label text-muted-foreground">
              Title
            </Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              maxLength={255}
              aria-invalid={!!titleError}
            />
            {titleError && (
              <p className="text-caption text-warning" role="alert">
                {titleError}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-desc" className="text-label text-muted-foreground">
              Description
            </Label>
            <Textarea
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

