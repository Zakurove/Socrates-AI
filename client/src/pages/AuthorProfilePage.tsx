import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  Pencil,
  Star,
  BookOpen,
  FolderOpen,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { safeFrom } from "@/lib/navigation";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  PublicStationCard,
  PublicStationCardSkeleton,
} from "@/components/library/PublicStationCard";
import { useAuthorProfile } from "@/hooks/use-author-profile";
import { useAuth } from "@/hooks/use-auth";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

function memberSince(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export default function AuthorProfilePage() {
  const params = useParams<{ userId: string }>();
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useAuthorProfile(params.userId);
  const { user } = useAuth();
  const fromParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("from")
      : null;
  const backTo = safeFrom(fromParam, "/library");

  useEffect(() => {
    if (data) {
      document.title = `${data.displayName} — Socrates AI`;
    }
  }, [data]);

  const isSelf = !!(user && data && user.id === data.id);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-[960px] px-5 py-6 safe-top">
          <div className="mb-4 h-4 w-24 animate-pulse rounded bg-warm-100" />
          <div className="mb-4 flex items-center gap-4">
            <div className="h-16 w-16 animate-pulse rounded-full bg-warm-100" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-2/3 animate-pulse rounded bg-warm-100" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-warm-100" />
            </div>
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <PublicStationCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-body text-foreground">This user wasn't found.</p>
        <Button variant="outline" onClick={() => navigate(backTo)}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <PageHeader
        backTo={backTo}
        backLabel="Back"
        wide
        actions={
          isSelf ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/settings")}
              className="gap-1.5 rounded-full text-caption"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit profile
            </Button>
          ) : null
        }
      />

      <main className="mx-auto max-w-[960px] px-5 pt-6">
        <header className="mb-6">
          <div className="mb-4 flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">
                {initials(data.displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-h1 text-foreground">
                {data.displayName}
              </h1>
              <p className="text-caption text-muted-foreground">
                Member since {memberSince(data.memberSince)}
              </p>
            </div>
          </div>

          {data.bio && (
            <p className="mb-4 whitespace-pre-wrap rounded-2xl bg-card/60 px-4 py-3 text-body italic text-foreground/90">
              {data.bio}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2">
            <StatTile
              label="Stations"
              value={data.publishedStations.length}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <StatTile
              label="Collections"
              value={data.publishedCollections.length}
              icon={<FolderOpen className="h-4 w-4" />}
            />
            <StatTile
              label="Stars"
              value={data.totalStars}
              icon={<Star className="h-4 w-4 text-brand-accent" />}
            />
          </div>
        </header>

        <Tabs defaultValue="stations" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="stations">Stations</TabsTrigger>
            <TabsTrigger value="collections">Collections</TabsTrigger>
          </TabsList>
          <TabsContent value="stations" className="mt-4">
            {data.publishedStations.length === 0 ? (
              <EmptyTab
                text={`${data.displayName} hasn't published any stations yet.`}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.publishedStations.map((s) => (
                  <PublicStationCard key={s.id} station={s} />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="collections" className="mt-4">
            {data.publishedCollections.length === 0 ? (
              <EmptyTab
                text={`${data.displayName} hasn't published any collections yet.`}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.publishedCollections.map((c) => (
                <Card
                  key={c.id}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => navigate(`/library/collections/${c.id}`)}
                  role="link"
                  tabIndex={0}
                >
                  <CardContent className="p-4">
                    <div className="mb-1 flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FolderOpen className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-[15px] font-semibold leading-tight text-foreground">
                          {c.title}
                        </h3>
                        {c.specialty && (
                          <p className="mt-0.5 text-caption text-muted-foreground">
                            {c.specialty}
                          </p>
                        )}
                      </div>
                    </div>
                    {c.description && (
                      <p className="mb-2 line-clamp-2 text-caption text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-caption text-muted-foreground tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 text-brand-accent" aria-hidden />
                        {c.starCount}
                      </span>
                      <span>{c.stationCount} stations</span>
                    </div>
                  </CardContent>
                </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-3 py-3 text-center shadow-card">
      <div className="mb-0.5 flex items-center justify-center gap-1 text-caption text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-h3 font-semibold text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-5 py-8 text-center">
      <p className="text-body text-muted-foreground">{text}</p>
    </div>
  );
}
