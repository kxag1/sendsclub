import { useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Lock, ShieldCheck, UserPlus } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api.ts';
import type { AuthUser } from '../types.ts';

export type AuthMode = 'login' | 'register' | 'reset' | 'claim-admin';

interface AuthPanelProps {
  initialMode?: AuthMode;
  adminConfigured: boolean;
  envManaged: boolean;
  onSuccess: (user: AuthUser) => void;
  onCancel?: () => void;
}

export function AuthPanel({
  initialMode = 'login',
  adminConfigured,
  envManaged,
  onSuccess,
  onCancel,
}: AuthPanelProps) {
  const canClaimAdmin = !adminConfigured && !envManaged;
  const [mode, setMode] = useState<AuthMode>(
    initialMode === 'claim-admin' && !canClaimAdmin ? 'login' : initialMode
  );

  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [bio, setBio] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // One-time Recovery Key screen after signup or admin claim
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const res = await apiFetch<{ user: AuthUser; token: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier, password }),
        });
        setAuthToken(res.token);
        onSuccess(res.user);
      } else if (mode === 'register') {
        const res = await apiFetch<{ user: AuthUser; token: string; recoveryKey: string }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, email, displayName, password, bio }),
        });
        setAuthToken(res.token);
        setPendingUser(res.user);
        setRecoveryKey(res.recoveryKey);
      } else if (mode === 'claim-admin') {
        const res = await apiFetch<{ user: AuthUser; token: string; recoveryKey: string }>('/api/auth/admin/claim', {
          method: 'POST',
          body: JSON.stringify({ username, email, displayName, password }),
        });
        setAuthToken(res.token);
        setPendingUser(res.user);
        setRecoveryKey(res.recoveryKey);
      } else if (mode === 'reset') {
        const res = await apiFetch<{ ok: boolean; message: string }>('/api/auth/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ identifier, resetCode, newPassword: password }),
        });
        setInfoMsg(res.message);
        setPassword('');
        setResetCode('');
        setMode('login');
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function copyKey() {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  }

  if (pendingUser && recoveryKey) {
    return (
      <div className="bg-[#111216] border border-white/[0.1] rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C8FF00]/10 border border-[#C8FF00]/30 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-[#C8FF00]" />
          </div>
          <div>
            <h3 className="font-display font-bold text-lg text-white">
              Save Your Account Recovery Key
            </h3>
            <p className="text-sm text-zinc-400 mt-1">
              Welcome to SendsClub, <span className="text-zinc-100 font-medium">{pendingUser.displayName}</span>. Store this one-time key safely — you can use it to reset your password anytime.
            </p>
          </div>
        </div>

        <div className="bg-[#070709] border border-white/10 rounded-xl p-4 flex items-center justify-between gap-3">
          <code className="font-mono text-base sm:text-lg font-medium text-[#C8FF00] tracking-wider select-all">
            {recoveryKey}
          </code>
          <button
            type="button"
            onClick={copyKey}
            className="min-h-[40px] px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-zinc-100 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            {copiedKey ? <Check className="w-4 h-4 text-[#C8FF00]" /> : <Copy className="w-4 h-4" />}
            <span>{copiedKey ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onSuccess(pendingUser)}
          className="w-full min-h-[44px] py-2.5 px-5 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] text-black font-semibold text-sm transition-colors"
        >
          I Saved My Recovery Key — Enter SendsClub
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#111216] border border-white/[0.08] rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-xl text-white">
            {mode === 'login' && 'Sign in to SendsClub'}
            {mode === 'register' && 'Join SendsClub'}
            {mode === 'reset' && 'Reset Password'}
            {mode === 'claim-admin' && 'Initialize Administrator'}
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {mode === 'claim-admin'
              ? 'First-run setup: claim the sole administrator account for sendsclub.vip'
              : 'sendsclub.vip · Member Access'}
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[40px] px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Close
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#070709] border border-white/[0.06] rounded-xl">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setError(null);
          }}
          className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
            mode === 'login' ? 'bg-[#1D1F27] text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register');
            setError(null);
          }}
          className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
            mode === 'register' ? 'bg-[#1D1F27] text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Create Account
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('reset');
            setError(null);
          }}
          className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
            mode === 'reset' ? 'bg-[#1D1F27] text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Reset Password
        </button>
        {canClaimAdmin && (
          <button
            type="button"
            onClick={() => {
              setMode('claim-admin');
              setError(null);
            }}
            className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'claim-admin'
                ? 'bg-[#C8FF00] text-black font-semibold'
                : 'text-[#C8FF00] hover:bg-[#C8FF00]/10'
            }`}
          >
            Claim Admin
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">
          {error}
        </div>
      )}
      {infoMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
          {infoMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {(mode === 'login' || mode === 'reset') && (
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Username or Email
            </label>
            <input
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. nightowl or you@sendsclub.vip"
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
            />
          </div>
        )}

        {(mode === 'register' || mode === 'claim-admin') && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Unique Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="e.g. xavier_sc"
                  minLength={3}
                  maxLength={24}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  minLength={2}
                  maxLength={48}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Short Bio (Optional)
                </label>
                <input
                  type="text"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Vinyl head, late-night regular..."
                  maxLength={240}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
                />
              </div>
            )}
          </>
        )}

        {mode === 'reset' && (
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Recovery Key or Admin Reset Code
            </label>
            <input
              type="text"
              required
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value.toUpperCase())}
              placeholder="SC-XXXX-XXXX-XXXX or RST-XXXXX-XXXXX"
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm font-mono text-white placeholder:text-zinc-600"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Enter your personal Account Recovery Key or a one-time reset code issued by the SendsClub Admin.
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            {mode === 'reset' ? 'New Password (min 8 chars)' : 'Password'}
          </label>
          <input
            type="password"
            required
            minLength={mode === 'login' ? 1 : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#070709] border border-white/[0.1] focus:border-[#C8FF00] focus:outline-none text-sm text-white placeholder:text-zinc-600"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[44px] py-2.5 px-5 rounded-xl bg-[#C8FF00] hover:bg-[#d8ff4d] disabled:opacity-60 text-black font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          {mode === 'login' && <Lock className="w-4 h-4" />}
          {mode === 'register' && <UserPlus className="w-4 h-4" />}
          {mode === 'claim-admin' && <ShieldCheck className="w-4 h-4" />}
          {mode === 'reset' && <KeyRound className="w-4 h-4" />}
          <span>
            {loading
              ? 'Processing...'
              : mode === 'login'
              ? 'Sign In'
              : mode === 'register'
              ? 'Create SendsClub Account'
              : mode === 'claim-admin'
              ? 'Claim Administrator Account'
              : 'Update Password'}
          </span>
        </button>
      </form>
    </div>
  );
}
