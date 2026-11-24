import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import db, { initializeDatabase, TILE_CACHE_DIR, UPLOADS_DIR } from './server/db.ts';
import {
  attachUser,
  clearSessionCookie,
  createRateLimiter,
  hashPassword,
  requireAdmin,
  requireAuth,
  sanitizeMediaUrl,
  setSessionCookie,
  sha256,
  signSessionToken,
  verifyPassword,
} from './server/auth.ts';
import type { AuthUser, PostComment, PostItem, PublicUser } from './src/types.ts';

initializeDatabase();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);

// Serve persistent uploaded flyers & avatars safely
app.use(
  '/uploads',
  (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    next();
  },
  express.static(UPLOADS_DIR)
);

const ALLOWED_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_MIME_EXT[file.mimetype] || '.jpg';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 6,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and GIF images are supported.'));
    }
  },
});

const authLimiter = createRateLimiter('auth', 20, 60 * 1000);
const writeLimiter = createRateLimiter('write', 40, 60 * 1000);

function generateRecoveryCode(): string {
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `SC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function toAuthUser(row: {
  id: number;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  role: 'user' | 'admin' | 'system';
  recovery_hash: string | null;
  created_at: string;
}): AuthUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    role: row.role,
    hasRecoveryKey: Boolean(row.recovery_hash),
    createdAt: row.created_at,
  };
}

function toPublicUser(row: {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  role: 'user' | 'admin' | 'system';
  created_at: string;
  going_count?: number;
  comments_count?: number;
}): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    role: row.role,
    createdAt: row.created_at,
    goingCount: row.going_count,
    commentsCount: row.comments_count,
  };
}

function hydratePosts(postRows: any[], viewerId?: number): PostItem[] {
  if (postRows.length === 0) return [];
  const postIds = postRows.map((p) => p.id);
  const placeholders = postIds.map(() => '?').join(',');

  const images = db
    .prepare(
      `SELECT id, post_id, image_url, sort_order FROM post_images WHERE post_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`
    )
    .all(...postIds) as Array<{ id: number; post_id: number; image_url: string; sort_order: number }>;

  const likeCounts = db
    .prepare(`SELECT post_id, COUNT(*) AS cnt FROM post_likes WHERE post_id IN (${placeholders}) GROUP BY post_id`)
    .all(...postIds) as Array<{ post_id: number; cnt: number }>;

  const rsvpCounts = db
    .prepare(
      `SELECT post_id, status, COUNT(*) AS cnt FROM post_rsvps WHERE post_id IN (${placeholders}) GROUP BY post_id, status`
    )
    .all(...postIds) as Array<{ post_id: number; status: 'going' | 'interested'; cnt: number }>;

  const commentCounts = db
    .prepare(
      `SELECT post_id, COUNT(*) AS cnt FROM comments WHERE post_id IN (${placeholders}) AND is_hidden = 0 GROUP BY post_id`
    )
    .all(...postIds) as Array<{ post_id: number; cnt: number }>;

  const goingUsersRows = db
    .prepare(
      `SELECT r.post_id, u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at
       FROM post_rsvps r
       JOIN users u ON u.id = r.user_id
       WHERE r.post_id IN (${placeholders}) AND r.status = 'going'
       ORDER BY r.created_at DESC`
    )
    .all(...postIds) as any[];

  const viewerLikedSet = new Set<number>();
  const viewerRsvpMap = new Map<number, 'going' | 'interested'>();

  if (viewerId) {
    const likedRows = db
      .prepare(`SELECT post_id FROM post_likes WHERE user_id = ? AND post_id IN (${placeholders})`)
      .all(viewerId, ...postIds) as Array<{ post_id: number }>;
    for (const r of likedRows) viewerLikedSet.add(r.post_id);

    const rsvpRows = db
      .prepare(`SELECT post_id, status FROM post_rsvps WHERE user_id = ? AND post_id IN (${placeholders})`)
      .all(viewerId, ...postIds) as Array<{ post_id: number; status: 'going' | 'interested' }>;
    for (const r of rsvpRows) viewerRsvpMap.set(r.post_id, r.status);
  }

  return postRows.map((row) => {
    const postImages = images
      .filter((img) => img.post_id === row.id)
      .map((img) => ({ id: img.id, imageUrl: img.image_url, sortOrder: img.sort_order }));
    const likesCount = likeCounts.find((l) => l.post_id === row.id)?.cnt || 0;
    const goingCount = rsvpCounts.find((r) => r.post_id === row.id && r.status === 'going')?.cnt || 0;
    const interestedCount = rsvpCounts.find((r) => r.post_id === row.id && r.status === 'interested')?.cnt || 0;
    const commentsCount = commentCounts.find((c) => c.post_id === row.id)?.cnt || 0;
    const goingPreview = goingUsersRows
      .filter((u) => u.post_id === row.id)
      .slice(0, 6)
      .map(toPublicUser);

    return {
      id: row.id,
      authorId: row.author_id,
      author: {
        id: row.author_id,
        username: row.author_username,
        displayName: row.author_display_name,
        avatarUrl: row.author_avatar_url,
        bio: row.author_bio,
        role: row.author_role,
        createdAt: row.author_created_at,
      },
      postType: row.post_type,
      title: row.title,
      caption: row.caption,
      eventDate: row.event_date,
      eventTime: row.event_time,
      location: row.location,
      venueDetails: row.venue_details,
      dressCode: row.dress_code,
      ticketNote: row.ticket_note,
      isPinned: Boolean(row.is_pinned),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      images: postImages,
      likesCount,
      goingCount,
      interestedCount,
      commentsCount,
      viewerLiked: viewerLikedSet.has(row.id),
      viewerRsvp: viewerRsvpMap.get(row.id) || null,
      goingPreview,
    };
  });
}

// ---------------- AUTH & ADMIN SETUP ROUTES ----------------

app.get('/api/auth/admin-status', (_req, res) => {
  const envManaged = Boolean(process.env.ADMIN_PASSWORD?.trim());
  const adminRow = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get() as { id: number } | undefined;
  res.json({
    adminConfigured: Boolean(adminRow),
    envManaged,
  });
});

app.post('/api/auth/admin/claim', authLimiter, (req, res) => {
  if (process.env.ADMIN_PASSWORD?.trim()) {
    res.status(403).json({ error: 'Administrator account is managed via server environment variables.' });
    return;
  }

  const existingAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
  if (existingAdmin) {
    res.status(409).json({ error: 'An administrator account has already been claimed.' });
    return;
  }

  const username = String(req.body?.username || '').trim().toLowerCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim();
  const password = String(req.body?.password || '');

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3–24 characters using letters, numbers, or underscores.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (displayName.length < 2 || displayName.length > 48) {
    res.status(400).json({ error: 'Display name must be between 2 and 48 characters.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    return;
  }

  const clash = db
    .prepare(`SELECT id FROM users WHERE username = ? OR email = ?`)
    .get(username, email);
  if (clash) {
    res.status(409).json({ error: 'Username or email is already registered.' });
    return;
  }

  const recoveryKey = generateRecoveryCode();
  const passwordHash = hashPassword(password);
  const recoveryHash = hashPassword(recoveryKey);

  const tx = db.transaction(() => {
    // Re-check inside transaction for race safety
    const checkAgain = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
    if (checkAgain) {
      throw new Error('ALREADY_CLAIMED');
    }
    const info = db
      .prepare(
        `INSERT INTO users (username, email, display_name, password_hash, recovery_hash, role, avatar_url, bio)
         VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)`
      )
      .run(
        username,
        email,
        displayName,
        passwordHash,
        recoveryHash,
        '/src/assets/images/avatar_admin_xavier_1795497728682.jpg',
        'SendsClub Administrator & Host.'
      );
    const adminId = Number(info.lastInsertRowid);
    // Transfer any initial system-curated posts to the newly claimed Admin
    db.prepare(
      `UPDATE posts SET author_id = ? WHERE author_id IN (SELECT id FROM users WHERE role = 'system')`
    ).run(adminId);
    return adminId;
  });

  try {
    const adminId = tx();
    const userRow = db.prepare(`SELECT * FROM users WHERE id = ?`).get(adminId) as any;
    const token = signSessionToken(adminId, userRow.token_version);
    setSessionCookie(req, res, token);
    res.status(201).json({
      user: toAuthUser(userRow),
      token,
      recoveryKey,
    });
  } catch (err: any) {
    if (err?.message === 'ALREADY_CLAIMED') {
      res.status(409).json({ error: 'An administrator account has already been claimed.' });
      return;
    }
    res.status(500).json({ error: 'Failed to initialize administrator account.' });
  }
});

app.post('/api/auth/register', authLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim();
  const password = String(req.body?.password || '');
  const bio = String(req.body?.bio || '').trim().slice(0, 240);

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3–24 characters (lowercase letters, numbers, underscores).' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }
  if (displayName.length < 2 || displayName.length > 48) {
    res.status(400).json({ error: 'Display name must be between 2 and 48 characters.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    return;
  }

  const existing = db
    .prepare(`SELECT id FROM users WHERE username = ? OR email = ?`)
    .get(username, email);
  if (existing) {
    res.status(409).json({ error: 'That username or email is already taken.' });
    return;
  }

  const recoveryKey = generateRecoveryCode();
  const passwordHash = hashPassword(password);
  const recoveryHash = hashPassword(recoveryKey);

  const info = db
    .prepare(
      `INSERT INTO users (username, email, display_name, password_hash, recovery_hash, role, bio)
       VALUES (?, ?, ?, ?, ?, 'user', ?)`
    )
    .run(username, email, displayName, passwordHash, recoveryHash, bio);

  const userId = Number(info.lastInsertRowid);
  const userRow = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
  const token = signSessionToken(userId, userRow.token_version);
  setSessionCookie(req, res, token);
  res.status(201).json({
    user: toAuthUser(userRow),
    token,
    recoveryKey,
  });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    res.status(400).json({ error: 'Username/email and password are required.' });
    return;
  }

  const userRow = db
    .prepare(`SELECT * FROM users WHERE (username = ? OR email = ?) AND role != 'system' LIMIT 1`)
    .get(identifier, identifier) as any;

  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  const token = signSessionToken(userRow.id, userRow.token_version);
  setSessionCookie(req, res, token);
  res.json({
    user: toAuthUser(userRow),
    token,
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.currentUser) {
    res.json({ user: null });
    return;
  }
  res.json({ user: toAuthUser(req.currentUser) });
});

app.post('/api/auth/change-password', requireAuth, authLimiter, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }
  const userRow = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.currentUser!.id) as any;
  if (!userRow || !verifyPassword(currentPassword, userRow.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  const nextHash = hashPassword(newPassword);
  const nextVersion = userRow.token_version + 1;
  db.prepare(`UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?`).run(
    nextHash,
    nextVersion,
    userRow.id
  );
  const token = signSessionToken(userRow.id, nextVersion);
  setSessionCookie(req, res, token);
  res.json({ ok: true, token });
});

app.post('/api/auth/recovery-key/regenerate', requireAuth, authLimiter, (req, res) => {
  const recoveryKey = generateRecoveryCode();
  const recoveryHash = hashPassword(recoveryKey);
  db.prepare(`UPDATE users SET recovery_hash = ? WHERE id = ?`).run(recoveryHash, req.currentUser!.id);
  res.json({ recoveryKey });
});

app.post('/api/auth/password-reset/confirm', authLimiter, (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const resetCode = String(req.body?.resetCode || '').trim().toUpperCase();
  const newPassword = String(req.body?.newPassword || '');

  if (!identifier || !resetCode) {
    res.status(400).json({ error: 'Username/email and reset code or recovery key are required.' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }

  const userRow = db
    .prepare(`SELECT * FROM users WHERE (username = ? OR email = ?) AND role != 'system' LIMIT 1`)
    .get(identifier, identifier) as any;

  if (!userRow) {
    res.status(400).json({ error: 'Invalid account or reset code.' });
    return;
  }

  let verified = false;
  let usedTokenId: number | null = null;

  // Check one-time admin-issued reset token first
  const activeTokens = db
    .prepare(
      `SELECT id, token_hash, expires_at FROM password_resets
       WHERE user_id = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')
       ORDER BY id DESC`
    )
    .all(userRow.id) as Array<{ id: number; token_hash: string; expires_at: string }>;

  const codeHash = sha256(resetCode);
  for (const t of activeTokens) {
    if (t.token_hash === codeHash) {
      verified = true;
      usedTokenId = t.id;
      break;
    }
  }

  // Otherwise check user's personal Recovery Key
  if (!verified && userRow.recovery_hash && verifyPassword(resetCode, userRow.recovery_hash)) {
    verified = true;
  }

  if (!verified) {
    res.status(400).json({ error: 'Invalid or expired reset code / recovery key.' });
    return;
  }

  const nextHash = hashPassword(newPassword);
  const nextVersion = userRow.token_version + 1;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?`).run(
      nextHash,
      nextVersion,
      userRow.id
    );
    if (usedTokenId) {
      db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(usedTokenId);
    }
  });
  tx();

  res.json({ ok: true, message: 'Password updated. You can now sign in with your new password.' });
});

