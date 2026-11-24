import { useState } from 'react';
import { Disc3 } from 'lucide-react';

interface AvatarProps {
  src: string | null | undefined;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
};

export function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const safeName = typeof name === 'string' && name.trim() ? name.trim() : 'SendsClub';
  const initials = safeName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'SC';

  const sizeCls = SIZE_CLASSES[size];

  if (!src || errored) {
    return (
      <div
        aria-label={name}
        className={`${sizeCls} rounded-full bg-[#1C1E26] border border-white/10 text-zinc-200 font-display font-semibold flex items-center justify-center shrink-0 select-none ${className}`}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className={`${sizeCls} rounded-full object-cover border border-white/10 shrink-0 bg-[#171920] ${className}`}
    />
  );
}

interface FlyerMediaProps {
  src: string;
  alt: string;
  title: string;
  className?: string;
  onClick?: () => void;
}

export function FlyerMedia({ src, alt, title, className = '', onClick }: FlyerMediaProps) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        onClick={onClick}
        className={`w-full h-full min-h-[260px] bg-gradient-to-br from-[#171920] via-[#101116] to-[#070709] flex flex-col items-center justify-center p-6 text-center border border-white/[0.06] ${className}`}
      >
        <Disc3 className="w-8 h-8 text-zinc-500 mb-3" />
        <p className="font-display font-semibold text-zinc-200 text-base">{title}</p>
        <p className="text-xs text-zinc-500 mt-1">SendsClub Event Flyer</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      onClick={onClick}
      className={className}
    />
  );
}
