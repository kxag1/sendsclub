import { useEffect, useState } from 'react';
import { MessageSquare, Search, ShieldCheck, Users } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { PublicUser } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface CommunityActivityItem {
  id: number;
  postId: number;
  postTitle: string;
  postType: string;
  content: string;
  createdAt: string;
  author: PublicUser;
}

interface CommunityViewProps {
  onOpenPost: (postId: number) => void;
  onViewMember: (username: string) => void;
}

export function CommunityView({ onOpenPost, onViewMember }: CommunityViewProps) {
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [activity, setActivity] = useState<CommunityActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCommunity();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchMembers(query);
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  async function loadCommunity() {
    setLoading(true);
    try {
      const [uRes, aRes] = await Promise.all([
        apiFetch<{ users: PublicUser[] }>('/api/users'),
        apiFetch<{ activity: CommunityActivityItem[] }>('/api/community/activity'),
      ]);
      setMembers(uRes.users);
      setActivity(aRes.activity);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function searchMembers(q: string) {
    try {
      const res = await apiFetch<{ users: PublicUser[] }>(`/api/users?q=${encodeURIComponent(q)}`);
      setMembers(res.users);
    } catch {
      // ignore
    }
  }

  return (
    <section className="space-y-6">
      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-display font-bold text-2xl text-white">SendsClub Community</h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Connect with verified members, view profiles, and follow live event conversations.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members..."
              className="w-full min-h-[42px] pl-10 pr-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Members Directory */}
        <div className="lg:col-span-7 bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-base text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-[#C8FF00]" />
              <span>Members</span>
            </h2>
            <span className="text-xs font-mono text-zinc-500 tabular-nums">{members.length} profiles</span>
          </div>

          {loading ? (
            <p className="text-xs text-zinc-500">Loading directory...</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4">
              No members match &ldquo;{query}&rdquo;. Create an account in Profile to appear in the SendsClub directory.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onViewMember(m.username)}
                  className="w-full py-3.5 flex items-start justify-between gap-3 text-left hover:bg-white/[0.02] rounded-xl px-2 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar src={m.avatarUrl} name={m.displayName} size="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">{m.displayName}</span>
                        {m.role === 'admin' && (
                          <span className="text-[11px] text-[#C8FF00] inline-flex items-center gap-0.5 font-medium">
                            <ShieldCheck className="w-3 h-3" />
                            Host
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">@{m.username}</p>
                      {m.bio && <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{m.bio}</p>}
                    </div>
                  </div>
                  <div className="text-right text-[11px] font-mono text-zinc-400 shrink-0 tabular-nums">
                    <div>{m.goingCount ?? 0} going</div>
                    <div className="text-zinc-500">{m.commentsCount ?? 0} replies</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recent Threads */}
        <div className="lg:col-span-5 bg-[#111216] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <h2 className="font-display font-semibold text-base text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#C8FF00]" />
            <span>Recent Threads</span>
          </h2>
          {activity.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4">
              No comments yet. Jump into an event post to start the conversation.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {activity.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenPost(item.postId)}
                  className="w-full py-3.5 text-left hover:bg-white/[0.02] rounded-xl px-2 transition-colors space-y-1.5"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Avatar src={item.author.avatarUrl} name={item.author.displayName} size="xs" />
                    <span className="font-semibold text-zinc-200">{item.author.displayName}</span>
                    <span className="text-zinc-500 truncate">on {item.postTitle}</span>
                  </div>
                  <p className="text-sm text-zinc-300 line-clamp-2">{item.content}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