// ---------------- PROFILE & COMMUNITY ROUTES ----------------

app.patch('/api/profile', requireAuth, writeLimiter, (req, res) => {
  const displayName = String(req.body?.displayName ?? req.currentUser!.display_name).trim();
  const username = String(req.body?.username ?? req.currentUser!.username).trim().toLowerCase();
  const bio = String(req.body?.bio ?? req.currentUser!.bio).trim().slice(0, 280);
  const rawAvatar = req.body?.avatarUrl !== undefined ? req.body.avatarUrl : req.currentUser!.avatar_url;
  const avatarUrl = sanitizeMediaUrl(rawAvatar);

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3–24 characters (letters, numbers, underscores).' });
    return;
  }
  if (displayName.length < 2 || displayName.length > 48) {
    res.status(400).json({ error: 'Display name must be between 2 and 48 characters.' });
    return;
  }

  const clash = db
    .prepare(`SELECT id FROM users WHERE username = ? AND id != ?`)
    .get(username, req.currentUser!.id);
  if (clash) {
    res.status(409).json({ error: 'That username is already in use.' });
    return;
  }

  db.prepare(`UPDATE users SET username = ?, display_name = ?, bio = ?, avatar_url = ? WHERE id = ?`).run(
    username,
    displayName,
    bio,
    avatarUrl,
    req.currentUser!.id
  );

  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.currentUser!.id) as any;
  res.json({ user: toAuthUser(updated) });
});

