import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Download, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
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
import { useToast } from "@/components/ui/use-toast";
import { formatDistanceToNow } from "date-fns";

type GroupCopy = {
  station: {
    id: number;
    title: string;
    updatedAt: string;
  };
  collection: {
    id: number;
    title: string;
  };
};

interface GroupEditionsPanelProps {
  /** ID of the personal station whose group copies we want to surface. */
  stationId: number;
}

/**
 * Shown on a personal station's detail page for the owner. Lists every
 * group copy of this station (group editors may have evolved them) and
 * lets the owner pull a chosen version back over their personal copy.
 *
 * Hidden when there are no group copies. Pull-back is a full-replace
 * (v1) — confirmation dialog warns explicitly.
 */
export function GroupEditionsPanel({ stationId }: GroupEditionsPanelProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pendingCopy, setPendingCopy] = useState<GroupCopy | null>(null);

  const { data, isLoading } = useQuery<{ copies: GroupCopy[] }>({
    queryKey: ["station-group-copies", stationId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/stations/${stationId}/group-copies`,
      );
      return res.json();
    },
    // The collection's working copy can change at any time; refetch when
    // the user comes back to the tab.
    refetchOnWindowFocus: true,
  });

  const pullMutation = useMutation({
    mutationFn: async (copy: GroupCopy) => {
      const res = await apiRequest(
        "POST",
        `/api/stations/${stationId}/pull-from-group`,
        { groupStationId: copy.station.id },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/stations/${stationId}`] });
      qc.invalidateQueries({ queryKey: ["station-group-copies", stationId] });
      toast({
        title: "Pulled from group",
        description: "Your personal station now matches the group's version.",
      });
      setPendingCopy(null);
    },
    onError: (err) => {
      toast({
        title: "Couldn't pull from group",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    },
  });

  if (isLoading) return null;
  const copies = data?.copies ?? [];
  if (copies.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-label uppercase text-muted-foreground">
        Group editions
      </h2>
      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <p className="mb-3 text-caption text-muted-foreground">
          This station has been forked into{" "}
          {copies.length === 1 ? "a group" : `${copies.length} groups`}. Group
          editors can change their copy freely — your personal version stays
          untouched until you choose to pull a group's edits back in.
        </p>
        <ul className="space-y-2.5">
          {copies.map((copy) => (
            <li
              key={copy.station.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border/40 bg-background/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  {copy.collection.title}
                </p>
                <p className="text-caption text-muted-foreground">
                  Last edited{" "}
                  {formatDistanceToNow(new Date(copy.station.updatedAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingCopy(copy)}
                className="shrink-0 gap-1.5 rounded-full"
              >
                <Download className="h-3.5 w-3.5" />
                Pull this version
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <AlertDialog
        open={pendingCopy != null}
        onOpenChange={(open) => !open && setPendingCopy(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace with group version?</AlertDialogTitle>
            <AlertDialogDescription>
              Your personal copy of{" "}
              <strong>{pendingCopy?.station.title}</strong> will be replaced
              with the version from <strong>{pendingCopy?.collection.title}</strong>.
              All your sections, items and examiner questions will be
              overwritten by the group's. This can't be undone.
              <br />
              <br />
              Your past practice sessions on this station are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pullMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pullMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingCopy) pullMutation.mutate(pendingCopy);
              }}
            >
              {pullMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pulling…
                </>
              ) : (
                "Replace my version"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
