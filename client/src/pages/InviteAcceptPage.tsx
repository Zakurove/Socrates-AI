import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Loader2, AlertCircle, Check, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useInvite, useAcceptInvite } from "@/hooks/use-invites";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { RoleBadge } from "@/components/collections/RoleBadge";
import { usePrefs } from "@/hooks/use-prefs";

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
  const { resolvedTheme } = usePrefs();
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

  const logoSrc =
    resolvedTheme === "dark" ? "/brand/logo-dark.png" : "/brand/logo.png";

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
    // Re-render as logged-out state.
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="safe-top" />
      <div className="mx-auto max-w-md px-5 pt-14 pb-10">
        <div className="flex flex-col items-center">
          <img
            src={logoSrc}
            alt="Socrates AI"
            className="h-12 w-auto"
            draggable={false}
          />
          <h1 className="mt-4 text-h2 text-foreground">Collection invite</h1>
        </div>

        <div className="mt-8">
          {(isLoading || authLoading) && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!isLoading && status === 404 && (
            <ErrorCard
              title="Invite not found"
              message="This invite doesn't exist or was cancelled."
            />
          )}

          {!isLoading && status === 410 && (
            <ErrorCard
              title="Invite expired"
              message={
                invite?.inviterName
                  ? `This invite has expired. Ask ${invite.inviterName} for a new one.`
                  : "This invite has expired. Ask for a new one."
              }
            />
          )}

          {!isLoading && status && status !== 404 && status !== 410 && status !== 409 && (
            <ErrorCard
              title="Something went wrong"
              message="We couldn't load this invite. Please try again."
            />
          )}

          {!isLoading && invite && !status && (
            <InviteCard
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
        </div>
      </div>
    </div>
  );
}

function InviteCard({
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
  const emailsMatch =
    !!user && user.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-card p-6 space-y-5">
      <div className="space-y-2">
        <p className="text-body text-muted-foreground">
          <strong className="text-foreground">{invite.inviterName}</strong>{" "}
          invited you to
        </p>
        <h2 className="text-h1 text-foreground leading-tight">
          {invite.collectionTitle}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">as</span>
          <RoleBadge role={invite.role} />
        </div>
      </div>

      <div className="rounded-xl bg-muted/40 px-4 py-3 text-caption text-muted-foreground">
        Invite sent to <strong className="text-foreground">{invite.email}</strong>
      </div>

      {!user && (
        <div className="space-y-2">
          <Button size="lg" className="w-full" onClick={onSignIn}>
            Sign in to accept
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={onSignIn}
          >
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
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-caption text-warning-foreground">
            <AlertCircle className="h-4 w-4 mt-[2px] shrink-0" aria-hidden />
            <span>
              This invite was sent to{" "}
              <strong>{invite.email}</strong>. Sign in with that email to
              accept.
            </span>
          </div>
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={onLogoutAndRetry}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  const [, navigate] = useLocation();
  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-card p-6 space-y-3 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h2 className="text-h2 text-foreground">{title}</h2>
      <p className="text-body text-muted-foreground">{message}</p>
      <div className="pt-2">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => navigate("/home")}
        >
          Go to home
        </Button>
      </div>
    </div>
  );
}
