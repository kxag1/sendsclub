import { useEffect, useState, type FormEvent } from 'react';
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit3,
  Flag,
  Heart,
  MapPin,
  MessageSquare,
  Pin,
  Reply,
  Share2,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { AuthUser, PostComment, PostItem, PublicUser } from '../types.ts';
import { Avatar, FlyerMedia } from './Avatar.tsx';
import { LocationMapSnippet } from './LocationMapSnippet.tsx';

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString.includes('T') ? isoString : `${isoString.replace(' ', 'T')}Z`);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(diffSec) || diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatEventDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

interface PostCardProps {
  post: PostItem;
  currentUser: AuthUser | null;
  autoOpenComments?: boolean;
  onRequireAuth: () => void;
  onPostUpdated: (updated: PostItem) => void;
  onPostDeleted: (postId: number) => void;
  onEditPost?: (post: PostItem) => void;
  onViewMember?: (username: string) => void;
}

export function PostCard({
  post,
  currentUser,
  autoOpenComments = false,
  onRequireAuth,
  onPostUpdated,
  onPostDeleted,
  onEditPost,
  onViewMember,
}: PostCardProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(autoOpenComments);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [reportingCommentId, setReportingCommentId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const [goingList, setGoingList] = useState<PublicUser[]>([]);
  const [interestedList, setInterestedList] = useState<PublicUser[]>([]);
  const [loadingAttendees, setLoadingAttendees] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    if (autoOpenComments) {
      setCommentsOpen(true);
    }
  }, [autoOpenComments]);

  useEffect(() => {
    if (commentsOpen) {
      loadComments();
    }
  }, [commentsOpen, post.id]);

  async function loadComments() {
    setLoadingComments(true);
    try {
      const res = await apiFetch<{ comments: PostComment[] }>(`/api/posts/${post.id}/comments`);
      setComments(res.comments);
    } catch {
      // handled silently
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleLike() {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiFetch<{ liked: boolean; likesCount: number }>(`/api/posts/${post.id}/like`, {
        method: 'POST',
      });
      onPostUpdated({
        ...post,
        viewerLiked: res.liked,
        likesCount: res.likesCount,
      });
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Unable to update like.');
    }
  }

  async function handleRsvp(status: 'going' | 'interested') {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    try {
      const nextStatus = post.viewerRsvp === status ? null : status;
      const res = await apiFetch<{
        rsvp: 'going' | 'interested' | null;
        goingCount: number;
        interestedCount: number;
        goingPreview: PublicUser[];
      }>(`/api/posts/${post.id}/rsvp`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      onPostUpdated({
        ...post,
        viewerRsvp: res.rsvp,
        goingCount: res.goingCount,
        interestedCount: res.interestedCount,
        goingPreview: res.goingPreview,
      });
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Unable to update RSVP.');
    }
  }

  async function handleTogglePin() {
    try {
      const res = await apiFetch<{ isPinned: boolean }>(`/api/posts/${post.id}/pin`, {
        method: 'PATCH',
      });
      onPostUpdated({ ...post, isPinned: res.isPinned });
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Unable to toggle pin.');
    }
  }

  async function handleDeletePost() {
    try {
      await apiFetch(`/api/posts/${post.id}`, { method: 'DELETE' });
      onPostDeleted(post.id);
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Unable to delete post.');
    }
  }

  async function handleSubmitComment(e: FormEvent) {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    setFeedbackMsg(null);
    try {
      await apiFetch(`/api/posts/${post.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          content: commentText.trim(),
          parentId: replyTo?.id || null,
        }),
      });
      setCommentText('');
      setReplyTo(null);
      await loadComments();
      onPostUpdated({ ...post, commentsCount: post.commentsCount + 1 });
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Failed to post comment.');
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleSaveEditComment(commentId: number) {
    if (!editingCommentText.trim()) return;
    try {
      await apiFetch(`/api/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: editingCommentText.trim() }),
      });
      setEditingCommentId(null);
      setEditingCommentText('');
      await loadComments();
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Failed to edit comment.');
    }
  }

  async function handleDeleteComment(commentId: number) {
    try {
      await apiFetch(`/api/comments/${commentId}`, { method: 'DELETE' });
      await loadComments();
      onPostUpdated({ ...post, commentsCount: Math.max(0, post.commentsCount - 1) });
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Failed to delete comment.');
    }
  }

  async function handleSubmitReport(commentId: number) {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (reportReason.trim().length < 3) {
      setFeedbackMsg('Please provide a brief reason before submitting a report.');
      return;
    }
    try {
      await apiFetch(`/api/comments/${commentId}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: reportReason.trim() }),
      });
      setReportingCommentId(null);
      setReportReason('');
      setFeedbackMsg('Comment reported to SendsClub moderation.');
    } catch (err: any) {
      setFeedbackMsg(err?.message || 'Unable to submit report.');
    }
  }

  async function openAttendees() {
    setAttendeesOpen(true);
    setLoadingAttendees(true);
    try {
      const res = await apiFetch<{ goingUsers: PublicUser[]; interestedUsers: PublicUser[] }>(`/api/posts/${post.id}`);
      setGoingList(res.goingUsers);
      setInterestedList(res.interestedUsers);
    } catch {
      // ignore
    } finally {
      setLoadingAttendees(false);
    }
  }

  async function handleShare() {
    const shareUrl = `${window.location.origin}/#post-${post.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    } catch {
      // ignore
    }
  }

  const activeImage = post.images[imageIndex]?.imageUrl;

  function renderCommentNode(comment: PostComment, isReply = false) {
    const canEdit = currentUser?.id === comment.userId;
    const canDelete = currentUser?.id === comment.userId || isAdmin;
    const canReport = currentUser && currentUser.id !== comment.userId;

    return (
      <div
        key={comment.id}
        className={isReply ? 'ml-7 pl-4 border-l border-white/[0.08] pt-3' : 'pt-3.5'}
      >
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={() => comment.author.role !== 'system' && onViewMember?.(comment.author.username)}
            className="shrink-0 focus-visible:outline-none"
          >
            <Avatar src={comment.author.avatarUrl} name={comment.author.displayName} size="sm" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <button
                type="button"
                onClick={() => comment.author.role !== 'system' && onViewMember?.(comment.author.username)}
                className="font-semibold text-zinc-100 hover:text-[#C8FF00] transition-colors"
              >
                {comment.author.displayName}
              </button>
              <span className="text-zinc-500">@{comment.author.username}</span>
              {comment.author.role === 'admin' && (
                <span className="text-[#C8FF00] font-medium">Host</span>
              )}
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span className="text-zinc-500 font-mono text-[11px]">{formatRelativeTime(comment.createdAt)}</span>
              {comment.isEdited && <span className="text-zinc-500 italic">(edited)</span>}
            </div>

            {editingCommentId === comment.id ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={editingCommentText}
                  onChange={(e) => setEditingCommentText(e.target.value)}
                  className="flex-1 min-h-[38px] px-3 py-1.5 rounded-lg bg-[#070709] border border-white/15 text-sm text-white focus:border-[#C8FF00] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleSaveEditComment(comment.id)}
                  className="min-h-[38px] px-3 rounded-lg bg-[#C8FF00] text-black text-xs font-semibold"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCommentId(null)}
                  className="min-h-[38px] px-2.5 text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p className="mt-1 text-sm text-zinc-200 leading-relaxed break-words">{comment.content}</p>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              {!isReply && (
                <button
                  type="button"
                  onClick={() => {
                    if (!currentUser) {
                      onRequireAuth();
                      return;
                    }
                    setReplyTo(comment);
                  }}
                  className="inline-flex items-center gap-1 hover:text-zinc-200 transition-colors py-1"
                >
                  <Reply className="w-3.5 h-3.5" />
                  <span>Reply</span>
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCommentId(comment.id);
                    setEditingCommentText(comment.content);
                  }}
                  className="inline-flex items-center gap-1 hover:text-zinc-200 transition-colors py-1"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDeleteComment(comment.id)}
                  className="inline-flex items-center gap-1 hover:text-red-400 transition-colors py-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
              {canReport && (
                <button
                  type="button"
                  onClick={() => {
                    setReportingCommentId(reportingCommentId === comment.id ? null : comment.id);
                    setReportReason('');
                  }}
                  className="inline-flex items-center gap-1 hover:text-amber-400 transition-colors py-1"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>Report</span>
                </button>
              )}
            </div>

            {reportingCommentId === comment.id && (
              <div className="mt-2 p-3 rounded-xl bg-[#070709] border border-white/10 space-y-2">
                <p className="text-xs text-zinc-300 font-medium">Report comment to SendsClub moderators</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Spam or promo', 'Harassment', 'Misleading info'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReportReason(preset)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        reportReason === preset
                          ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                          : 'bg-[#111216] border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="Reason for reporting..."
                    className="flex-1 min-h-[36px] px-3 rounded-lg bg-[#111216] border border-white/10 text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleSubmitReport(comment.id)}
                    className="min-h-[36px] px-3 rounded-lg bg-amber-500 text-black text-xs font-semibold"
                  >
                    Submit
                  </button>
                </div>
              </div>
            )}

            {comment.replies && comment.replies.length > 0 && (
              <div className="mt-1">
                {comment.replies.map((reply) => renderCommentNode(reply, true))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <article
      id={`post-${post.id}`}
      className="bg-[#111216] border border-white/[0.08] rounded-2xl overflow-hidden transition-colors"
    >
      {/* Header */}
      <div className="px-4 sm:px-6 pt-5 pb-3.5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={post.author.avatarUrl} name={post.author.displayName} size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="font-semibold text-white truncate">{post.author.displayName}</span>
              <span className="text-xs text-zinc-500 truncate">@{post.author.username}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400 mt-0.5">
              <span>{post.postType === 'event' ? 'Party / Event' : post.postType === 'announcement' ? 'Announcement' : 'Update'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px]">{formatRelativeTime(post.createdAt)}</span>
              {post.isPinned && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#C8FF00] font-medium inline-flex items-center gap-1">
                    <Pin className="w-3 h-3" />
                    Pinned
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleTogglePin}
              title={post.isPinned ? 'Unpin post' : 'Pin post'}
              className={`min-h-[38px] min-w-[38px] px-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
                post.isPinned
                  ? 'bg-[#C8FF00]/15 text-[#C8FF00]'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
            {onEditPost && (
              <button
                type="button"
                onClick={() => onEditPost(post)}
                title="Edit post"
                className="min-h-[38px] min-w-[38px] px-2.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.05] flex items-center justify-center transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleDeletePost}
              title="Delete post"
              className="min-h-[38px] min-w-[38px] px-2.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Title & Caption */}
      <div className="px-4 sm:px-6 pb-4 space-y-2">
        <h2 className="font-display font-bold text-xl sm:text-2xl text-white leading-snug text-balance">
          {post.title}
        </h2>
        <p className="text-[15px] text-zinc-300 leading-relaxed whitespace-pre-line">
          {post.caption}
        </p>
      </div>

      {/* Flyer Gallery */}
      {post.images.length > 0 && activeImage && (
        <div className="relative bg-[#070709] border-y border-white/[0.06]">
          <div className="relative w-full max-h-[540px] overflow-hidden flex items-center justify-center bg-[#070709]">
            <FlyerMedia
              src={activeImage}
              alt={`${post.title} flyer ${imageIndex + 1}`}
              title={post.title}
              onClick={() => setLightboxOpen(true)}
              className="w-full max-h-[540px] object-cover cursor-zoom-in"
            />
            {post.images.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous flyer"
                  onClick={() => setImageIndex((i) => (i - 1 + post.images.length) % post.images.length)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/15 flex items-center justify-center transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next flyer"
                  onClick={() => setImageIndex((i) => (i + 1) % post.images.length)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 text-white border border-white/15 flex items-center justify-center transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md bg-black/75 border border-white/10 text-[11px] font-mono tabular-nums text-zinc-200">
                  {imageIndex + 1} / {post.images.length}
                </div>
              </>
            )}
          </div>

          {post.images.length > 1 && (
            <div className="px-4 py-2.5 flex items-center gap-2 overflow-x-auto bg-[#0B0C0F] border-t border-white/[0.06]">
              {post.images.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setImageIndex(idx)}
                  className={`w-14 h-14 rounded-lg overflow-hidden shrink-0 border transition-all ${
                    idx === imageIndex
                      ? 'border-[#C8FF00] opacity-100'
                      : 'border-white/10 opacity-55 hover:opacity-90'
                  }`}
                >
                  <FlyerMedia
                    src={img.imageUrl}
                    alt={`Thumbnail ${idx + 1}`}
                    title={post.title}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Event Details Strip */}
      {(post.eventDate || post.location || post.venueDetails || post.dressCode || post.ticketNote) && (
        <div className="px-4 sm:px-6 py-4 bg-[#0D0E12] border-b border-white/[0.06] space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-200">
            {post.eventDate && (
              <div className="inline-flex items-center gap-2 font-mono">
                <Calendar className="w-3.5 h-3.5 text-[#C8FF00]" />
                <span>{formatEventDate(post.eventDate)}</span>
              </div>
            )}
            {post.eventTime && (
              <div className="inline-flex items-center gap-2 font-mono">
                <Clock className="w-3.5 h-3.5 text-zinc-400" />
                <span>{post.eventTime}</span>
              </div>
            )}
            {post.location && (
              <div className="inline-flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-medium">{post.location}</span>
              </div>
            )}
          </div>
          {(post.venueDetails || post.dressCode || post.ticketNote) && (
            <div className="pt-2 border-t border-white/[0.05] text-xs text-zinc-400 space-y-1">
              {post.venueDetails && <p>{post.venueDetails}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-400">
                {post.dressCode && (
                  <span>
                    <strong className="text-zinc-300 font-medium">Dress:</strong> {post.dressCode}
                  </span>
                )}
                {post.ticketNote && (
                  <span>
                    <strong className="text-zinc-300 font-medium">Entry:</strong> {post.ticketNote}
                  </span>
                )}
              </div>
            </div>
          )}
          {post.location && (
            <div className="pt-1">
              <LocationMapSnippet location={post.location} title={post.title} />
            </div>
          )}
        </div>
      )}

      {/* Attendee Summary + Social Action Bar */}
      <div className="px-4 sm:px-6 py-3.5 space-y-3">
        <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
          <button
            type="button"
            onClick={openAttendees}
            className="flex items-center gap-2.5 hover:text-zinc-200 transition-colors text-left"
          >
            {post.goingPreview.length > 0 && (
              <div className="flex -space-x-2">
                {post.goingPreview.slice(0, 4).map((u) => (
                  <Avatar
                    key={u.id}
                    src={u.avatarUrl}
                    name={u.displayName}
                    size="xs"
                    className="ring-2 ring-[#111216]"
                  />
                ))}
              </div>
            )}
            <span className="tabular-nums">
              <strong className="text-zinc-200 font-semibold">{post.goingCount}</strong> going
              <span className="mx-1.5" aria-hidden="true">·</span>
              <strong className="text-zinc-200 font-semibold">{post.interestedCount}</strong> interested
            </span>
          </button>

          <div className="flex items-center gap-3 tabular-nums">
            <span>{post.likesCount} likes</span>
            <span aria-hidden="true">·</span>
            <span>{post.commentsCount} comments</span>
          </div>
        </div>

        <div className="pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleLike}
              className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-2 border transition-colors whitespace-nowrap shrink-0 ${
                post.viewerLiked
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                  : 'bg-[#171920] border-white/[0.08] text-zinc-300 hover:text-white hover:border-white/20'
              }`}
            >
              <Heart className={`w-4 h-4 ${post.viewerLiked ? 'fill-rose-400 text-rose-400' : ''}`} />
              <span className="tabular-nums">{post.likesCount}</span>
            </button>

            {post.postType === 'event' && (
              <>
                <button
                  type="button"
                  onClick={() => handleRsvp('going')}
                  className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold tracking-wide inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 ${
                    post.viewerRsvp === 'going'
                      ? 'bg-[#C8FF00] text-black'
                      : 'bg-[#171920] border border-[#C8FF00]/40 text-[#C8FF00] hover:bg-[#C8FF00]/10'
                  }`}
                >
                  {post.viewerRsvp === 'going' && <Check className="w-4 h-4 stroke-[2.5]" />}
                  <span>I&apos;M GOING</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRsvp('interested')}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                    post.viewerRsvp === 'interested'
                      ? 'bg-violet-500/20 border-violet-400/50 text-violet-200'
                      : 'bg-[#171920] border-white/[0.08] text-zinc-300 hover:text-white hover:border-white/20'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Interested</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCommentsOpen((o) => !o)}
              className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-2 border transition-colors whitespace-nowrap shrink-0 ${
                commentsOpen
                  ? 'bg-white/[0.1] border-white/20 text-white'
                  : 'bg-[#171920] border-white/[0.08] text-zinc-300 hover:text-white'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Comments</span>
            </button>

            <button
              type="button"
              onClick={handleShare}
              aria-label="Copy link"
              className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-[#171920] border border-white/[0.08] text-zinc-300 hover:text-white inline-flex items-center justify-center gap-1.5 text-xs transition-colors shrink-0"
            >
              {copiedShare ? <Check className="w-4 h-4 text-[#C8FF00]" /> : <Share2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{copiedShare ? 'Copied' : 'Share'}</span>
            </button>
          </div>
        </div>

        {feedbackMsg && (
          <p className="text-xs text-amber-300 pt-1">{feedbackMsg}</p>
        )}
      </div>

      {/* Comments Drawer */}
      {commentsOpen && (
        <div className="px-4 sm:px-6 pb-5 pt-3 bg-[#0C0D10] border-t border-white/[0.06] space-y-3">
          {replyTo && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#171920] text-xs text-zinc-300">
              <span>
                Replying to <strong className="text-white">@{replyTo.author.username}</strong>
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}

          <form onSubmit={handleSubmitComment} className="flex items-center gap-2">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={
                currentUser
                  ? replyTo
                    ? `Write a reply to @${replyTo.author.username}...`
                    : 'Add a comment to the thread...'
                  : 'Sign in to join the conversation...'
              }
              maxLength={1000}
              className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
            />
            <button
              type="submit"
              disabled={submittingComment}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] disabled:opacity-50 text-black font-semibold text-xs whitespace-nowrap shrink-0 transition-colors"
            >
              {submittingComment ? 'Posting...' : 'Post'}
            </button>
          </form>

          {loadingComments ? (
            <p className="text-xs text-zinc-500 py-2">Loading comments...</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-zinc-500 py-2">No comments yet. Start the thread.</p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {comments.map((c) => renderCommentNode(c))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxOpen && activeImage && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close flyer preview"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-w-4xl max-h-[88vh] flex flex-col items-center">
            <img
              src={activeImage}
              alt={post.title}
              referrerPolicy="no-referrer"
              className="max-h-[82vh] w-auto rounded-xl object-contain border border-white/10"
            />
          </div>
        </div>
      )}

      {/* Attendees Modal */}
      {attendeesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setAttendeesOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#111216] border border-white/10 rounded-2xl p-5 max-h-[80vh] overflow-y-auto space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#C8FF00]" />
                <h3 className="font-display font-bold text-base text-white">Event Guestlist</h3>
              </div>
              <button
                type="button"
                onClick={() => setAttendeesOpen(false)}
                className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingAttendees ? (
              <p className="text-xs text-zinc-400">Loading guestlist...</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-[#C8FF00] mb-2 tabular-nums">
                    Going ({goingList.length})
                  </p>
                  {goingList.length === 0 ? (
                    <p className="text-xs text-zinc-500">No members confirmed yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {goingList.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setAttendeesOpen(false);
                            onViewMember?.(u.username);
                          }}
                          className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.04] text-left transition-colors"
                        >
                          <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{u.displayName}</p>
                            <p className="text-xs text-zinc-500 truncate">@{u.username}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-white/[0.06]">
                  <p className="text-xs font-semibold text-zinc-300 mb-2 tabular-nums">
                    Interested ({interestedList.length})
                  </p>
                  {interestedList.length === 0 ? (
                    <p className="text-xs text-zinc-500">No interested members yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {interestedList.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setAttendeesOpen(false);
                            onViewMember?.(u.username);
                          }}
                          className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.04] text-left transition-colors"
                        >
                          <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{u.displayName}</p>
                            <p className="text-xs text-zinc-500 truncate">@{u.username}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
