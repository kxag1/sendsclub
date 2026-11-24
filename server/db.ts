import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const TILE_CACHE_DIR = path.join(DATA_DIR, 'tile_cache');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(TILE_CACHE_DIR)) {
  fs.mkdirSync(TILE_CACHE_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'sendsclub.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    recovery_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'system')),
    avatar_url TEXT,
    bio TEXT NOT NULL DEFAULT '',
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_type TEXT NOT NULL DEFAULT 'event' CHECK (post_type IN ('event', 'announcement', 'update')),
    title TEXT NOT NULL,
    caption TEXT NOT NULL,
    event_date TEXT,
    event_time TEXT,
    location TEXT,
    venue_details TEXT,
    dress_code TEXT,
    ticket_note TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS post_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS post_rsvps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('going', 'interested')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_edited INTEGER NOT NULL DEFAULT 0,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comment_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'actioned')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(comment_id, reporter_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('reply', 'like', 'going', 'interested', 'announcement', 'moderation')),
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS geocode_cache (
    query_key TEXT PRIMARY KEY,
    found INTEGER NOT NULL DEFAULT 0,
    lat REAL,
    lon REAL,
    display_name TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_posts_pinned_created ON posts(is_pinned DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
`);

function hashForBootstrap(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function initializeDatabase(): void {
  // If ADMIN_PASSWORD is supplied via server environment (e.g. Replit Secrets),
  // ensure an admin account exists with the hashed env password.
  const envAdminPassword = process.env.ADMIN_PASSWORD?.trim();
  const envAdminEmail = (process.env.ADMIN_EMAIL?.trim() || 'admin@sendsclub.vip').toLowerCase();
  const envAdminUsername = (process.env.ADMIN_USERNAME?.trim() || 'sendsclub').toLowerCase();

  if (envAdminPassword && envAdminPassword.length >= 8) {
    const existingAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get() as { id: number } | undefined;
    const passwordHash = hashForBootstrap(envAdminPassword);
    if (existingAdmin) {
      db.prepare(
        `UPDATE users SET password_hash = ?, email = ?, username = ? WHERE id = ?`
      ).run(passwordHash, envAdminEmail, envAdminUsername, existingAdmin.id);
    } else {
      db.prepare(
        `INSERT INTO users (username, email, display_name, password_hash, role, avatar_url, bio)
         VALUES (?, ?, ?, ?, 'admin', ?, ?)`
      ).run(
        envAdminUsername,
        envAdminEmail,
        'SendsClub',
        passwordHash,
        '/src/assets/images/avatar_admin_xavier_1795497728682.jpg',
        'Official curator & host of SendsClub (sendsclub.vip).'
      );
    }
  }

  // Seed initial curated SendsClub posts only if posts table is completely empty
  const postCountRow = db.prepare(`SELECT COUNT(*) AS count FROM posts`).get() as { count: number };
  if (postCountRow.count === 0) {
    let hostRow = db
      .prepare(`SELECT id FROM users WHERE role IN ('admin', 'system') ORDER BY id ASC LIMIT 1`)
      .get() as { id: number } | undefined;

    if (!hostRow) {
      // Non-loginable editorial system curator (password_hash = NULL);
      // ownership automatically transfers to the first claimed Admin account.
      const res = db
        .prepare(
          `INSERT INTO users (username, email, display_name, password_hash, role, avatar_url, bio)
           VALUES ('sendsclub_host', 'curator@sendsclub.vip', 'SendsClub', NULL, 'system', ?, ?)`
        )
        .run(
          '/src/assets/images/avatar_admin_xavier_1795497728682.jpg',
          'Official SendsClub editorial host — sendsclub.vip'
        );
      hostRow = { id: Number(res.lastInsertRowid) };
    }

    const insertPost = db.prepare(`
      INSERT INTO posts (
        author_id, post_type, title, caption, event_date, event_time,
        location, venue_details, dress_code, ticket_note, is_pinned, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertImage = db.prepare(`
      INSERT INTO post_images (post_id, image_url, sort_order) VALUES (?, ?, ?)
    `);

    const p1 = insertPost.run(
      hostRow.id,
      'event',
      'VOID // 04: Warehouse Afterhours',
      'Four-point custom analog sound system in a raw brick warehouse. Extended back-to-back sets from midnight until sunrise. No flash photography on the floor — phones taped at the door.',
      '2026-12-05',
      '23:30 – 06:00',
      'Brooklyn Navy Yard, Building 77',
      'Exact loading-bay entrance pin sent to confirmed I’M GOING members 3 hours before doors.',
      'Dark minimal / architectural black',
      'Complimentary entry before 00:30 for SendsClub RSVP list · $25 after',
      1,
      '2026-11-23 20:00:00'
    );
    insertImage.run(p1.lastInsertRowid, '/src/assets/images/flyer_afterhours_warehouse_1795497727550.jpg', 0);
    insertImage.run(p1.lastInsertRowid, '/src/assets/images/flyer_sound_system_1795497728416.jpg', 1);

    const p2 = insertPost.run(
      hostRow.id,
      'event',
      'Velvet Skyline: Midnight Rooftop Session',
      'Intimate open-air vinyl and deep house session above the avenue. Warm amber lighting, heated glass terrace, and late-night mezcal bar overlooking the skyline.',
      '2026-11-29',
      '22:00 – 03:30',
      'The Mercer Penthouse, SoHo',
      'Private elevator access via Greene St lobby. Capacity strictly capped at 180 guests.',
      'Evening tailored / dark tones',
      'Member priority access · Tap I’M GOING to lock your spot',
      0,
      '2026-11-22 18:30:00'
    );
    insertImage.run(p2.lastInsertRowid, '/src/assets/images/flyer_rooftop_velvet_1795497728458.jpg', 0);

    const p3 = insertPost.run(
      hostRow.id,
      'announcement',
      'SendsClub Winter Season Membership & House Etiquette',
      'Welcome to the new sendsclub.vip home. Every upcoming warehouse session, rooftop takeover, and listening room night will drop here first. Keep your profile updated, RSVP early for door access, and respect the floor.',
      null,
      null,
      'sendsclub.vip',
      'Official platform dispatch for all verified members.',
      null,
      'Announcements & guestlist drops publish weekly at 20:00.',
      0,
      '2026-11-21 15:00:00'
    );
    insertImage.run(p3.lastInsertRowid, '/src/assets/images/flyer_sound_system_1795497728416.jpg', 0);
  }
}

export default db;
