import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Plus, FolderPlus, Loader2, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CollectionCard,
  CollectionCardSkeleton,
} from "@/components/collections/CollectionCard";
import {
  useCollections,
  useCreateCollection,
} from "@/hooks/use-collections";
import { useToast } from "@/components/ui/use-toast";
import type { CollectionWithMembership } from "@shared/schema";

export default function CollectionsPage() {
  const { data, isLoading, error } = useCollections();
  const [createOpen, setCreateOpen] = useState(false);

  const { mine, shared } = useMemo(() => {
    const list = (data ?? []) as CollectionWithMembership[];
    return {
      mine: list.filter((c) => c.role === "owner"),
      shared: list.filter((c) => c.role === "editor" || c.role === "viewer"),
    };
  }, [data]);

  return (
    <div className="min-h-screen pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      <div className="safe-top" />

      <div className="mx-auto max-w-3xl px-5 pt-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-h1 text-foreground">Collections</h1>
          <Button
            onClick={() => setCreateOpen(true)}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            New collection
          </Button>
        </div>

        <Tabs defaultValue="mine" className="w-full">
          <TabsList className="w-full lg:max-w-sm">
            <TabsTrigger value="mine" className="flex-1">
              Mine
            </TabsTrigger>
            <TabsTrigger value="shared" className="flex-1">
              Shared with me
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="space-y-4 mt-5">
            {isLoading ? (
              <SkeletonGrid />
            ) : error ? (
              <ErrorState />
            ) : mine.length === 0 ? (
              <EmptyMine onCreate={() => setCreateOpen(true)} />
            ) : (
              <Grid collections={mine} />
            )}
          </TabsContent>

          <TabsContent value="shared" className="space-y-4 mt-5">
            {isLoading ? (
              <SkeletonGrid />
            ) : error ? (
              <ErrorState />
            ) : shared.length === 0 ? (
              <EmptyShared onStart={() => setCreateOpen(true)} />
            ) : (
              <Grid collections={shared} />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <CreateCollectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}

function Grid({ collections }: { collections: CollectionWithMembership[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {collections.map((c) => (
        <CollectionCard
          key={c.id}
          collection={{
            id: c.id,
            title: c.title,
            description: c.description,
            stationCount: c.stationCount,
            memberCount: c.memberCount,
            visibility: c.visibility,
            role: c.role,
            starCount: c.starCount,
          }}
        />
      ))}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <CollectionCardSkeleton key={i} />
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="py-12 text-center">
      <p className="text-body text-destructive">
        Couldn&rsquo;t load collections. Please try again.
      </p>
    </div>
  );
}

function EmptyMine({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FolderPlus className="h-7 w-7" />
      </div>
      <h2 className="mb-2 text-h2 text-foreground">No collections yet</h2>
      <p className="mb-6 max-w-xs text-body text-muted-foreground">
        Create one to organize your stations and share with colleagues.
      </p>
      <Button onClick={onCreate} size="lg" className="gap-2">
        <Plus className="h-4 w-4" />
        Start a collection
      </Button>
    </div>
  );
}

function EmptyShared({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users2 className="h-7 w-7" />
      </div>
      <h2 className="mb-2 text-h2 text-foreground">Nothing shared yet</h2>
      <p className="max-w-xs text-body text-muted-foreground">
        When others invite you to a collection, it&rsquo;ll show up here.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-4 text-caption text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
      >
        or start one of your own
      </button>
    </div>
  );
}

function CreateCollectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createCollection = useCreateCollection();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setTitleError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitleError("Give the collection a name.");
      return;
    }
    if (trimmed.length > 255) {
      setTitleError("Title must be 255 characters or fewer.");
      return;
    }
    try {
      const created = await createCollection.mutateAsync({
        title: trimmed,
        description: description.trim() || undefined,
      });
      toast({ title: "Collection created" });
      reset();
      onOpenChange(false);
      navigate(`/collections/${created.id}`);
    } catch (err) {
      toast({
        title: "Couldn't create collection",
        description: err instanceof Error ? err.message : undefined,
        variant: "warning",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>
              Group stations together and share with colleagues.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="coll-title" className="text-label text-muted-foreground">
                Title
              </Label>
              <Input
                id="coll-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError(null);
                }}
                placeholder="Orthopedics prep"
                aria-invalid={!!titleError}
                maxLength={255}
              />
              {titleError && (
                <p className="text-caption text-warning" role="alert">
                  {titleError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="coll-desc" className="text-label text-muted-foreground">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="coll-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short note so collaborators know what this is for."
                rows={3}
                maxLength={2000}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createCollection.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createCollection.isPending}>
              {createCollection.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