app.get('/api/users', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const likeParam = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at,
        (SELECT COUNT(*) FROM post_rsvps r WHERE r.user_id = u.id AND r.status = 'going') AS going_count,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.is_hidden = 0) AS comments_count
       FROM users u
       WHERE u.role != 'system'
         AND (? = '' OR lower(u.username) LIKE ? OR lower(u.display_name) LIKE ?)
       ORDER BY (u.role = 'admin') DESC, going_count DESC, u.created_at DESC
       LIMIT 60`
    )
    .all(q, likeParam, likeParam) as any[];

  res.json({ users: rows.map(toPublicUser) });
});

app.get('/api/users/:username', (req, res) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  const userRow = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at,
        (SELECT COUNT(*) FROM post_rsvps r WHERE r.user_id = u.id AND r.status = 'going') AS going_count,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.is_hidden = 0) AS comments_count
       FROM users u WHERE u.username = ? AND u.role != 'system' LIMIT 1`
    )
    .get(username) as any;

  if (!userRow) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }

  const rsvpPosts = db
    .prepare(
      `SELECT p.*, r.status AS rsvp_status, u.username AS author_username, u.display_name AS author_display_name,
        u.avatar_url AS author_avatar_url, u.bio AS author_bio, u.role AS author_role, u.created_at AS author_created_at
       FROM post_rsvps r
       JOIN posts p ON p.id = r.post_id
       JOIN users u ON u.id = p.author_id
       WHERE r.user_id = ?
       ORDER BY p.event_date ASC, p.created_at DESC`
    )
    .all(userRow.id) as any[];

  const recentComments = db
    .prepare(
      `SELECT c.id, c.post_id, c.content, c.created_at, p.title AS post_title
       FROM comments c
       JOIN posts p ON p.id = c.post_id
       WHERE c.user_id = ? AND c.is_hidden = 0
       ORDER BY c.created_at DESC LIMIT 15`
    )
    .all(userRow.id) as any[];

  res.json({
    user: toPublicUser(userRow),
    rsvpPosts: hydratePosts(rsvpPosts, req.currentUser?.id),
    recentComments,
  });
});

app.get('/api/community/activity', (_req, res) => {
  const comments = db
    .prepare(
      `SELECT c.id, c.post_id, c.content, c.created_at, p.title AS post_title, p.post_type,
        u.id AS author_id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at AS user_created_at
       FROM comments c
       JOIN posts p ON p.id = c.post_id
       JOIN users u ON u.id = c.user_id
       WHERE c.is_hidden = 0
       ORDER BY c.created_at DESC
       LIMIT 20`
    )
    .all() as any[];

  res.json({
    activity: comments.map((row) => ({
      id: row.id,
      postId: row.post_id,
      postTitle: row.post_title,
      postType: row.post_type,
      content: row.content,
      createdAt: row.created_at,
      author: {
        id: row.author_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        bio: row.bio,
        role: row.role,
        createdAt: row.user_created_at,
      },
    })),
  });
});

// ---------------- UPLOAD ROUTE ----------------

app.post('/api/upload', requireAuth, writeLimiter, (req, res) => {
  upload.array('images', 6)(req, res, (err: any) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Image upload failed.' });
      return;
    }
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No valid image files provided.' });
      return;
    }
    if (req.currentUser!.role !== 'admin' && files.length > 1) {
      // Remove excess files
      for (const f of files.slice(1)) {
        const resolved = path.resolve(f.path);
        if (resolved.startsWith(UPLOADS_DIR + path.sep)) {
          fs.unlink(resolved, () => {});
        }
      }
    }
    const allowedFiles = req.currentUser!.role === 'admin' ? files : files.slice(0, 1);
    const urls = allowedFiles.map((f) => `/uploads/${path.basename(f.filename)}`);
    res.status(201).json({ urls });
  });
});

