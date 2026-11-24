export type UserRole = 'user' | 'admin' | 'system';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  role: UserRole;
  createdAt: string;
  goingCount?: number;
  commentsCount?: number;
}

export interface AuthUser extends PublicUser {
  email: string;
  hasRecoveryKey: boolean;
}

export type PostType = 'event' | 'announcement' | 'update';

export interface PostImage {
  id: number;
  imageUrl: string;
  sortOrder: number;
}

export interface PostComment {
  id: number;
  postId: number;
  userId: number;
  parentId: number | null;
  content: string;
  isEdited: boolean;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
  author: PublicUser;
  replies?: PostComment[];
}

export interface PostItem {
  id: number;
  authorId: number;
  author: PublicUser;
  postType: PostType;
  title: string;
  caption: string;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  venueDetails: string | null;
  dressCode: string | null;
  ticketNote: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  images: PostImage[];
  likesCount: number;
  goingCount: number;
  interestedCount: number;
  commentsCount: number;
  viewerLiked: boolean;
  viewerRsvp: 'going' | 'interested' | null;
  goingPreview: PublicUser[];
}

export interface NotificationItem {
  id: number;
  type: 'reply' | 'like' | 'going' | 'interested' | 'announcement' | 'moderation';
  postId: number | null;
  commentId: number | null;
  message: string;
  isRead: boolean;
  createdAt: string;
  actor: PublicUser | null;
  postTitle?: string | null;
}

export interface CommentReportItem {
  id: number;
  commentId: number;
  reason: string;
  status: 'pending' | 'dismissed' | 'actioned';
  createdAt: string;
  commentContent: string;
  commentIsHidden: boolean;
  commentAuthor: PublicUser;
  reporter: PublicUser;
  postId: number;
  postTitle: string;
}

export interface AdminAnalytics {
  totalPosts: number;
  totalUsers: number;
  totalLikes: number;
  totalGoing: number;
  totalInterested: number;
  totalComments: number;
  pendingReports: number;
  posts: Array<{
    id: number;
    title: string;
    postType: PostType;
    isPinned: boolean;
    eventDate: string | null;
    createdAt: string;
    likesCount: number;
    goingCount: number;
    interestedCount: number;
    commentsCount: number;
  }>;
}
