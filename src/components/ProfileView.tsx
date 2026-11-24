import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Calendar, Check, Copy, Edit3, KeyRound, LogOut, ShieldCheck, Upload } from 'lucide-react';
import { apiFetch, setAuthToken, uploadImages } from '../lib/api.ts';
import type { AuthUser, PostItem, PublicUser } from '../types.ts';
import { Avatar } from './Avatar.tsx';
import { AuthPanel, type AuthMode } from './AuthPanel.tsx';

interface ProfileViewProps {
  currentUser: AuthUser | null;
  adminConfigured: boolean;
  envManaged: boolean;
  initialAuthMode?: AuthMode;
  onUserUpdated: (user: AuthUser | null) => void;
  onOpenPost: (postId: number) => void;
  onOpenAdmin?: () => void;
}

export function ProfileView({
  currentUser,
  adminConfigured,
  envManaged,
  initialAuthMode = 'login',
  onUserUpdated,
  onOpenPost,
  onOpenAdmin,
}: ProfileViewProps) {
  const [subTab, setSubTab] = useState<'activity' | 'edit' | 'security'>('activity');
  const [activityPosts, setActivityPosts] = useState<PostItem[]>([]);
  const [recentComments, setRecentComments] = useState<Array<{ id: number; post_id: number; content: string; created_at: string; post_title: string }>>([]);
  const [profileStats, setProfileStats] = useState<PublicUser | null>(null);

  // Edit profile state
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [securityMsg, setSecurityMsg] = useState<string | null>(null);
  const [securityErr, setSecurityErr] = useState<string | null>(null);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.displayName);
      setUsername(currentUser.username);
      setBio(currentUser.bio);
      setAvatarUrl(currentUser.avatarUrl);
      loadActivity(currentUser.username);
    }
  }, [currentUser?.id, currentUser?.username]);

  async function loadActivity(uname: string) {
    try {
      const res = await apiFetch<{
        user: PublicUser;
        rsvpPosts: PostItem[];
        recentComments: Array<{ id: number; post_id: number; content: string; created_at: string; post_title: string }>;
      }>(`/api/users/${encodeURIComponent(uname)}`);
      setProfileStats(res.user);
      setActivityPosts(res.rsvpPosts);
      setRecentComments(res.recentComments);
    } catch {
      // ignore
    }
  }

  async function handleAvatarUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setProfileErr(null);
    try {
      const urls = await uploadImages([file]);
      if (urls[0]) setAvatarUrl(urls[0]);
    } catch (err: any) {
      setProfileErr(err?.message || 'Avatar upload failed.');
    } finally {
      setUploadingAvatar(false);
      e.target.value = '';
    }
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    setProfileErr(null);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName, username, bio, avatarUrl }),
      });
      onUserUpdated(res.user);
      setProfileMsg('Profile updated.');
    } catch (err: any) {
      setProfileErr(err?.message || 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setSecurityMsg(null);
    setSecurityErr(null);
    try {
      const res = await apiFetch<{ ok: boolean; token: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setAuthToken(res.token);
      setCurrentPassword('');
      setNewPassword('');
      setSecurityMsg('Password updated across all sessions.');
    } catch (err: any) {
      setSecurityErr(err?.message || 'Failed to update password.');
    }
  }

  async function handleRegenerateKey() {
    setSecurityMsg(null);
    setSecurityErr(null);
    try {
      const res = await apiFetch<{ recoveryKey: string }>('/api/auth/recovery-key/regenerate', {
        method: 'POST',
      });
      setRegenKey(res.recoveryKey);
    } catch (err: any) {
      setSecurityErr(err?.message || 'Unable to generate recovery key.');
    }
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    onUserUpdated(null);
  }

  if (!currentUser) {
    return (
      <div className="max-w-xl mx-auto">
        <AuthPanel
          initialMode={initialAuthMode}
          adminConfigured={adminConfigured}
          envManaged={envManaged}
          onSuccess={(user) => onUserUpdated(user)}
        />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {/* Profile Card Header */}
      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar src={currentUser.avatarUrl} name={currentUser.displayName} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display font-bold text-2xl text-white truncate">
                  {currentUser.displayName}
                </h1>
                {currentUser.role === 'admin' && (
                  <span className="text-xs font-semibold text-[#C8FF00] inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Administrator
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-400">@{currentUser.username}</p>
              {currentUser.bio && (
                <p className="text-sm text-zinc-300 mt-2 max-w-xl">{currentUser.bio}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-zinc-400 mt-2.5 tabular-nums">
                <span>
                  <strong className="text-white font-semibold">{profileStats?.goingCount ?? 0}</strong> events going
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-white font-semibold">{profileStats?.commentsCount ?? 0}</strong> comments
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {currentUser.role === 'admin' && onOpenAdmin && (
              <button
                type="button"
                onClick={onOpenAdmin}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-[#C8FF00] text-black font-semibold text-xs whitespace-nowrap"
              >
                Admin Studio
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-[#171920] hover:bg-white/10 border border-white/[0.08] text-xs font-medium text-zinc-300 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-white/[0.06] flex flex-wrap gap-1 p-1 bg-[#070709] rounded-xl w-fit">
          {(
            [
              ['activity', 'My Activity'],
              ['edit', 'Edit Profile'],
              ['security', 'Security & Recovery'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === key ? 'bg-[#1D1F27] text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {subTab === 'activity' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold text-base text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#C8FF00]" />
              <span>Events & RSVPs</span>
            </h2>
            {activityPosts.length === 0 ? (
              <p className="text-xs text-zinc-500">
                You haven&apos;t RSVP&apos;d to any events yet. Tap I&apos;M GOING on a party flyer in the feed.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {activityPosts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenPost(p.id)}
                    className="w-full py-3 text-left hover:bg-white/[0.02] transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{p.title}</p>
                      <p className="text-xs text-zinc-500 truncate">
                        {p.eventDate || 'Upcoming'} · {p.location || 'sendsclub.vip'}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold shrink-0 ${
                        p.viewerRsvp === 'going' ? 'text-[#C8FF00]' : 'text-violet-300'
                      }`}
                    >
                      {p.viewerRsvp === 'going' ? "I'M GOING" : 'Interested'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-3">
            <h2 className="font-display font-semibold text-base text-white">Recent Comments</h2>
            {recentComments.length === 0 ? (
              <p className="text-xs text-zinc-500">No comments posted yet.</p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {recentComments.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenPost(c.post_id)}
                    className="w-full py-3 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <p className="text-xs text-zinc-400 truncate">On {c.post_title}</p>
                    <p className="text-sm text-zinc-200 mt-0.5 line-clamp-2">{c.content}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'edit' && (
        <form
          onSubmit={handleSaveProfile}
          className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-5 max-w-2xl"
        >
          <h2 className="font-display font-semibold text-lg text-white flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-[#C8FF00]" />
            <span>Edit Profile</span>
          </h2>

          {profileMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
              {profileMsg}
            </div>
          )}
          {profileErr && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">
              {profileErr}
            </div>
          )}

          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={displayName || currentUser.displayName} size="xl" />
            <div className="space-y-2">
              <label className="min-h-[40px] px-4 py-2 rounded-xl bg-[#171920] hover:bg-white/10 border border-white/10 text-xs font-medium text-white inline-flex items-center gap-2 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#C8FF00]" />
                <span>{uploadingAvatar ? 'Uploading...' : 'Upload Profile Photo'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              </label>
              <p className="text-[11px] text-zinc-500">JPG, PNG, or WebP up to 8MB.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                minLength={2}
                maxLength={48}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                minLength={3}
                maxLength={24}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              placeholder="Tell SendsClub members what sounds and nights you're into..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile || uploadingAvatar}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] text-black font-semibold text-sm transition-colors"
          >
            {savingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      )}

      {subTab === 'security' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <form
            onSubmit={handleChangePassword}
            className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-4"
          >
            <h2 className="font-display font-semibold text-base text-white">Change Password</h2>
            {securityMsg && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
                {securityMsg}
              </div>
            )}
            {securityErr && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">
                {securityErr}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">New Password (min 8 chars)</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] text-black font-semibold text-xs"
            >
              Update Password
            </button>
          </form>

          <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#C8FF00]" />
              <h2 className="font-display font-semibold text-base text-white">Account Recovery Key</h2>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Your personal recovery key lets you reset your password anytime without waiting for manual support. Regenerating invalidates any previous key.
            </p>

            {regenKey && (
              <div className="p-3.5 rounded-xl bg-[#070709] border border-[#C8FF00]/40 flex items-center justify-between gap-2">
                <code className="font-mono text-sm text-[#C8FF00] select-all">{regenKey}</code>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(regenKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    } catch {
                      // ignore
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 text-xs text-white inline-flex items-center gap-1"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5 text-[#C8FF00]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleRegenerateKey}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#171920] hover:bg-white/10 border border-white/10 text-xs font-medium text-white"
            >
              Generate New Recovery Key
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