// ---------------- POSTS, LIKES & RSVPS ROUTES ----------------

app.get('/api/posts', (req, res) => {
  const type = String(req.query.type || 'all');
  const q = String(req.query.q || '').trim().toLowerCase();
  const rsvpFilter = String(req.query.rsvp || '');

  const conditions: string[] = [];
  const params: any[] = [];

  if (type === 'event' || type === 'announcement' || type === 'update') {
    conditions.push('p.post_type = ?');
    params.push(type);
  }
  if (q) {
    conditions.push('(lower(p.title) LIKE ? OR lower(p.caption) LIKE ? OR lower(coalesce(p.location, "")) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if ((rsvpFilter === 'going' || rsvpFilter === 'interested') && req.currentUser) {
    conditions.push('EXISTS (SELECT 1 FROM post_rsvps r WHERE r.post_id = p.id AND r.user_id = ? AND r.status = ?)');
    params.push(req.currentUser.id, rsvpFilter);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT p.*, u.username AS author_username, u.display_name AS author_display_name,
        u.avatar_url AS author_avatar_url, u.bio AS author_bio, u.role AS author_role, u.created_at AS author_created_at
       FROM posts p
       JOIN users u ON u.id = p.author_id
       ${whereClause}
       ORDER BY p.is_pinned DESC, datetime(p.created_at) DESC, p.id DESC`
    )
    .all(...params) as any[];

  res.json({ posts: hydratePosts(rows, req.currentUser?.id) });
});

app.get('/api/posts/:id', (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId <= 0) {
    res.status(400).json({ error: 'Invalid post ID.' });
    return;
  }
  const row = db
    .prepare(
      `SELECT p.*, u.username AS author_username, u.display_name AS author_display_name,
        u.avatar_url AS author_avatar_url, u.bio AS author_bio, u.role AS author_role, u.created_at AS author_created_at
       FROM posts p
       JOIN users u ON u.id = p.author_id
       WHERE p.id = ?`
    )
    .get(postId) as any;

  if (!row) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  const goingUsers = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at
       FROM post_rsvps r JOIN users u ON u.id = r.user_id
       WHERE r.post_id = ? AND r.status = 'going'
       ORDER BY r.created_at DESC`
    )
    .all(postId) as any[];

  const interestedUsers = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at
       FROM post_rsvps r JOIN users u ON u.id = r.user_id
       WHERE r.post_id = ? AND r.status = 'interested'
       ORDER BY r.created_at DESC`
    )
    .all(postId) as any[];

  res.json({
    post: hydratePosts([row], req.currentUser?.id)[0],
    goingUsers: goingUsers.map(toPublicUser),
    interestedUsers: interestedUsers.map(toPublicUser),
  });
});

app.post('/api/posts', requireAuth, requireAdmin, writeLimiter, (req, res) => {
  const postType = req.body?.postType;
  const title = String(req.body?.title || '').trim();
  const caption = String(req.body?.caption || '').trim();
  const eventDate = req.body?.eventDate ? String(req.body.eventDate).trim().slice(0, 32) : null;
  const eventTime = req.body?.eventTime ? String(req.body.eventTime).trim().slice(0, 64) : null;
  const location = req.body?.location ? String(req.body.location).trim().slice(0, 140) : null;
  const venueDetails = req.body?.venueDetails ? String(req.body.venueDetails).trim().slice(0, 400) : null;
  const dressCode = req.body?.dressCode ? String(req.body.dressCode).trim().slice(0, 120) : null;
  const ticketNote = req.body?.ticketNote ? String(req.body.ticketNote).trim().slice(0, 200) : null;
  const isPinned = req.body?.isPinned ? 1 : 0;
  const rawImages = Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : [];
  const imageUrls = rawImages
    .map((u: unknown) => sanitizeMediaUrl(typeof u === 'string' ? u : null))
    .filter((u: string | null): u is string => Boolean(u))
    .slice(0, 8);

  if (!['event', 'announcement', 'update'].includes(postType)) {
    res.status(400).json({ error: 'Post type must be event, announcement, or update.' });
    return;
  }
  if (title.length < 2 || title.length > 140) {
    res.status(400).json({ error: 'Title must be between 2 and 140 characters.' });
    return;
  }
  if (caption.length < 2 || caption.length > 4000) {
    res.status(400).json({ error: 'Caption must be between 2 and 4000 characters.' });
    return;
  }

  const insertTx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO posts (
          author_id, post_type, title, caption, event_date, event_time,
          location, venue_details, dress_code, ticket_note, is_pinned
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.currentUser!.id,
        postType,
        title,
        caption,
        eventDate,
        eventTime,
        location,
        venueDetails,
        dressCode,
        ticketNote,
        isPinned
      );

    const postId = Number(info.lastInsertRowid);
    const insertImg = db.prepare(`INSERT INTO post_images (post_id, image_url, sort_order) VALUES (?, ?, ?)`);
    imageUrls.forEach((url: string, idx: number) => {
      insertImg.run(postId, url, idx);
    });

    if (postType === 'announcement' || isPinned) {
      const members = db
        .prepare(`SELECT id FROM users WHERE role = 'user' AND id != ?`)
        .all(req.currentUser!.id) as Array<{ id: number }>;
      const insertNotif = db.prepare(
        `INSERT INTO notifications (user_id, actor_id, type, post_id, message) VALUES (?, ?, 'announcement', ?, ?)`
      );
      for (const m of members) {
        insertNotif.run(m.id, req.currentUser!.id, postId, `New dispatch: ${title}`);
      }
    }

    return postId;
  });

  const postId = insertTx();
  const createdRow = db
    .prepare(
      `SELECT p.*, u.username AS author_username, u.display_name AS author_display_name,
        u.avatar_url AS author_avatar_url, u.bio AS author_bio, u.role AS author_role, u.created_at AS author_created_at
       FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`
    )
    .get(postId) as any;

  res.status(201).json({ post: hydratePosts([createdRow], req.currentUser!.id)[0] });
});

app.patch('/api/posts/:id', requireAuth, requireAdmin, writeLimiter, (req, res) => {
  const postId = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(postId) as any;
  if (!existing) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  const postType = req.body?.postType ?? existing.post_type;
  const title = String(req.body?.title ?? existing.title).trim();
  const caption = String(req.body?.caption ?? existing.caption).trim();
  const eventDate = req.body?.eventDate !== undefined ? (req.body.eventDate ? String(req.body.eventDate).trim() : null) : existing.event_date;
  const eventTime = req.body?.eventTime !== undefined ? (req.body.eventTime ? String(req.body.eventTime).trim() : null) : existing.event_time;
  const location = req.body?.location !== undefined ? (req.body.location ? String(req.body.location).trim() : null) : existing.location;
  const venueDetails = req.body?.venueDetails !== undefined ? (req.body.venueDetails ? String(req.body.venueDetails).trim() : null) : existing.venue_details;
  const dressCode = req.body?.dressCode !== undefined ? (req.body.dressCode ? String(req.body.dressCode).trim() : null) : existing.dress_code;
  const ticketNote = req.body?.ticketNote !== undefined ? (req.body.ticketNote ? String(req.body.ticketNote).trim() : null) : existing.ticket_note;
  const isPinned = req.body?.isPinned !== undefined ? (req.body.isPinned ? 1 : 0) : existing.is_pinned;

  if (!['event', 'announcement', 'update'].includes(postType)) {
    res.status(400).json({ error: 'Invalid post type.' });
    return;
  }
  if (title.length < 2 || title.length > 140 || caption.length < 2 || caption.length > 4000) {
    res.status(400).json({ error: 'Title or caption length is out of bounds.' });
    return;
  }

  const updateTx = db.transaction(() => {
    db.prepare(
      `UPDATE posts SET
        post_type = ?, title = ?, caption = ?, event_date = ?, event_time = ?,
        location = ?, venue_details = ?, dress_code = ?, ticket_note = ?, is_pinned = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      postType,
      title,
      caption,
      eventDate,
      eventTime,
      location,
      venueDetails,
      dressCode,
      ticketNote,
      isPinned,
      postId
    );

    if (Array.isArray(req.body?.imageUrls)) {
      const imageUrls = req.body.imageUrls
        .map((u: unknown) => sanitizeMediaUrl(typeof u === 'string' ? u : null))
        .filter((u: string | null): u is string => Boolean(u))
        .slice(0, 8);

      db.prepare(`DELETE FROM post_images WHERE post_id = ?`).run(postId);
      const insertImg = db.prepare(`INSERT INTO post_images (post_id, image_url, sort_order) VALUES (?, ?, ?)`);
      imageUrls.forEach((url: string, idx: number) => {
        insertImg.run(postId, url, idx);
      });
    }
  });

  updateTx();

  const updatedRow = db
    .prepare(
      `SELECT p.*, u.username AS author_username, u.display_name AS author_display_name,
        u.avatar_url AS author_avatar_url, u.bio AS author_bio, u.role AS author_role, u.created_at AS author_created_at
       FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`
    )
    .get(postId) as any;

  res.json({ post: hydratePosts([updatedRow], req.currentUser!.id)[0] });
});

