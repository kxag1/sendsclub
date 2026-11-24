import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar,
  Flame,
  Home,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from './lib/api.ts';
import type { AuthUser, NotificationItem, PostItem, PublicUser } from './types.ts';
import { AuthPanel, type AuthMode } from './components/AuthPanel.tsx';
import { PostCard } from './components/PostCard.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { CommunityView } from './components/CommunityView.tsx';
import { NotificationsView } from './components/NotificationsView.tsx';
import { Avatar } from './components/Avatar.tsx';

type NavTab = 'home' | 'events' | 'community' | 'notifications' | 'profile' | 'admin';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [adminConfigured, setAdminConfigured] = useState(true);
  const [envManaged, setEnvManaged] = useState(false);

  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<'all' | 'event' | 'announcement'>('all');
  const [eventsFilter, setEventsFilter] = useState<'all' | 'going' | 'interested'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedPostId, setHighlightedPostId] = useState<number | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthMode>('login');
  const [editingPost, setEditingPost] = useState<PostItem | null>(null);

  // Public member modal
  const [viewingMember, setViewingMember] = useState<{
    user: PublicUser;
    rsvpPosts: PostItem[];
  } | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoadingPosts(true);
    setPostsError(null);
    try {
      const res = await apiFetch<{ posts: PostItem[] }>('/api/posts');
      setPosts(Array.isArray(res?.posts) ? res.posts : []);
    } catch (err: any) {
      setPostsError(err?.message || 'Unable to load posts from SendsClub server.');
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiFetch<{ unreadCount: number; notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(Array.isArray(res?.notifications) ? res.notifications : []);
      setUnreadCount(typeof res?.unreadCount === 'number' ? res.unreadCount : 0);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, []);

  const refreshBootstrap = useCallback(async () => {
    try {
      const [meRes, adminRes] = await Promise.all([
        apiFetch<{ user: AuthUser | null }>('/api/auth/me'),
        apiFetch<{ adminConfigured: boolean; envManaged: boolean }>('/api/auth/admin-status'),
      ]);
      setCurrentUser(meRes.user);
      setAdminConfigured(adminRes.adminConfigured);
      setEnvManaged(adminRes.envManaged);
    } catch {
      // ignore
    } finally {
      setAuthLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshBootstrap();
    fetchPosts();
  }, [refreshBootstrap, fetchPosts]);

  useEffect(() => {
    if (currentUser) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 30000);
      return () => clearInterval(interval);
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [currentUser?.id, fetchNotifications]);

  function openAuth(mode: AuthMode = 'login') {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }

  async function handleAuthSuccess(user: AuthUser) {
    setCurrentUser(user);
    setAuthModalOpen(false);
    await Promise.all([refreshBootstrap(), fetchPosts(), fetchNotifications()]);
  }

  async function handleMarkNotificationRead(id?: number) {
    try {
      await apiFetch('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify(id ? { id } : {}),
      });
      await fetchNotifications();
    } catch {
      // ignore
    }
  }

  function jumpToPost(postId: number) {
    setHighlightedPostId(postId);
    setActiveTab('home');
    setFeedFilter('all');
    setTimeout(() => {
      const el = document.getElementById(`post-${postId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }

  async function openMemberProfile(username: string) {
    try {
      const res = await apiFetch<{ user: PublicUser; rsvpPosts: PostItem[] }>(
        `/api/users/${encodeURIComponent(username)}`
      );
      setViewingMember(res);
    } catch {
      // ignore
    }
  }

  const filteredHomePosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts.filter((p) => {
      if (feedFilter !== 'all' && p.postType !== feedFilter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.caption.toLowerCase().includes(q) ||
        (p.location || '').toLowerCase().includes(q)
      );
    });
  }, [posts, feedFilter, searchQuery]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts.filter((p) => {
      if (p.postType !== 'event') return false;
      if (eventsFilter === 'going' && p.viewerRsvp !== 'going') return false;
      if (eventsFilter === 'interested' && p.viewerRsvp !== 'interested') return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.caption.toLowerCase().includes(q) ||
        (p.location || '').toLowerCase().includes(q)
      );
    });
  }, [posts, eventsFilter, searchQuery]);

  const upcomingEventsRail = useMemo(() => {
    return posts
      .filter((p) => p.postType === 'event')
      .slice(0, 4);
  }, [posts]);

  const totalGoingAcrossFeed = useMemo(
    () => posts.reduce((acc, p) => acc + p.goingCount, 0),
    [posts]
  );

  const navItems: Array<{ id: NavTab; label: string; mobileLabel: string; icon: typeof Home }> = [
    { id: 'home', label: 'Home', mobileLabel: 'Home', icon: Home },
    { id: 'events', label: 'Events', mobileLabel: 'Events', icon: Calendar },
    { id: 'community', label: 'Community', mobileLabel: 'Club', icon: Users },
    { id: 'notifications', label: 'Notifications', mobileLabel: 'Alerts', icon: Bell },
    { id: 'profile', label: 'Profile', mobileLabel: 'Profile', icon: User },
  ];

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#070709] text-zinc-100 pb-20 md:pb-12">
      {/* Desktop & Mobile Top Bar (Three-Zone Contract on Desktop) */}
      <header className="sticky top-0 z-40 bg-[#070709]/[0.97] md:bg-[#070709]/90 md:backdrop-blur-md border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 md:h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="font-display font-extrabold text-lg md:text-xl tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FF00] rounded"
          >
            SendsClub
          </button>

          {/* Zone 2: 5 Single-Line Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative py-1 whitespace-nowrap shrink-0 transition-colors ${
                    isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  <span>
                    {item.label}
                    {item.id === 'notifications' && unreadCount > 0 ? ` (${unreadCount})` : ''}
                  </span>
                  {isActive && (
                    <span className="absolute left-0 right-0 -bottom-[21px] h-[2px] bg-[#C8FF00]" />
                  )}
                </button>
              );
            })}
            {currentUser?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`relative py-1 whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === 'admin' ? 'text-[#C8FF00]' : 'text-zinc-400 hover:text-[#C8FF00]'
                }`}
              >
                <span>Admin</span>
                {activeTab === 'admin' && (
                  <span className="absolute left-0 right-0 -bottom-[21px] h-[2px] bg-[#C8FF00]" />
                )}
              </button>
            )}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            {!authLoaded ? (
              <div className="w-20 h-9 rounded-xl bg-white/[0.05]" />
            ) : currentUser ? (
              currentUser.role === 'admin' ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingPost(null);
                    setActiveTab('admin');
                  }}
                  className="min-h-[36px] md:min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] text-black font-semibold text-xs whitespace-nowrap shrink-0 transition-colors"
                >
                  Admin Studio
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('profile')}
                  className="min-h-[36px] md:min-h-[40px] px-3 py-1.5 rounded-xl bg-[#171920] hover:bg-white/10 border border-white/[0.08] text-xs font-medium text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Avatar src={currentUser.avatarUrl} name={currentUser.displayName} size="xs" />
                  <span className="max-w-[110px] truncate">{currentUser.displayName}</span>
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => openAuth('login')}
                className="min-h-[36px] md:min-h-[40px] px-4 py-1.5 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] text-black font-semibold text-xs whitespace-nowrap shrink-0 transition-colors"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Responsive Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7">
        {activeTab === 'admin' && currentUser?.role === 'admin' ? (
          <AdminDashboard
            editingPost={editingPost}
            onClearEditing={() => setEditingPost(null)}
            onPostsMutated={fetchPosts}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Primary Stream */}
            <div className="lg:col-span-8 space-y-5">
              {activeTab === 'home' && (
                <div className="space-y-5">
                    {/* Editorial Feed Header & Controls */}
                    <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono text-zinc-400">sendsclub.vip</p>
                          <h1 className="font-display font-bold text-2xl sm:text-3xl text-white mt-0.5 text-balance">
                            Curated Nights & Club Dispatches
                          </h1>
                        </div>
                        {currentUser?.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPost(null);
                              setActiveTab('admin');
                            }}
                            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#C8FF00] text-black font-semibold text-xs whitespace-nowrap self-start sm:self-auto"
                          >
                            + Publish Post
                          </button>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-1 p-1 bg-[#070709] border border-white/[0.06] rounded-xl w-fit">
                          {(
                            [
                              ['all', 'All Posts'],
                              ['event', 'Events'],
                              ['announcement', 'Announcements'],
                            ] as const
                          ).map(([val, label]) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setFeedFilter(val)}
                              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                                feedFilter === val
                                  ? 'bg-[#1D1F27] text-white'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <div className="relative w-full sm:w-60">
                          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search events, venues..."
                            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-xl bg-[#070709] border border-white/[0.08] focus:border-[#C8FF00] focus:outline-none text-xs text-white placeholder:text-zinc-600"
                          />
                        </div>
                      </div>
                    </div>

                    {loadingPosts ? (
                      <div className="space-y-4">
                        {[1, 2].map((n) => (
                          <div
                            key={n}
                            className="h-72 rounded-2xl bg-[#111216] border border-white/[0.06]"
                          />
                        ))}
                      </div>
                    ) : postsError ? (
                      <div className="bg-[#111216] border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
                        <p className="font-display font-semibold text-base text-white">Unable to load SendsClub feed</p>
                        <p className="text-xs text-zinc-400">{postsError}</p>
                        <button
                          type="button"
                          onClick={fetchPosts}
                          className="min-h-[40px] px-4 py-2 rounded-xl bg-[#C8FF00] text-black font-semibold text-xs"
                        >
                          Retry
                        </button>
                      </div>
                    ) : filteredHomePosts.length === 0 ? (
                      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-8 text-center space-y-2">
                        <p className="font-display font-semibold text-lg text-white">No posts match your filter</p>
                        <p className="text-xs text-zinc-400">
                          Try clearing your search or switching back to All Posts.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {filteredHomePosts.map((post) => (
                          <PostCard
                            key={post.id}
                            post={post}
                            currentUser={currentUser}
                            autoOpenComments={highlightedPostId === post.id}
                            onRequireAuth={() => openAuth('login')}
                            onPostUpdated={(updated) =>
                              setPosts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
                            }
                            onPostDeleted={(id) =>
                              setPosts((prev) => prev.filter((item) => item.id !== id))
                            }
                            onEditPost={(p) => {
                              setEditingPost(p);
                              setActiveTab('admin');
                            }}
                            onViewMember={openMemberProfile}
                          />
                        ))}
                      </div>
                    )}
                </div>
              )}

              {activeTab === 'events' && (
                <div className="space-y-5">
                    <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4">
                      <div>
                        <h1 className="font-display font-bold text-2xl text-white">Upcoming Events</h1>
                        <p className="text-xs text-zinc-400 mt-1">
                          RSVP with I&apos;M GOING to unlock venue entry details and guestlist access.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-1 p-1 bg-[#070709] border border-white/[0.06] rounded-xl">
                          {(
                            [
                              ['all', 'All Events'],
                              ['going', "I'm Going"],
                              ['interested', 'Interested'],
                            ] as const
                          ).map(([val, label]) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => {
                                if ((val === 'going' || val === 'interested') && !currentUser) {
                                  openAuth('login');
                                  return;
                                }
                                setEventsFilter(val);
                              }}
                              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                                eventsFilter === val
                                  ? 'bg-[#1D1F27] text-white'
                                  : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {filteredEvents.length === 0 ? (
                      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-8 text-center space-y-2">
                        <p className="font-display font-semibold text-lg text-white">No events in this view</p>
                        <p className="text-xs text-zinc-400">
                          Tap I&apos;M GOING or Interested on an event flyer to track it here.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {filteredEvents.map((post) => (
                          <PostCard
                            key={post.id}
                            post={post}
                            currentUser={currentUser}
                            onRequireAuth={() => openAuth('login')}
                            onPostUpdated={(updated) =>
                              setPosts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
                            }
                            onPostDeleted={(id) =>
                              setPosts((prev) => prev.filter((item) => item.id !== id))
                            }
                            onEditPost={(p) => {
                              setEditingPost(p);
                              setActiveTab('admin');
                            }}
                            onViewMember={openMemberProfile}
                          />
                        ))}
                      </div>
                    )}
                </div>
              )}

              {activeTab === 'community' && (
                <CommunityView
                  onOpenPost={jumpToPost}
                  onViewMember={openMemberProfile}
                />
              )}

              {activeTab === 'notifications' && (
                <NotificationsView
                  currentUser={currentUser}
                  notifications={notifications}
                  unreadCount={unreadCount}
                  onMarkRead={handleMarkNotificationRead}
                  onOpenPost={jumpToPost}
                  onRequireAuth={() => openAuth('login')}
                />
              )}

              {activeTab === 'profile' && (
                <ProfileView
                  currentUser={currentUser}
                  adminConfigured={adminConfigured}
                  envManaged={envManaged}
                  onUserUpdated={(u) => {
                    setCurrentUser(u);
                    refreshBootstrap();
                    fetchPosts();
                  }}
                  onOpenPost={jumpToPost}
                  onOpenAdmin={() => setActiveTab('admin')}
                />
              )}
            </div>

            {/* Right Contextual Rail (Desktop Presence) */}
            <aside className="lg:col-span-4 space-y-5 lg:sticky lg:top-24">
              {/* First-Run Admin Claim Callout (shown ONLY before admin is claimed) */}
              {authLoaded && !adminConfigured && !envManaged && (
                <div className="bg-[#111216] border border-[#C8FF00]/40 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-[#C8FF00]">
                    <ShieldCheck className="w-5 h-5" />
                    <h2 className="font-display font-bold text-base">First-Run Admin Setup</h2>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    No administrator has been claimed yet. Initialize the sole SendsClub admin account now to publish flyers, pin posts, and manage moderation.
                  </p>
                  <button
                    type="button"
                    onClick={() => openAuth('claim-admin')}
                    className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] text-black font-semibold text-xs transition-colors"
                  >
                    Claim Administrator Account
                  </button>
                </div>
              )}

              {/* SendsClub Pulse Summary */}
              <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-semibold text-base text-white flex items-center gap-2">
                    <Flame className="w-4 h-4 text-[#C8FF00]" />
                    <span>Club Pulse</span>
                  </h2>
                  <span className="text-xs font-mono text-zinc-500">sendsclub.vip</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-[#070709] border border-white/[0.06]">
                    <p className="text-[11px] text-zinc-400">Events Live</p>
                    <p className="font-display font-bold text-xl text-white mt-0.5 tabular-nums">
                      {posts.filter((p) => p.postType === 'event').length}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-[#070709] border border-white/[0.06]">
                    <p className="text-[11px] text-zinc-400">Confirmed Going</p>
                    <p className="font-display font-bold text-xl text-[#C8FF00] mt-0.5 tabular-nums">
                      {totalGoingAcrossFeed}
                    </p>
                  </div>
                </div>

                {!currentUser && (
                  <div className="pt-2 border-t border-white/[0.06] space-y-2.5">
                    <p className="text-xs text-zinc-400">
                      Sign up for SendsClub to RSVP to warehouse &amp; rooftop nights, comment on flyers, and build your profile.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openAuth('register')}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-[#C8FF00] text-black font-semibold text-xs"
                      >
                        Create Account
                      </button>
                      <button
                        type="button"
                        onClick={() => openAuth('login')}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-[#171920] border border-white/10 text-zinc-200 font-medium text-xs"
                      >
                        Sign In
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Upcoming Nights Rail */}
              <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-semibold text-base text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#C8FF00]" />
                    <span>Upcoming Lineup</span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('events')}
                    className="text-xs text-zinc-400 hover:text-white"
                  >
                    View all
                  </button>
                </div>

                {upcomingEventsRail.length === 0 ? (
                  <p className="text-xs text-zinc-500">No upcoming events scheduled yet.</p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {upcomingEventsRail.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => jumpToPost(ev.id)}
                        className="w-full py-3 text-left hover:bg-white/[0.02] rounded-xl px-1.5 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{ev.title}</p>
                          <p className="text-xs text-zinc-500 truncate mt-0.5">
                            {ev.eventDate || 'TBA'} · {ev.location || 'Secret Venue'}
                          </p>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-[#C8FF00] shrink-0">
                          {ev.goingCount} going
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* Mobile Bottom Tab Bar (Thumb Zone, <=15% sticky height cap) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A0B0E] border-t border-white/[0.08] pb-safe"
      >
        <div className="grid grid-cols-5 h-14 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
                  active ? 'text-[#C8FF00]' : 'text-zinc-400'
                }`}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {item.id === 'notifications' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#C8FF00] text-black text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium tracking-tight">{item.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Auth Modal */}
      {authModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setAuthModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md my-auto">
            <AuthPanel
              initialMode={authModalMode}
              adminConfigured={adminConfigured}
              envManaged={envManaged}
              onSuccess={handleAuthSuccess}
              onCancel={() => setAuthModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Member Public Profile Modal */}
      {viewingMember && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setViewingMember(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#111216] border border-white/10 rounded-2xl p-6 space-y-4 max-h-[82vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <Avatar
                  src={viewingMember.user.avatarUrl}
                  name={viewingMember.user.displayName}
                  size="lg"
                />
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-lg text-white truncate">
                    {viewingMember.user.displayName}
                  </h3>
                  <p className="text-xs text-zinc-400">@{viewingMember.user.username}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingMember(null)}
                className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {viewingMember.user.bio && (
              <p className="text-sm text-zinc-300 leading-relaxed">{viewingMember.user.bio}</p>
            )}

            <div className="pt-3 border-t border-white/[0.06] space-y-2">
              <p className="text-xs font-semibold text-zinc-400">RSVP&apos;d Events</p>
              {viewingMember.rsvpPosts.length === 0 ? (
                <p className="text-xs text-zinc-500">No public event RSVPs yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {viewingMember.rsvpPosts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setViewingMember(null);
                        jumpToPost(p.id);
                      }}
                      className="w-full py-2.5 text-left hover:bg-white/[0.02] flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-zinc-100 truncate">{p.title}</span>
                      <span className="text-xs font-mono text-[#C8FF00] shrink-0">
                        {p.eventDate || 'Event'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
