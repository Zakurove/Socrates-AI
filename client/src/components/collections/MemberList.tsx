import { useState } from "react";
import { MoreHorizontal, Trash2, Loader2, Mail, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RoleBadge } from "./RoleBadge";
import { cn } from "@/lib/utils";
import type { CollectionRole } from "@shared/schema";
import type { CollectionMemberRow } from "@/hooks/use-collection-members";
import type { PendingInviteRow } from "@/hooks/use-invites";

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export interface MemberListProps {
  members: CollectionMemberRow[];
  pendingInvites?: PendingInviteRow[];
  currentUserRole: CollectionRole;
  currentUserId?: number;
  onRoleChange?: (userId: number, role: CollectionRole) => void;
  onRemove?: (userId: number) => void;
  onLeave?: () => void;
  onCancelInvite?: (inviteId: number) => void;
  busyUserId?: number | null;
  busyInviteId?: number | null;
}

export function MemberList({
  members,
  pendingInvites,
  currentUserRole,
  currentUserId,
  onRoleChange,
  onRemove,
  onLeave,
  onCancelInvite,
  busyUserId,
  busyInviteId,
}: MemberListProps) {
  const isOwnerViewing = currentUserRole === "owner";

  return (
    <div className="rounded-2xl bg-card border border-border/60 divide-y divide-border/60 overflow-hidden">
      {members.length === 0 && (
        <div className="px-4 py-6 text-center text-caption text-muted-foreground">
          No members yet.
        </div>
      )}
      {members.map((m) => (
        <MemberRow
          key={m.userId}
          member={m}
          canManage={isOwnerViewing}
          isSelf={m.userId === currentUserId}
          showEmail={isOwnerViewing}
          onRoleChange={onRoleChange}
          onRemove={onRemove}
          onLeave={onLeave}
          busy={busyUserId === m.userId}
        />
      ))}
      {pendingInvites && pendingInvites.length > 0 && isOwnerViewing && (
        <div className="bg-muted/30">
          <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            Pending invites
          </div>
          <div className="divide-y divide-border/40">
            {pendingInvites.map((inv) => (
              <PendingInviteRowEl
                key={inv.id}
                invite={inv}
                busy={busyInviteId === inv.id}
                onCancel={onCancelInvite}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  isSelf,
  showEmail,
  onRoleChange,
  onRemove,
  onLeave,
  busy,
}: {
  member: CollectionMemberRow;
  canManage: boolean;
  isSelf: boolean;
  showEmail: boolean;
  onRoleChange?: (userId: number, role: CollectionRole) => void;
  onRemove?: (userId: number) => void;
  onLeave?: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Only owner can change role of non-owner members; cannot change owner's role here.
  const canEditRole =
    canManage && member.role !== "owner" && !!onRoleChange;

  return (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="text-caption font-semibold text-foreground">
          {initials(member.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold leading-tight text-foreground">
          {member.displayName}
          {isSelf && (
            <span className="ml-1.5 text-caption font-normal text-muted-foreground">
              (you)
            </span>
          )}
        </div>
        {showEmail && (
          <div className="truncate text-caption text-muted-foreground">
            {member.email}
          </div>
        )}
      </div>

      {canEditRole ? (
        <Select
          value={member.role}
          onValueChange={(v) =>
            onRoleChange?.(member.userId, v as CollectionRole)
          }
          disabled={busy}
        >
          <SelectTrigger className="h-8 w-[100px] text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">Viewer</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <RoleBadge role={member.role} />
      )}

      {(canManage || isSelf) && (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Options for ${member.displayName}`}
              className={cn(
                "h-8 w-8 grid place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-smooth",
                busy && "pointer-events-none opacity-50"
              )}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {isSelf && member.role !== "owner" && onLeave && (
              <DropdownMenuItem
                onSelect={() => onLeave()}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Leave collection
              </DropdownMenuItem>
            )}
            {canManage && !isSelf && member.role !== "owner" && onRemove && (
              <DropdownMenuItem
                onSelect={() => onRemove(member.userId)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove member
              </DropdownMenuItem>
            )}
            {!canManage && !isSelf && (
              <DropdownMenuItem disabled>No actions</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function PendingInviteRowEl({
  invite,
  busy,
  onCancel,
}: {
  invite: PendingInviteRow;
  busy?: boolean;
  onCancel?: (inviteId: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="text-caption font-semibold text-muted-foreground bg-muted">
          <Mail className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold leading-tight text-foreground">
          {invite.email}
        </div>
        <div className="text-caption text-muted-foreground">
          Invited · {invite.role}
        </div>
      </div>
      {onCancel && (
        <button
          onClick={() => onCancel(invite.id)}
          disabled={busy}
          aria-label={`Cancel invite to ${invite.email}`}
          className={cn(
            "h-8 px-2.5 rounded-full border border-border text-caption font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-smooth inline-flex items-center gap-1",
            busy && "pointer-events-none opacity-50"
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          Cancel
        </button>
      )}
    </div>
  );
}

