import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";

/**
 * Wrap admin page content. Redirects non-admins back to /home with a toast.
 * Mirrors the gating pattern from `AdminReportsPage`.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { user, isLoading } = useAuth();
  const { toast } = useToast();

  const isAdmin = !!(user as { isAdmin?: boolean } | null)?.isAdmin;

  useEffect(() => {
    if (isLoading) return;
    if (!user || !isAdmin) {
      toast({ title: "Admins only.", variant: "warning" });
      navigate("/");
    }
  }, [isLoading, user, isAdmin, navigate, toast]);

  if (isLoading || !user || !isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title="Admin" backTo="/admin" />
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function AdminAccessRequired() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-background pb-12">
      <PageHeader title="Admin" backTo="/settings" />
      <main className="mx-auto max-w-[900px] px-5 pt-12 text-center">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-h2 text-foreground">Admin access required</h2>
        <p className="mt-2 text-body text-muted-foreground">
          You don't have permission to view this page.
        </p>
        <Button
          variant="outline"
          className="mt-4 rounded-full"
          onClick={() => navigate("/home")}
        >
          Back to home
        </Button>
      </main>
    </div>
  );
}
