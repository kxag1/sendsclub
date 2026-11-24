import { Bell, CheckCheck, Heart, Megaphone, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';
import type { AuthUser, NotificationItem } from '../types.ts';
import { Avatar } from './Avatar.tsx';

interface NotificationsViewProps {
  currentUser: AuthUser | null;
  notifications: NotificationItem[];
  unreadCount: number;
  onMarkRead: (id?: number) => void;
  onOpenPost: (postId: number) => void;
  onRequireAuth: () => void;
}

export function NotificationsView({
  currentUser,
  notifications,
  unreadCount,
  onMarkRead,
  onOpenPost,
  onRequireAuth,
}: NotificationsViewProps) {
  if (!currentUser) {
    return (
      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-8 text-center space-y-3">
        <Bell className="w-8 h-8 text-zinc-500 mx-auto" />
        <h2 className="font-display font-bold text-xl text-white">Member Notifications</h2>
        <p className="text-sm text-zinc-400 max-w-md mx-auto">
          Sign in to receive real-time alerts for comment replies, event announcements, and guestlist activity.
        </p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#C8FF00] text-black font-semibold text-sm"
        >
          Sign In to SendsClub
        </button>
      </div>
    );
  }

  function renderIcon(type: NotificationItem['type']) {
    if (type === 'reply') return <MessageSquare className="w-4 h-4 text-[#C8FF00]" />;
    if (type === 'like') return <Heart className="w-4 h-4 text-rose-400" />;
    if (type === 'announcement') return <Megaphone className="w-4 h-4 text-amber-400" />;
    if (type === 'moderation') return <ShieldAlert className="w-4 h-4 text-red-400" />;
    return <Sparkles className="w-4 h-4 text-violet-400" />;
  }

  return (
    <section className="space-y-4">
      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl text-white">Notifications</h1>
          <p className="text-xs text-zinc-400 mt-0.5 tabular-nums">
            {unreadCount > 0 ? `${unreadCount} unread updates` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => onMarkRead()}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#171920] hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5"
          >
            <CheckCheck className="w-4 h-4 text-[#C8FF00]" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No notifications yet. Replies, likes, and SendsClub announcements will appear here.
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (!n.isRead) onMarkRead(n.id);
                if (n.postId) onOpenPost(n.postId);
              }}
              className={`w-full p-4 sm:px-6 flex items-start gap-3.5 text-left transition-colors hover:bg-white/[0.03] ${
                !n.isRead ? 'bg-white/[0.025]' : ''
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {n.actor ? (
                  <Avatar src={n.actor.avatarUrl} name={n.actor.displayName} size="sm" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#171920] flex items-center justify-center">
                    {renderIcon(n.type)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!n.isRead ? 'text-white font-medium' : 'text-zinc-300'}`}>
                  {n.message}
                </p>
                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1">
                  <span className="inline-flex items-center gap-1 capitalize">
                    {renderIcon(n.type)}
                    <span>{n.type}</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">{n.createdAt}</span>
                  {!n.isRead && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#C8FF00] font-medium">Unread</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