app.patch('/api/posts/:id/pin', requireAuth, requireAdmin, writeLimiter, (req, res) => {
  const postId = Number(req.params.id);
  const existing = db.prepare(`SELECT id, is_pinned FROM posts WHERE id = ?`).get(postId) as
    | { id: number; is_pinned: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }
  const nextPinned = existing.is_pinned ? 0 : 1;
  db.prepare(`UPDATE posts SET is_pinned = ?, updated_at = datetime('now') WHERE id = ?`).run(nextPinned, postId);
  res.json({ isPinned: Boolean(nextPinned) });
});

app.delete('/api/posts/:id', requireAuth, requireAdmin, writeLimiter, (req, res) => {
  const postId = Number(req.params.id);
  const info = db.prepare(`DELETE FROM posts WHERE id = ?`).run(postId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', requireAuth, writeLimiter, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.prepare(`SELECT id, author_id, title FROM posts WHERE id = ?`).get(postId) as
    | { id: number; author_id: number; title: string }
    | undefined;
  if (!post) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  const existing = db
    .prepare(`SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?`)
    .get(postId, req.currentUser!.id);

  let liked = false;
  if (existing) {
    db.prepare(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`).run(postId, req.currentUser!.id);
    liked = false;
  } else {
    db.prepare(`INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)`).run(postId, req.currentUser!.id);
    liked = true;
    if (post.author_id !== req.currentUser!.id) {
      db.prepare(
        `INSERT INTO notifications (user_id, actor_id, type, post_id, message) VALUES (?, ?, 'like', ?, ?)`
      ).run(post.author_id, req.currentUser!.id, postId, `${req.currentUser!.display_name} liked "${post.title}"`);
    }
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM post_likes WHERE post_id = ?`)
    .get(postId) as { cnt: number };

  res.json({ liked, likesCount: countRow.cnt });
});

app.post('/api/posts/:id/rsvp', requireAuth, writeLimiter, (req, res) => {
  const postId = Number(req.params.id);
  const status = req.body?.status;
  if (status !== null && status !== 'going' && status !== 'interested') {
    res.status(400).json({ error: 'RSVP status must be going, interested, or null.' });
    return;
  }

  const post = db.prepare(`SELECT id, author_id, title FROM posts WHERE id = ?`).get(postId) as
    | { id: number; author_id: number; title: string }
    | undefined;
  if (!post) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  const existing = db
    .prepare(`SELECT id, status FROM post_rsvps WHERE post_id = ? AND user_id = ?`)
    .get(postId, req.currentUser!.id) as { id: number; status: 'going' | 'interested' } | undefined;

  let nextStatus: 'going' | 'interested' | null = status;
  if (status === null || (existing && existing.status === status)) {
    db.prepare(`DELETE FROM post_rsvps WHERE post_id = ? AND user_id = ?`).run(postId, req.currentUser!.id);
    nextStatus = null;
  } else {
    db.prepare(
      `INSERT INTO post_rsvps (post_id, user_id, status) VALUES (?, ?, ?)
       ON CONFLICT(post_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`
    ).run(postId, req.currentUser!.id, status);

    if (post.author_id !== req.currentUser!.id) {
      const verb = status === 'going' ? 'is going to' : 'is interested in';
      db.prepare(
        `INSERT INTO notifications (user_id, actor_id, type, post_id, message) VALUES (?, ?, ?, ?, ?)`
      ).run(
        post.author_id,
        req.currentUser!.id,
        status,
        postId,
        `${req.currentUser!.display_name} ${verb} "${post.title}"`
      );
    }
  }

  const goingRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM post_rsvps WHERE post_id = ? AND status = 'going'`)
    .get(postId) as { cnt: number };
  const interestedRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM post_rsvps WHERE post_id = ? AND status = 'interested'`)
    .get(postId) as { cnt: number };

  const goingUsers = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at
       FROM post_rsvps r JOIN users u ON u.id = r.user_id
       WHERE r.post_id = ? AND r.status = 'going'
       ORDER BY r.created_at DESC LIMIT 6`
    )
    .all(postId) as any[];

  res.json({
    rsvp: nextStatus,
    goingCount: goingRow.cnt,
    interestedCount: interestedRow.cnt,
    goingPreview: goingUsers.map(toPublicUser),
  });
});

// ---------------- COMMENTS & MODERATION ROUTES ----------------

app.get('/api/posts/:id/comments', (req, res) => {
  const postId = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at AS user_created_at
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id = ? AND c.is_hidden = 0
       ORDER BY datetime(c.created_at) ASC, c.id ASC`
    )
    .all(postId) as any[];

  const map = new Map<number, PostComment>();
  const roots: PostComment[] = [];

  for (const r of rows) {
    const comment: PostComment = {
      id: r.id,
      postId: r.post_id,
      userId: r.user_id,
      parentId: r.parent_id,
      content: r.content,
      isEdited: Boolean(r.is_edited),
      isHidden: Boolean(r.is_hidden),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: {
        id: r.user_id,
        username: r.username,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        bio: r.bio,
        role: r.role,
        createdAt: r.user_created_at,
      },
      replies: [],
    };
    map.set(comment.id, comment);
  }

  for (const comment of map.values()) {
    if (comment.parentId && map.has(comment.parentId)) {
      map.get(comment.parentId)!.replies!.push(comment);
    } else {
      roots.push(comment);
    }
  }

  res.json({ comments: roots });
});

