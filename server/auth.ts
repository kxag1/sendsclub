import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import db from './db.ts';

const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SESSION_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) {
    return false;
  }
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface SessionPayload {
  uid: number;
  exp: number;
  v: number;
}

export function signSessionToken(userId: number, tokenVersion = 1): string {
  const payload: SessionPayload = {
    uid: userId,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    v: tokenVersion,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', getSessionSecret())
      .update(encoded)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!decoded || typeof decoded.uid !== 'number' || typeof decoded.exp !== 'number') {
      return null;
    }
    if (Date.now() > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  for (const part of cookies) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const proto = req.headers['x-forwarded-proto'];
  const isHttps = req.secure || (typeof proto === 'string' && proto.split(',')[0].trim() === 'https');
  const attrs = [
    `sc_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const proto = req.headers['x-forwarded-proto'];
  const isHttps = req.secure || (typeof proto === 'string' && proto.split(',')[0].trim() === 'https');
  const attrs = ['sc_session=', 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export interface DbAuthUser {
  id: number;
  username: string;
  email: string;
  display_name: string;
  role: 'user' | 'admin' | 'system';
  avatar_url: string | null;
  bio: string;
  token_version: number;
  recovery_hash: string | null;
  created_at: string;
}

declare global {
  namespace Express {
    interface Request {
      currentUser?: DbAuthUser;
    }
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    token = parseCookieHeader(req.headers.cookie, 'sc_session');
  }

  if (!token) {
    return next();
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return next();
  }

  const user = db
    .prepare(
      `SELECT id, username, email, display_name, role, avatar_url, bio, token_version, recovery_hash, created_at
       FROM users WHERE id = ?`
    )
    .get(payload.uid) as DbAuthUser | undefined;

  if (user && user.role !== 'system' && user.token_version === payload.v) {
    req.currentUser = user;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
    return;
  }
  // CSRF guard for cookie-authenticated mutations when no Bearer header is present
  const method = req.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !req.headers.authorization) {
    const requestedWith = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
    let originValid = false;
    if (origin && host) {
      try {
        originValid = new URL(origin).host === host.split(',')[0].trim();
      } catch {
        originValid = false;
      }
    }
    if (requestedWith !== 'SendsClub' && !originValid) {
      res.status(403).json({ error: 'Invalid request origin.' });
      return;
    }
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    res.status(401).json({ error: 'Administrator sign-in required.' });
    return;
  }
  if (req.currentUser.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: administrator privileges required.' });
    return;
  }
  next();
}

// Simple sliding-window rate limiter to protect auth & social endpoints from spam
const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(bucketPrefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const uid = req.currentUser?.id ? `u:${req.currentUser.id}` : `ip:${ip}`;
    const key = `${bucketPrefix}:${uid}`;
    const now = Date.now();
    const entries = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (entries.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please pause briefly and try again.' });
      return;
    }
    entries.push(now);
    rateBuckets.set(key, entries);
    next();
  };
}

export function sanitizeMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/src/assets/')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}
