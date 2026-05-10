import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  LogOut,
  Moon,
  Sun,
  Monitor,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldAlert,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useToast } from "@/components/ui/use-toast";
import { usePrefs } from "@/hooks/use-prefs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { prefs, setPref } = usePrefs();
  const queryClient = useQueryClient();
  const timerSounds = prefs.timerSounds;
  const ttsEnabled = prefs.ttsEnabled;
  const themePref = prefs.theme;

  // Profile editing state
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(
    ((user as { bio?: string | null } | null)?.bio) ?? "",
  );
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const profileMutation = useMutation({
    mutationFn: async (data: {
      displayName?: string;
      bio?: string;
      oldPassword?: string;
      newPassword?: string;
    }) => {
      const res = await apiRequest("PUT", "/api/auth/profile", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
      toast({ title: "Profile updated" });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
    },
    onError: (err: Error) => {
      const msg = err.message.replace(/^\d+:\s*/, "");
      toast({ title: msg || "Update failed", variant: "warning" });
    },
  });

  const handleSaveDisplayName = () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === user?.displayName) return;
    profileMutation.mutate({ displayName: trimmed });
  };

  const currentBio = ((user as { bio?: string | null } | null)?.bio) ?? "";
  const bioDirty = bio.trim() !== currentBio.trim();
  const handleSaveBio = () => {
    if (!bioDirty) return;
    profileMutation.mutate({ bio: bio.trim() });
  };

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "warning" });
      return;
    }
    if (newPassword.length < 10) {
      toast({
        title: "Password must be at least 10 characters",
        variant: "warning",
      });
      return;
    }
    profileMutation.mutate({ oldPassword, newPassword });
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/auth");
    } catch {
      toast({
        title: "Logout failed",
        variant: "warning",
      });
    }
  };

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  return (
    <div className="min-h-screen pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]">
      <div className="safe-top" />
      <div className="mx-auto max-w-2xl px-5 pt-6 space-y-8">
        <h1 className="text-h1 text-foreground">Settings</h1>

        {/* Profile */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase px-1">
            Profile
          </h2>

          <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
            <div className="flex items-center gap-4 px-5 py-4">
              <Avatar className="h-14 w-14">
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-foreground">
                  {user?.displayName || "Unnamed"}
                </p>
                <p className="truncate text-caption text-muted-foreground">
                  {user?.email || ""}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
            {/* Display name row */}
            <div className="px-5 py-4 space-y-2">
              <Label className="text-caption font-medium text-muted-foreground">
                Display name
              </Label>
              <div className="flex gap-2">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={100}
                  className="h-11 rounded-xl flex-1 text-[15px]"
                />
                <Button
                  size="sm"
                  onClick={handleSaveDisplayName}
                  disabled={
                    profileMutation.isPending ||
                    displayName.trim() === user?.displayName
                  }
                  className="h-11 rounded-full px-5"
                >
                  {profileMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>

            {/* About you (bio) */}
            <div className="px-5 py-4 space-y-2">
              <Label className="text-caption font-medium text-muted-foreground">
                About you
              </Label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                placeholder="Tell others what you're studying, training for, or interested in."
                className="rounded-xl text-[15px] resize-none"
              />
              <div className="flex items-center justify-between">
                <p className="text-caption text-muted-foreground tabular-nums">
                  {bio.length}/500
                </p>
                <Button
                  size="sm"
                  onClick={handleSaveBio}
                  disabled={profileMutation.isPending || !bioDirty}
                  className="h-10 rounded-full px-5"
                >
                  {profileMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">
                Shown on your public profile (/u/{user?.id ?? ""}).
              </p>
            </div>

            {/* Change password */}
            <div className="px-5 py-4">
              <button
                type="button"
                onClick={() => setShowPasswordForm(!showPasswordForm)}
                className="flex w-full items-center justify-between text-[15px] font-medium text-foreground min-h-[44px]"
              >
                <span>Change password</span>
                {showPasswordForm ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {showPasswordForm && (
                <div className="space-y-3 pt-3">
                  <div className="space-y-1.5">
                    <Label className="text-caption text-muted-foreground">
                      Current password
                    </Label>
                    <Input
                      type="password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      className="h-11 rounded-xl text-[15px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-caption text-muted-foreground">
                      New password (10+ characters)
                    </Label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-11 rounded-xl text-[15px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-caption text-muted-foreground">
                      Confirm new password
                    </Label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 rounded-xl text-[15px]"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleChangePassword}
                    disabled={
                      profileMutation.isPending ||
                      !oldPassword ||
                      !newPassword ||
                      !confirmPassword
                    }
                    className="h-11 rounded-full px-5"
                  >
                    {profileMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Update password"
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Preferences */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase px-1">
            Preferences
          </h2>

          <div className="rounded-2xl bg-card border border-border/60 shadow-card divide-y divide-border/60 overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-5 py-4 min-h-[56px]">
              <div className="min-w-0 flex-1">
                <Label className="text-[15px] font-medium text-foreground">
                  Timer sounds
                </Label>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  Audio cues at halfway, 2 minutes, and time up
                </p>
              </div>
              <Switch
                checked={timerSounds}
                onCheckedChange={(v) => setPref("timerSounds", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 px-5 py-4 min-h-[56px]">
              <div className="min-w-0 flex-1">
                <Label className="text-[15px] font-medium text-foreground">
                  Text-to-speech
                </Label>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  Hear patient responses during AI practice
                </p>
              </div>
              <Switch
                checked={ttsEnabled}
                onCheckedChange={(v) => setPref("ttsEnabled", v)}
              />
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase px-1">
            Appearance
          </h2>

          <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
            <div className="px-5 py-4 space-y-3">
              <p className="text-caption text-muted-foreground">
                Light, dark, or match your system
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { value: "light", label: "Light", Icon: Sun },
                    { value: "dark", label: "Dark", Icon: Moon },
                    { value: "system", label: "Auto", Icon: Monitor },
                  ] as const
                ).map(({ value, label, Icon }) => {
                  const active = themePref === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPref("theme", value)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-xl h-11 text-[13px] font-semibold transition-smooth min-h-[44px]",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/60 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Admin (only visible when isAdmin) */}
        {(user as { isAdmin?: boolean } | null)?.isAdmin && (
          <section className="space-y-3">
            <h2 className="text-label text-muted-foreground uppercase px-1">
              Admin
            </h2>
            <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden divide-y divide-border/60">
              <button
                onClick={() => navigate("/admin/reports")}
                className="w-full flex items-center gap-3 px-5 py-4 min-h-[56px] text-left transition-colors hover:bg-muted/40"
              >
                <ShieldAlert className="h-4 w-4 text-primary" />
                <span className="flex-1 text-[15px] font-medium text-foreground">
                  Reports queue
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                onClick={() => navigate("/admin/corrections")}
                className="w-full flex items-center gap-3 px-5 py-4 min-h-[56px] text-left transition-colors hover:bg-muted/40"
              >
                <ShieldAlert className="h-4 w-4 text-primary" />
                <span className="flex-1 text-[15px] font-medium text-foreground">
                  Grading corrections
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </section>
        )}

        {/* Account */}
        <section className="space-y-3">
          <h2 className="text-label text-muted-foreground uppercase px-1">
            Account
          </h2>

          <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-5 py-4 min-h-[56px] text-left transition-colors hover:bg-muted/40"
            >
              <LogOut className="h-4 w-4 text-[color:hsl(var(--destructive))]" />
              <span className="text-[15px] font-medium text-[color:hsl(var(--destructive))]">
                Sign out
              </span>
            </button>
          </div>
        </section>

        {/* Version */}
        <p className="text-center text-caption text-muted-foreground/60">
          Socrates AI v1.0.0
        </p>
      </div>
    </div>
  );
}
