import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Switch, Route, Redirect, Link, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppShell } from "@/components/AppShell";
import { lazy, Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { gcPracticeStorage } from "@/lib/practice-storage";
import { usePrefs } from "@/hooks/use-prefs";
import { useToast } from "@/components/ui/use-toast";

// Lazy-load pages for better initial load
const AuthPage = lazy(() => import("@/pages/AuthPage"));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const VerifyEmailPage = lazy(() => import("@/pages/VerifyEmailPage"));
const VerifyEmailCallbackPage = lazy(() => import("@/pages/VerifyEmailCallbackPage"));
const HomePage = lazy(() => import("@/pages/HomePage"));
const MyStationsPage = lazy(() => import("@/pages/MyStationsPage"));
const CollectionsPage = lazy(() => import("@/pages/CollectionsPage"));
const CollectionDetailPage = lazy(() => import("@/pages/CollectionDetailPage"));
const InviteAcceptPage = lazy(() => import("@/pages/InviteAcceptPage"));
const StationEditorPage = lazy(() => import("@/pages/StationEditorPage"));
const StationDetailPage = lazy(() => import("@/pages/StationDetailPage"));
const PracticeModePage = lazy(() => import("@/pages/PracticeModePage"));
const AIPracticeModePage = lazy(() => import("@/pages/AIPracticeModePage"));
const ResultsPage = lazy(() => import("@/pages/ResultsPage"));
const ProgressPage = lazy(() => import("@/pages/ProgressPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const MockExamsPage = lazy(() => import("@/pages/MockExamsPage"));
const MockExamNewPage = lazy(() => import("@/pages/MockExamNewPage"));
const MockExamRunnerPage = lazy(() => import("@/pages/MockExamRunnerPage"));
const MockExamResultsPage = lazy(() => import("@/pages/MockExamResultsPage"));
const MockExamDetailPage = lazy(() => import("@/pages/MockExamDetailPage"));
const LibraryPage = lazy(() => import("@/pages/LibraryPage"));
const PublicStationPage = lazy(() => import("@/pages/PublicStationPage"));
const PublicCollectionPage = lazy(() => import("@/pages/PublicCollectionPage"));
const AuthorProfilePage = lazy(() => import("@/pages/AuthorProfilePage"));
const AdminReportsPage = lazy(() => import("@/pages/AdminReportsPage"));
const AdminCorrectionsPage = lazy(() => import("@/pages/AdminCorrectionsPage"));

function PageLoader() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
          <Route path="/auth" component={AuthPage} />
          <Route path="/auth/forgot" component={ForgotPasswordPage} />
          <Route path="/auth/reset/:token" component={ResetPasswordPage} />
          <Route path="/auth/verify-email" component={VerifyEmailPage} />
          <Route path="/auth/verify/:token" component={VerifyEmailCallbackPage} />

          <Route path="/home">
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          </Route>

          <Route path="/my-stations">
            <ProtectedRoute>
              <MyStationsPage />
            </ProtectedRoute>
          </Route>

          <Route path="/collections">
            <ProtectedRoute>
              <CollectionsPage />
            </ProtectedRoute>
          </Route>

          <Route path="/collections/:id">
            <ProtectedRoute>
              <CollectionDetailPage />
            </ProtectedRoute>
          </Route>

          {/* Public: accept-invite page works even without auth. */}
          <Route path="/invites/:token" component={InviteAcceptPage} />

          {/* Community library — sign-in gated. */}
          <Route path="/library">
            <ProtectedRoute>
              <LibraryPage />
            </ProtectedRoute>
          </Route>
          <Route path="/library/stations/:id">
            <ProtectedRoute>
              <PublicStationPage />
            </ProtectedRoute>
          </Route>
          <Route path="/library/collections/:id">
            <ProtectedRoute>
              <PublicCollectionPage />
            </ProtectedRoute>
          </Route>
          <Route path="/u/:userId">
            <ProtectedRoute>
              <AuthorProfilePage />
            </ProtectedRoute>
          </Route>

          {/* Admin — gated inside the page itself. */}
          <Route path="/admin/reports">
            <ProtectedRoute>
              <AdminReportsPage />
            </ProtectedRoute>
          </Route>
          <Route path="/admin/corrections">
            <ProtectedRoute>
              <AdminCorrectionsPage />
            </ProtectedRoute>
          </Route>

          <Route path="/station/new">
            <ProtectedRoute>
              <StationEditorPage />
            </ProtectedRoute>
          </Route>

          <Route path="/station/:id/edit">
            <ProtectedRoute>
              <StationEditorPage />
            </ProtectedRoute>
          </Route>

          <Route path="/station/:id/practice">
            <ProtectedRoute>
              <PracticeModePage />
            </ProtectedRoute>
          </Route>

          <Route path="/station/:id/ai-practice">
            <ProtectedRoute>
              <AIPracticeModePage />
            </ProtectedRoute>
          </Route>

          <Route path="/station/:id">
            <ProtectedRoute>
              <StationDetailPage />
            </ProtectedRoute>
          </Route>

          <Route path="/session/:id/results">
            <ProtectedRoute>
              <ResultsPage />
            </ProtectedRoute>
          </Route>

          <Route path="/progress">
            <ProtectedRoute>
              <ProgressPage />
            </ProtectedRoute>
          </Route>

          <Route path="/mock-exam">
            <ProtectedRoute>
              <MockExamsPage />
            </ProtectedRoute>
          </Route>

          <Route path="/mock-exam/new">
            <ProtectedRoute>
              <MockExamNewPage />
            </ProtectedRoute>
          </Route>

          <Route path="/mock-exam/:id/results">
            <ProtectedRoute>
              <MockExamResultsPage />
            </ProtectedRoute>
          </Route>

          {/* Template hub — stats, history, start-new-attempt CTA. */}
          <Route path="/mock-exams/:id">
            <ProtectedRoute>
              <MockExamDetailPage />
            </ProtectedRoute>
          </Route>

          {/* Legacy runner URL — accepts attemptId + phase via query string.
              Practice pages navigate here with ?phase=rest between stations. */}
          <Route path="/mock-exam/:id">
            <ProtectedRoute>
              <MockExamRunnerPage />
            </ProtectedRoute>
          </Route>

          <Route path="/settings">
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          </Route>

          <Route path="/">
            <Redirect to="/home" />
          </Route>

          {/* 404 fallback */}
          <Route>
            <div className="flex h-screen flex-col items-center justify-center gap-4">
              <h1 className="text-2xl font-semibold text-muted-foreground">404</h1>
              <p className="text-muted-foreground">Page not found</p>
              <Link href="/home" className="text-sm text-primary hover:underline">
                Go home
              </Link>
            </div>
          </Route>
        </Switch>
    </Suspense>
  );
}

export default function App() {
  const { resolvedTheme } = usePrefs();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  useEffect(() => {
    gcPracticeStorage();
  }, []);
  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ from: string }>;
      const from = e.detail?.from ?? "/home";
      // Avoid a toast storm if many queries 401 in parallel.
      toast({
        variant: "warning",
        title: "Session expired",
        description: "Please sign in again.",
      });
      const safeFrom =
        from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/auth")
          ? from
          : "/home";
      navigate(`/auth?from=${encodeURIComponent(safeFrom)}`);
    };
    window.addEventListener("socrates:session-expired", handler as EventListener);
    return () =>
      window.removeEventListener("socrates:session-expired", handler as EventListener);
  }, [navigate, toast]);
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", resolvedTheme === "dark" ? "#1E0A38" : "#FAFAF9");
    }
  }, [resolvedTheme]);
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppShell>
            <AppRoutes />
          </AppShell>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