app.post('/api/posts/:id/comments', requireAuth, writeLimiter, (req, res) => {
  const postId = Number(req.params.id);
  const content = String(req.body?.content || '').trim();
  const parentId = req.body?.parentId ? Number(req.body.parentId) : null;

  if (content.length < 1 || content.length > 1000) {
    res.status(400).json({ error: 'Comment must be between 1 and 1000 characters.' });
    return;
  }

  const post = db.prepare(`SELECT id, author_id, title FROM posts WHERE id = ?`).get(postId) as
    | { id: number; author_id: number; title: string }
    | undefined;
  if (!post) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  let parentComment: { id: number; user_id: number; parent_id: number | null } | undefined;
  if (parentId) {
    parentComment = db
      .prepare(`SELECT id, user_id, parent_id FROM comments WHERE id = ? AND post_id = ? AND is_hidden = 0`)
      .get(parentId, postId) as any;
    if (!parentComment) {
      res.status(404).json({ error: 'Parent comment not found.' });
      return;
    }
  }

  // Normalize reply nesting to max 2 levels cleanly
  const effectiveParentId = parentComment ? parentComment.parent_id || parentComment.id : null;

  const info = db
    .prepare(`INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)`)
    .run(postId, req.currentUser!.id, effectiveParentId, content);

  const commentId = Number(info.lastInsertRowid);
  const notifiedUsers = new Set<number>();

  if (parentComment && parentComment.user_id !== req.currentUser!.id) {
    db.prepare(
      `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, message) VALUES (?, ?, 'reply', ?, ?, ?)`
    ).run(
      parentComment.user_id,
      req.currentUser!.id,
      postId,
      commentId,
      `${req.currentUser!.display_name} replied to your comment on "${post.title}"`
    );
    notifiedUsers.add(parentComment.user_id);
  }

  if (post.author_id !== req.currentUser!.id && !notifiedUsers.has(post.author_id)) {
    db.prepare(
      `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, message) VALUES (?, ?, 'reply', ?, ?, ?)`
    ).run(
      post.author_id,
      req.currentUser!.id,
      postId,
      commentId,
      `${req.currentUser!.display_name} commented on "${post.title}"`
    );
  }

  const created = db
    .prepare(
      `SELECT c.*, u.username, u.display_name, u.avatar_url, u.bio, u.role, u.created_at AS user_created_at
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(commentId) as any;

  res.status(201).json({
    comment: {
      id: created.id,
      postId: created.post_id,
      userId: created.user_id,
      parentId: created.parent_id,
      content: created.content,
      isEdited: Boolean(created.is_edited),
      isHidden: Boolean(created.is_hidden),
      createdAt: created.created_at,
      updatedAt: created.updated_at,
      author: {
        id: created.user_id,
        username: created.username,
        displayName: created.display_name,
        avatarUrl: created.avatar_url,
        bio: created.bio,
        role: created.role,
        createdAt: created.user_created_at,
      },
      replies: [],
    },
  });
});

app.patch('/api/comments/:id', requireAuth, writeLimiter, (req, res) => {
  const commentId = Number(req.params.id);
  const content = String(req.body?.content || '').trim();
  if (content.length < 1 || content.length > 1000) {
    res.status(400).json({ error: 'Comment must be between 1 and 1000 characters.' });
    return;
  }

  const existing = db.prepare(`SELECT id, user_id FROM comments WHERE id = ?`).get(commentId) as
    | { id: number; user_id: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Comment not found.' });
    return;
  }
  if (existing.user_id !== req.currentUser!.id) {
    res.status(403).json({ error: 'You can only edit your own comments.' });
    return;
  }

  db.prepare(`UPDATE comments SET content = ?, is_edited = 1, updated_at = datetime('now') WHERE id = ?`).run(
    content,
    commentId
  );
  res.json({ ok: true, content });
});

app.delete('/api/comments/:id', requireAuth, writeLimiter, (req, res) => {
  const commentId = Number(req.params.id);
  const existing = db.prepare(`SELECT id, user_id FROM comments WHERE id = ?`).get(commentId) as
    | { id: number; user_id: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Comment not found.' });
    return;
  }
  if (existing.user_id !== req.currentUser!.id && req.currentUser!.role !== 'admin') {
    res.status(403).json({ error: 'You do not have permission to delete this comment.' });
    return;
  }
  db.prepare(`DELETE FROM comments WHERE id = ?`).run(commentId);
  res.json({ ok: true });
});

app.post('/api/comments/:id/report', requireAuth, writeLimiter, (req, res) => {
  const commentId = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (reason.length < 3) {
    res.status(400).json({ error: 'Please specify a brief reason for reporting.' });
    return;
  }

  const comment = db.prepare(`SELECT id, user_id FROM comments WHERE id = ?`).get(commentId) as
    | { id: number; user_id: number }
    | undefined;
  if (!comment) {
    res.status(404).json({ error: 'Comment not found.' });
    return;
  }
  if (comment.user_id === req.currentUser!.id) {
    res.status(400).json({ error: 'You cannot report your own comment.' });
    return;
  }

  const info = db
    .prepare(`INSERT OR IGNORE INTO comment_reports (comment_id, reporter_id, reason) VALUES (?, ?, ?)`)
    .run(commentId, req.currentUser!.id, reason);

  if (info.changes === 0) {
    res.status(409).json({ error: 'You have already reported this comment.' });
    return;
  }

  // Notify admins of new moderation report
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as Array<{ id: number }>;
  const insertNotif = db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, comment_id, message) VALUES (?, ?, 'moderation', ?, ?)`
  );
  for (const a of admins) {
    insertNotif.run(a.id, req.currentUser!.id, commentId, `Comment reported by @${req.currentUser!.username}: "${reason}"`);
  }

  res.status(201).json({ ok: true });
});

