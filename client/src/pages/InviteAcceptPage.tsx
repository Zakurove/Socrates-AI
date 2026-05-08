import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Loader2, AlertCircle, Check, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useInvite, useAcceptInvite } from "@/hooks/use-invites";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { RoleBadge } from "@/components/collections/RoleBadge";
import { AuthShell, AuthHero, StackedAuthCard } from "@/components/auth-shell";

/**
 * Parse the HTTP status code prefix from an Error message thrown by our
 * queryClient / apiRequest helpers, which format errors as `${status}: ${msg}`.
 */
function errorStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const m = /^(\d{3}):/.exec(err.message);
  return m ? Number(m[1]) : null;
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading, logout } = useAuth();
  const { data: invite, isLoading, error } = useInvite(token);
  const acceptMutation = useAcceptInvite();
  const { toast } = useToast();
  const [handledAlreadyAccepted, setHandledAlreadyAccepted] = useState(false);

  const status = errorStatus(error);

  // Handle 409 "already accepted" — redirect to the collection with a toast.
  useEffect(() => {
    if (handledAlreadyAccepted) return;
    if (status === 409) {
      setHandledAlreadyAccepted(true);
      toast({ title: "You've already joined this collection." });
      navigate("/collections");
    }
  }, [status, handledAlreadyAccepted, navigate, toast]);

  const handleAccept = async () => {
    if (!token) return;
    try {
      const res = await acceptMutation.mutateAsync({ token });
      toast({ title: "Welcome aboard" });
      navigate(`/collections/${res.collectionId}`);
    } catch (err) {
      const s = errorStatus(err);
      if (s === 409) {
        toast({ title: "You've already joined this collection." });
        navigate("/collections");
        return;
      }
      if (s === 410) {
        toast({
          title: "This invite has expired",
          description: "Ask the person who invited you for a new link.",
          variant: "warning",
        });
        return;
      }
      toast({
        title: "Couldn't accept invite",
        description:
          err instanceof Error ? err.message.replace(/^\d{3}:\s*/, "") : undefined,
        variant: "warning",
      });
    }
  };

  const handleLogoutAndReload = async () => {
    try {
      await logout();
    } catch {
      /* ignore */
    }
  };

  // ── Hero state ─────────────────────────────────────────────
  let eyebrow = "Collection Invite";
  let headline = "Join the collection";

  if (isLoading || authLoading) {
    headline = "Loading invite…";
  } else if (status === 404) {
    headline = "Invite not found";
  } else if (status === 410) {
    headline = "Invite expired";
  } else if (status && status !== 409) {
    headline = "Something went wrong";
  } else if (invite) {
    headline = invite.collectionTitle;
    eyebrow = `${invite.inviterName} invited you`;
  }

  return (
    <AuthShell>
      <main className="px-6 pb-14 flex flex-col items-center min-h-[calc(100vh-72px)] justify-center">
        <AuthHero eyebrow={eyebrow} headline={headline} />

        <div className="relative z-10 w-full max-w-[460px]">
          <StackedAuthCard>
            {(isLoading || authLoading) && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-[#5A2E9A]" />
              </div>
            )}

            {!isLoading && status === 404 && (
              <ErrorBlock
                message="This invite doesn't exist or was cancelled."
                onHome={() => navigate("/home")}
              />
            )}

            {!isLoading && status === 410 && (
              <ErrorBlock
                message={
                  invite?.inviterName
                    ? `This invite has expired. Ask ${invite.inviterName} for a new one.`
                    : "This invite has expired. Ask for a new one."
                }
                onHome={() => navigate("/home")}
              />
            )}

            {!isLoading && status && status !== 404 && status !== 410 && status !== 409 && (
              <ErrorBlock
                message="We couldn't load this invite. Please try again."
                onHome={() => navigate("/home")}
              />
            )}

            {!isLoading && invite && !status && (
              <InviteContent
                invite={invite}
                user={user}
                isAccepting={acceptMutation.isPending}
                onAccept={handleAccept}
                onSignIn={() =>
                  navigate(`/auth?from=${encodeURIComponent(`/invites/${token}`)}`)
                }
                onLogoutAndRetry={handleLogoutAndReload}
              />
            )}
          </StackedAuthCard>
        </div>

        <p className="mt-12 lg:mt-16 text-[12px] tracking-wide text-zinc-400">
          Trusted by trainees preparing for OSCE exams.
        </p>
      </main>
    </AuthShell>
  );
}

function InviteContent({
  invite,
  user,
  isAccepting,
  onAccept,
  onSignIn,
  onLogoutAndRetry,
}: {
  invite: {
    collectionTitle: string;
    inviterName: string;
    email: string;
    role: "viewer" | "editor" | "owner";
  };
  user: { email: string } | null;
  isAccepting: boolean;
  onAccept: () => void;
  onSignIn: () => void;
  onLogoutAndRetry: () => void;
}) {
  const emailsMatch = !!user && user.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl bg-zinc-50 border border-zinc-100 px-4 py-3">
        <span className="text-[13px] text-zinc-600">Joining as</span>
        <RoleBadge role={invite.role} />
      </div>

      <div className="rounded-2xl bg-zinc-50 border border-zinc-100 px-4 py-3 text-[13px] text-zinc-600">
        Invite sent to{" "}
        <span className="font-semibold text-zinc-900">{invite.email}</span>
      </div>

      {!user && (
        <div className="space-y-2">
          <Button size="lg" className="w-full" onClick={onSignIn}>
            Sign in to accept
          </Button>
          <Button size="lg" variant="outline" className="w-full" onClick={onSignIn}>
            Create account
          </Button>
        </div>
      )}

      {user && emailsMatch && (
        <Button
          size="lg"
          className="w-full gap-2"
          onClick={onAccept}
          disabled={isAccepting}
        >
          {isAccepting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Join &ldquo;{invite.collectionTitle}&rdquo;
        </Button>
      )}

      {user && !emailsMatch && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            <AlertCircle className="h-4 w-4 mt-[2px] shrink-0" aria-hidden />
            <span>
              This invite was sent to{" "}
              <strong>{invite.email}</strong>. Sign in with that email to
              accept.
            </span>
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={onLogoutAndRetry}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}

function ErrorBlock({
  message,
  onHome,
}: {
  message: string;
  onHome: () => void;
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-[14px] text-zinc-600">{message}</p>
      <Button variant="outline" className="w-full" onClick={onHome}>
        Go to home
      </Button>
    </div>
  );
}
