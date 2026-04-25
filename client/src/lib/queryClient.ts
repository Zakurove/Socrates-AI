import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const body = await res.text();
    let message: string;
    try {
      const json = JSON.parse(body);
      message = json.message || json.error || body;
    } catch {
      message = body || res.statusText;
    }
    throw new Error(`${res.status}: ${message}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

const defaultQueryFn: QueryFunction = async ({ queryKey }) => {
  const res = await fetch(queryKey[0] as string, {
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res.json();
};

function handle401(error: unknown) {
  if (!(error instanceof Error)) return;
  if (!error.message.startsWith("401")) return;
  if (typeof window === "undefined") return;
  // On the auth page, a 401 is expected (bad login). The form handles the
  // error inline — do not clear auth state or redirect, which would look
  // like a crash to the user.
  const path = window.location.pathname;
  if (path.startsWith("/auth")) return;
  // Clear the cached user. ProtectedRoute watches `useAuth().user` and
  // redirects to /auth via wouter's <Redirect>, which preserves the SPA
  // state (no full page reload, no lost in-memory form drafts, no flash).
  queryClient.setQueryData(["/api/auth/me"], null);
  // Notify a listener (wired in App) so it can show a "Session expired"
  // toast and redirect using wouter. The event is dispatched at most once
  // per navigation.
  window.dispatchEvent(
    new CustomEvent("socrates:session-expired", {
      detail: { from: path + window.location.search },
    }),
  );
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => handle401(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => handle401(error),
  }),
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
    mutations: {
      retry: false,
    },
  },
});