// ---------------- NOTIFICATIONS ROUTES ----------------

app.get('/api/notifications', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, a.username AS actor_username, a.display_name AS actor_display_name,
        a.avatar_url AS actor_avatar_url, a.bio AS actor_bio, a.role AS actor_role, a.created_at AS actor_created_at,
        p.title AS post_title
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       LEFT JOIN posts p ON p.id = n.post_id
       WHERE n.user_id = ?
       ORDER BY datetime(n.created_at) DESC, n.id DESC
       LIMIT 50`
    )
    .all(req.currentUser!.id) as any[];

  const unreadRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0`)
    .get(req.currentUser!.id) as { cnt: number };

  res.json({
    unreadCount: unreadRow.cnt,
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      postId: r.post_id,
      commentId: r.comment_id,
      postTitle: r.post_title,
      message: r.message,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
      actor: r.actor_id
        ? {
            id: r.actor_id,
            username: r.actor_username,
            displayName: r.actor_display_name,
            avatarUrl: r.actor_avatar_url,
            bio: r.actor_bio,
            role: r.actor_role,
            createdAt: r.actor_created_at,
          }
        : null,
    })),
  });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  const id = req.body?.id ? Number(req.body.id) : null;
  if (id) {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(id, req.currentUser!.id);
  } else {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.currentUser!.id);
  }
  res.json({ ok: true });
});

// ---------------- ADMIN DASHBOARD & MODERATION ROUTES ----------------

app.get('/api/admin/analytics', requireAuth, requireAdmin, (_req, res) => {
  const totals = {
    totalPosts: (db.prepare(`SELECT COUNT(*) AS c FROM posts`).get() as { c: number }).c,
    totalUsers: (db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role != 'system'`).get() as { c: number }).c,
    totalLikes: (db.prepare(`SELECT COUNT(*) AS c FROM post_likes`).get() as { c: number }).c,
    totalGoing: (db.prepare(`SELECT COUNT(*) AS c FROM post_rsvps WHERE status = 'going'`).get() as { c: number }).c,
    totalInterested: (db.prepare(`SELECT COUNT(*) AS c FROM post_rsvps WHERE status = 'interested'`).get() as { c: number }).c,
    totalComments: (db.prepare(`SELECT COUNT(*) AS c FROM comments WHERE is_hidden = 0`).get() as { c: number }).c,
    pendingReports: (db.prepare(`SELECT COUNT(*) AS c FROM comment_reports WHERE status = 'pending'`).get() as { c: number }).c,
  };

  const posts = db
    .prepare(
      `SELECT p.id, p.title, p.post_type AS postType, p.is_pinned AS isPinned, p.event_date AS eventDate, p.created_at AS createdAt,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likesCount,
        (SELECT COUNT(*) FROM post_rsvps r WHERE r.post_id = p.id AND r.status = 'going') AS goingCount,
        (SELECT COUNT(*) FROM post_rsvps r WHERE r.post_id = p.id AND r.status = 'interested') AS interestedCount,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_hidden = 0) AS commentsCount
       FROM posts p
       ORDER BY p.is_pinned DESC, datetime(p.created_at) DESC`
    )
    .all() as any[];

  res.json({
    ...totals,
    posts: posts.map((p) => ({ ...p, isPinned: Boolean(p.isPinned) })),
  });
});

app.get('/api/admin/reports', requireAuth, requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.comment_id, r.reason, r.status, r.created_at,
        c.content AS comment_content, c.is_hidden AS comment_is_hidden, c.post_id,
        p.title AS post_title,
        ca.id AS ca_id, ca.username AS ca_username, ca.display_name AS ca_display_name, ca.avatar_url AS ca_avatar_url, ca.bio AS ca_bio, ca.role AS ca_role, ca.created_at AS ca_created_at,
        rep.id AS rep_id, rep.username AS rep_username, rep.display_name AS rep_display_name, rep.avatar_url AS rep_avatar_url, rep.bio AS rep_bio, rep.role AS rep_role, rep.created_at AS rep_created_at
       FROM comment_reports r
       JOIN comments c ON c.id = r.comment_id
       JOIN posts p ON p.id = c.post_id
       JOIN users ca ON ca.id = c.user_id
       JOIN users rep ON rep.id = r.reporter_id
       ORDER BY (r.status = 'pending') DESC, datetime(r.created_at) DESC`
    )
    .all() as any[];

  res.json({
    reports: rows.map((row) => ({
      id: row.id,
      commentId: row.comment_id,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
      commentContent: row.comment_content,
      commentIsHidden: Boolean(row.comment_is_hidden),
      postId: row.post_id,
      postTitle: row.post_title,
      commentAuthor: {
        id: row.ca_id,
        username: row.ca_username,
        displayName: row.ca_display_name,
        avatarUrl: row.ca_avatar_url,
        bio: row.ca_bio,
        role: row.ca_role,
        createdAt: row.ca_created_at,
      },
      reporter: {
        id: row.rep_id,
        username: row.rep_username,
        displayName: row.rep_display_name,
        avatarUrl: row.rep_avatar_url,
        bio: row.rep_bio,
        role: row.rep_role,
        createdAt: row.rep_created_at,
      },
    })),
  });
});

