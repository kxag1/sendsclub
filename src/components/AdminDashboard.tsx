import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Edit3,
  EyeOff,
  KeyRound,
  Pin,
  Plus,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, uploadImages } from '../lib/api.ts';
import type { AdminAnalytics, CommentReportItem, PostItem, PostType, PublicUser } from '../types.ts';
import { Avatar, FlyerMedia } from './Avatar.tsx';

interface AdminDashboardProps {
  editingPost: PostItem | null;
  onClearEditing: () => void;
  onPostsMutated: () => void;
}

type AdminTab = 'compose' | 'analytics' | 'moderation' | 'setup';

export function AdminDashboard({ editingPost, onClearEditing, onPostsMutated }: AdminDashboardProps) {
  const [tab, setTab] = useState<AdminTab>(editingPost ? 'compose' : 'compose');

  // Composer state
  const [postType, setPostType] = useState<PostType>('event');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [location, setLocation] = useState('');
  const [venueDetails, setVenueDetails] = useState('');
  const [dressCode, setDressCode] = useState('');
  const [ticketNote, setTicketNote] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [savingPost, setSavingPost] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Analytics & Moderation state
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [reports, setReports] = useState<CommentReportItem[]>([]);
  const [members, setMembers] = useState<Array<PublicUser & { email: string }>>([]);
  const [issuedReset, setIssuedReset] = useState<{ username: string; code: string } | null>(null);

  useEffect(() => {
    if (editingPost) {
      setTab('compose');
      setPostType(editingPost.postType);
      setTitle(editingPost.title);
      setCaption(editingPost.caption);
      setEventDate(editingPost.eventDate || '');
      setEventTime(editingPost.eventTime || '');
      setLocation(editingPost.location || '');
      setVenueDetails(editingPost.venueDetails || '');
      setDressCode(editingPost.dressCode || '');
      setTicketNote(editingPost.ticketNote || '');
      setIsPinned(editingPost.isPinned);
      setImageUrls(editingPost.images.map((i) => i.imageUrl));
      setStatusMsg(null);
      setErrorMsg(null);
    }
  }, [editingPost]);

  useEffect(() => {
    if (tab === 'analytics') loadAnalytics();
    if (tab === 'moderation') {
      loadReports();
      loadMembers();
    }
  }, [tab]);

  async function loadAnalytics() {
    try {
      const data = await apiFetch<AdminAnalytics>('/api/admin/analytics');
      setAnalytics(data);
    } catch {
      // ignore
    }
  }

  async function loadReports() {
    try {
      const data = await apiFetch<{ reports: CommentReportItem[] }>('/api/admin/reports');
      setReports(data.reports);
    } catch {
      // ignore
    }
  }

  async function loadMembers() {
    try {
      const data = await apiFetch<{ users: Array<PublicUser & { email: string }> }>('/api/admin/users');
      setMembers(data.users);
    } catch {
      // ignore
    }
  }

  function resetForm() {
    onClearEditing();
    setPostType('event');
    setTitle('');
    setCaption('');
    setEventDate('');
    setEventTime('');
    setLocation('');
    setVenueDetails('');
    setDressCode('');
    setTicketNote('');
    setIsPinned(false);
    setImageUrls([]);
  }

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const urls = await uploadImages(files);
      setImageUrls((prev) => [...prev, ...urls].slice(0, 8));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Image upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function moveImage(index: number, delta: number) {
    setImageUrls((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    setSavingPost(true);
    setStatusMsg(null);
    setErrorMsg(null);

    const payload = {
      postType,
      title,
      caption,
      eventDate: eventDate || null,
      eventTime: eventTime || null,
      location: location || null,
      venueDetails: venueDetails || null,
      dressCode: dressCode || null,
      ticketNote: ticketNote || null,
      isPinned,
      imageUrls,
    };

    try {
      if (editingPost) {
        await apiFetch(`/api/posts/${editingPost.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setStatusMsg('Post updated successfully.');
      } else {
        await apiFetch('/api/posts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStatusMsg('Published to SendsClub feed.');
      }
      resetForm();
      onPostsMutated();
      loadAnalytics();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to save post.');
    } finally {
      setSavingPost(false);
    }
  }

  async function handleResolveReport(reportId: number, action: 'dismiss' | 'hide_comment' | 'delete_comment') {
    try {
      await apiFetch(`/api/admin/reports/${reportId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await loadReports();
      onPostsMutated();
    } catch {
      // ignore
    }
  }

  async function handleTogglePinFromAnalytics(postId: number) {
    await apiFetch(`/api/posts/${postId}/pin`, { method: 'PATCH' });
    await loadAnalytics();
    onPostsMutated();
  }

  async function handleDeleteFromAnalytics(postId: number) {
    await apiFetch(`/api/posts/${postId}`, { method: 'DELETE' });
    await loadAnalytics();
    onPostsMutated();
  }

  async function handleIssueResetToken(userId: number) {
    try {
      const res = await apiFetch<{ code: string; username: string }>(`/api/admin/users/${userId}/reset-token`, {
        method: 'POST',
      });
      setIssuedReset(res);
    } catch {
      // ignore
    }
  }

  return (
    <section className="space-y-6">
      <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-2xl text-white">SendsClub Admin Studio</h1>
            <p className="text-xs text-zinc-400 mt-1">
              Publish flyers, manage announcements, review analytics, and moderate community threads.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#070709] border border-white/[0.06] rounded-xl">
            {(
              [
                ['compose', editingPost ? 'Edit Post' : 'New Post', Plus],
                ['analytics', 'Analytics', BarChart3],
                ['moderation', 'Moderation', ShieldAlert],
                ['setup', 'Security Guide', Shield],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  tab === key ? 'bg-[#C8FF00] text-black font-semibold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'compose' && (
        <form
          onSubmit={handlePublish}
          className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-lg text-white">
              {editingPost ? `Editing "${editingPost.title}"` : 'Publish Flyer or Dispatch'}
            </h2>
            {editingPost && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Cancel Edit
              </button>
            )}
          </div>

          {statusMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{statusMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          {/* Post Type & Pin */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-1 p-1 bg-[#070709] border border-white/[0.08] rounded-xl">
              {(['event', 'announcement', 'update'] as PostType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPostType(t)}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    postType === t ? 'bg-[#1D1F27] text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none text-xs font-medium text-zinc-200">
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                className="w-4 h-4 accent-[#C8FF00]"
              />
              <Pin className="w-3.5 h-3.5 text-[#C8FF00]" />
              <span>Pin to top of Home feed</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. VOID // 05: Warehouse Session"
              maxLength={140}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Caption & Lineup Details</label>
            <textarea
              required
              rows={4}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Share lineup, sound details, entry instructions, or club updates..."
              maxLength={4000}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
            />
          </div>

          {/* Multi-Flyer Uploader */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">
                Flyer Images ({imageUrls.length}/8)
              </label>
              <label className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#171920] hover:bg-[#1F222C] border border-white/10 text-xs font-medium text-white inline-flex items-center gap-2 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5 text-[#C8FF00]" />
                <span>{uploading ? 'Uploading...' : 'Upload Flyers'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  disabled={uploading}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>

            {imageUrls.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {imageUrls.map((url, idx) => (
                  <div key={`${url}-${idx}`} className="relative rounded-xl overflow-hidden bg-[#070709] border border-white/10">
                    <FlyerMedia
                      src={url}
                      alt={`Flyer ${idx + 1}`}
                      title={`Flyer ${idx + 1}`}
                      className="w-full h-32 object-cover"
                    />
                    <div className="p-1.5 flex items-center justify-between bg-[#0B0C0F] border-t border-white/10">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveImage(idx, -1)}
                          className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === imageUrls.length - 1}
                          onClick={() => moveImage(idx, 1)}
                          className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1 text-zinc-400 hover:text-red-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Event Logistics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Event Date</label>
              <input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Hours</label>
              <input
                type="text"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                placeholder="23:00 – 05:00"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Venue / Neighborhood"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Dress Code (Optional)</label>
              <input
                type="text"
                value={dressCode}
                onChange={(e) => setDressCode(e.target.value)}
                placeholder="e.g. Dark minimal"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Door / Ticket Note (Optional)</label>
              <input
                type="text"
                value={ticketNote}
                onChange={(e) => setTicketNote(e.target.value)}
                placeholder="e.g. RSVP required before midnight"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Venue & Access Notes (Optional)</label>
            <input
              type="text"
              value={venueDetails}
              onChange={(e) => setVenueDetails(e.target.value)}
              placeholder="e.g. Entrance via loading dock..."
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={savingPost || uploading}
              className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] disabled:opacity-50 text-black font-semibold text-sm transition-colors"
            >
              {savingPost ? 'Saving...' : editingPost ? 'Save Changes' : 'Publish to SendsClub'}
            </button>
          </div>
        </form>
      )}

      {tab === 'analytics' && (
        <div className="space-y-5">
          {analytics && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  ['Published Posts', analytics.totalPosts],
                  ['Going RSVPs', analytics.totalGoing],
                  ['Total Likes', analytics.totalLikes],
                  ['Member Accounts', analytics.totalUsers],
                ].map(([label, val]) => (
                  <div key={String(label)} className="bg-[#111216] border border-white/[0.08] rounded-2xl p-4">
                    <p className="text-xs text-zinc-400">{label}</p>
                    <p className="font-display font-bold text-2xl text-white mt-1 tabular-nums">{val}</p>
                  </div>
                ))}
              </div>

              <div className="bg-[#111216] border border-white/[0.08] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.06]">
                  <h2 className="font-display font-semibold text-base text-white">Post Engagement Breakdown</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] text-xs text-zinc-400">
                        <th className="py-3 px-4 font-medium">Post</th>
                        <th className="py-3 px-3 font-medium">Type</th>
                        <th className="py-3 px-3 font-medium text-right">Likes</th>
                        <th className="py-3 px-3 font-medium text-right">Going</th>
                        <th className="py-3 px-3 font-medium text-right">Interested</th>
                        <th className="py-3 px-3 font-medium text-right">Comments</th>
                        <th className="py-3 px-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {analytics.posts.map((p) => (
                        <tr key={p.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-medium text-zinc-100 max-w-[260px] truncate">
                            {p.isPinned && <span className="text-[#C8FF00] mr-1.5">[Pinned]</span>}
                            {p.title}
                          </td>
                          <td className="py-3 px-3 text-xs text-zinc-400 capitalize">{p.postType}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-200">{p.likesCount}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[#C8FF00]">{p.goingCount}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-300">{p.interestedCount}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-300">{p.commentsCount}</td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleTogglePinFromAnalytics(p.id)}
                                title="Toggle Pin"
                                className="p-2 rounded-lg text-zinc-400 hover:text-[#C8FF00]"
                              >
                                <Pin className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteFromAnalytics(p.id)}
                                title="Delete Post"
                                className="p-2 rounded-lg text-zinc-400 hover:text-red-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'moderation' && (
        <div className="space-y-6">
          <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg text-white">Reported Comments Queue</h2>
            {reports.length === 0 ? (
              <p className="text-sm text-zinc-500">No comment reports in queue.</p>
            ) : (
              <div className="space-y-3">
                {reports.map((rep) => (
                  <div key={rep.id} className="p-4 rounded-xl bg-[#070709] border border-white/[0.08] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="text-zinc-400">
                        Reported by <span className="text-zinc-200 font-medium">@{rep.reporter.username}</span>
                        <span className="mx-1.5">·</span>
                        <span>Reason: <strong className="text-amber-300">{rep.reason}</strong></span>
                      </div>
                      <span className="font-mono text-zinc-400 uppercase">{rep.status}</span>
                    </div>
                    <div className="text-sm text-zinc-200">
                      <span className="text-xs text-zinc-500 block mb-1">
                        Comment by @{rep.commentAuthor.username} on &ldquo;{rep.postTitle}&rdquo;:
                      </span>
                      {rep.commentContent}
                    </div>
                    {rep.status === 'pending' && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleResolveReport(rep.id, 'dismiss')}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#171920] hover:bg-white/10 text-xs text-zinc-200"
                        >
                          Dismiss Report
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveReport(rep.id, 'hide_comment')}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-xs text-amber-200 inline-flex items-center gap-1.5"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>Hide Comment</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveReport(rep.id, 'delete_comment')}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-xs text-red-200 inline-flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Comment</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="font-display font-semibold text-lg text-white">Member Accounts & Password Reset Assistance</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Issue a 15-minute one-time reset code if a member misplaces their Account Recovery Key.
              </p>
            </div>

            {issuedReset && (
              <div className="p-4 rounded-xl bg-[#070709] border border-[#C8FF00]/40 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-zinc-200">
                  One-time reset code for <strong>@{issuedReset.username}</strong> (expires in 15 min):
                </div>
                <code className="font-mono text-sm text-[#C8FF00] select-all">{issuedReset.code}</code>
              </div>
            )}

            <div className="divide-y divide-white/[0.06]">
              {members.map((m) => (
                <div key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={m.avatarUrl} name={m.displayName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {m.displayName} <span className="text-xs text-zinc-500">@{m.username}</span>
                      </p>
                      <p className="text-xs text-zinc-500 truncate">{m.email} · {m.role}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleIssueResetToken(m.id)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#171920] hover:bg-white/10 border border-white/10 text-xs text-zinc-200 inline-flex items-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-[#C8FF00]" />
                    <span>Issue Reset Code</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4 text-sm text-zinc-300 leading-relaxed">
          <h2 className="font-display font-semibold text-lg text-white">
            Securing Your SendsClub Administrator Account & Replit Deployment
          </h2>
          <p>
            All administrator actions — publishing, editing, pinning, deleting posts, viewing analytics, and moderating reports — are verified server-side against your signed session token and database role.
          </p>
          <div className="p-4 rounded-xl bg-[#070709] border border-white/10 space-y-2 text-xs font-mono text-zinc-300">
            <p className="text-[#C8FF00] font-semibold">Recommended Production Environment Secrets (Replit Secrets):</p>
            <p>ADMIN_EMAIL=admin@sendsclub.vip</p>
            <p>ADMIN_USERNAME=sendsclub</p>
            <p>ADMIN_PASSWORD=&lt;strong-passphrase&gt;</p>
            <p>SESSION_SECRET=&lt;random-32-char-hex-string&gt;</p>
          </div>
          <p className="text-xs text-zinc-400">
            Passwords are always hashed with per-user salted <code className="text-zinc-200">scrypt</code> and never stored in plain text. Persistent SQLite data and uploaded flyers live under <code className="text-zinc-200">data/</code>.
          </p>
        </div>
      )}
    </section>
  );
}