app.post('/api/admin/reports/:id/resolve', requireAuth, requireAdmin, (req, res) => {
  const reportId = Number(req.params.id);
  const action = req.body?.action;
  if (!['dismiss', 'hide_comment', 'delete_comment'].includes(action)) {
    res.status(400).json({ error: 'Invalid moderation action.' });
    return;
  }

  const report = db.prepare(`SELECT id, comment_id FROM comment_reports WHERE id = ?`).get(reportId) as
    | { id: number; comment_id: number }
    | undefined;
  if (!report) {
    res.status(404).json({ error: 'Report not found.' });
    return;
  }

  const tx = db.transaction(() => {
    if (action === 'dismiss') {
      db.prepare(`UPDATE comment_reports SET status = 'dismissed' WHERE id = ?`).run(reportId);
    } else if (action === 'hide_comment') {
      db.prepare(`UPDATE comments SET is_hidden = 1 WHERE id = ?`).run(report.comment_id);
      db.prepare(`UPDATE comment_reports SET status = 'actioned' WHERE comment_id = ?`).run(report.comment_id);
    } else if (action === 'delete_comment') {
      db.prepare(`DELETE FROM comments WHERE id = ?`).run(report.comment_id);
    }
  });
  tx();

  res.json({ ok: true });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, username, email, display_name, role, avatar_url, bio, created_at,
        (SELECT COUNT(*) FROM post_rsvps r WHERE r.user_id = users.id AND r.status = 'going') AS going_count,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = users.id AND c.is_hidden = 0) AS comments_count
       FROM users WHERE role != 'system'
       ORDER BY (role = 'admin') DESC, datetime(created_at) DESC`
    )
    .all() as any[];

  res.json({
    users: rows.map((r) => ({
      ...toPublicUser(r),
      email: r.email,
    })),
  });
});

app.post('/api/admin/users/:id/reset-token', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const target = db.prepare(`SELECT id, username FROM users WHERE id = ? AND role != 'system'`).get(userId) as
    | { id: number; username: string }
    | undefined;
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  const code = `RST-${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`).run(
    target.id,
    sha256(code),
    expiresAt
  );

  res.json({ code, expiresInMinutes: 15, username: target.username });
});

// ---------------- LOCATION GEOCODING & STATIC MAP TILE CACHE ----------------

async function lookupNominatim(query: string): Promise<{ found: boolean; lat: number | null; lon: number | null; displayName: string | null }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'SendsClub/1.0 (https://sendsclub.vip)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    return { found: false, lat: null, lon: null, displayName: null };
  }
  const items = (await resp.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const first = items?.[0];
  if (!first?.lat || !first?.lon) {
    return { found: false, lat: null, lon: null, displayName: null };
  }
  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { found: false, lat: null, lon: null, displayName: null };
  }
  return {
    found: true,
    lat,
    lon,
    displayName: first.display_name || query,
  };
}

app.get('/api/geocode', async (req, res) => {
  const rawQuery = String(req.query.q || '').trim().slice(0, 160);
  if (rawQuery.length < 2) {
    res.status(400).json({ error: 'Location query is too short.' });
    return;
  }

  const cacheKey = rawQuery.toLowerCase();
  const cached = db
    .prepare(`SELECT found, lat, lon, display_name FROM geocode_cache WHERE query_key = ?`)
    .get(cacheKey) as { found: number; lat: number | null; lon: number | null; display_name: string | null } | undefined;

  if (cached) {
    res.json({
      found: Boolean(cached.found),
      lat: cached.lat,
      lon: cached.lon,
      displayName: cached.display_name,
    });
    return;
  }

  try {
    let result = await lookupNominatim(rawQuery);
    // Fallback for "Venue Name, Neighborhood" strings
    if (!result.found && rawQuery.includes(',')) {
      const fallbackQuery = rawQuery.split(',').slice(1).join(',').trim();
      if (fallbackQuery.length >= 2) {
        result = await lookupNominatim(fallbackQuery);
      }
    }

    db.prepare(
      `INSERT OR REPLACE INTO geocode_cache (query_key, found, lat, lon, display_name, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(cacheKey, result.found ? 1 : 0, result.lat, result.lon, result.displayName);

    res.json(result);
  } catch {
    res.json({ found: false, lat: null, lon: null, displayName: null });
  }
});

app.get('/api/map-tile/:z/:x/:y', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);

  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 10 || z > 17) {
    res.status(400).end();
    return;
  }
  const maxCoord = Math.pow(2, z);
  if (x < 0 || x >= maxCoord || y < 0 || y >= maxCoord) {
    res.status(400).end();
    return;
  }

  const cacheFile = path.resolve(TILE_CACHE_DIR, `dark_${z}_${x}_${y}.png`);
  if (!cacheFile.startsWith(TILE_CACHE_DIR + path.sep)) {
    res.status(400).end();
    return;
  }

  if (fs.existsSync(cacheFile)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(cacheFile);
    return;
  }

  try {
    const tileUrl = `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
    const upstream = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'SendsClub/1.0 (https://sendsclub.vip)',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) {
      res.status(502).end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    fs.writeFile(cacheFile, buf, () => {});
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

// ---------------- SERVER STARTUP (DEV VITE OR PROD DIST) ----------------

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/uploads/') ||
        req.path.startsWith('/assets/') ||
        req.path.startsWith('/src/assets/')
      ) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SendsClub server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
