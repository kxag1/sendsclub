import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';

interface GeocodeResult {
  found: boolean;
  lat: number | null;
  lon: number | null;
  displayName: string | null;
}

interface LocationMapSnippetProps {
  location: string;
  title?: string;
}

const ZOOM = 15;
const TILE_SIZE = 256;

function isDomainOnly(loc: string): boolean {
  const trimmed = loc.trim();
  return /^([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(trimmed);
}

export function LocationMapSnippet({ location }: LocationMapSnippetProps) {
  const [geo, setGeo] = useState<GeocodeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tileErrored, setTileErrored] = useState(false);

  const shouldRender = Boolean(location && location.trim().length > 1 && !isDomainOnly(location));

  useEffect(() => {
    if (!shouldRender) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setTileErrored(false);

    apiFetch<GeocodeResult>(`/api/geocode?q=${encodeURIComponent(location.trim())}`)
      .then((res) => {
        if (!cancelled) setGeo(res);
      })
      .catch(() => {
        if (!cancelled) setGeo({ found: false, lat: null, lon: null, displayName: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [location, shouldRender]);

  const tileLayout = useMemo(() => {
    if (!geo?.found || typeof geo.lat !== 'number' || typeof geo.lon !== 'number') return null;
    if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return null;

    const n = Math.pow(2, ZOOM);
    const xFloat = ((geo.lon + 180) / 360) * n;
    const latRad = (geo.lat * Math.PI) / 180;
    const yFloat =
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

    const centerTileX = Math.floor(xFloat);
    const centerTileY = Math.floor(yFloat);
    const offsetX = (xFloat - centerTileX) * TILE_SIZE;
    const offsetY = (yFloat - centerTileY) * TILE_SIZE;

    // Only render the 3x2 tiles needed for a compact 176px strip (avoids heavy GPU layers on iOS Safari)
    const tiles: Array<{ x: number; y: number | null; key: string }> = [];
    for (let row = -1; row <= 0; row++) {
      for (let col = -1; col <= 1; col++) {
        const tx = ((centerTileX + col) % n + n) % n;
        const ty = centerTileY + row;
        tiles.push({
          x: tx,
          y: ty >= 0 && ty < n ? ty : null,
          key: `${row}_${col}`,
        });
      }
    }

    return {
      offsetX,
      offsetY,
      tiles,
      lat: geo.lat,
      lon: geo.lon,
    };
  }, [geo]);

  if (!shouldRender) return null;

  const externalMapUrl = tileLayout
    ? `https://www.openstreetmap.org/?mlat=${tileLayout.lat}&mlon=${tileLayout.lon}#map=16/${tileLayout.lat}/${tileLayout.lon}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(location)}`;

  const shortDisplayName =
    typeof geo?.displayName === 'string' && geo.displayName
      ? geo.displayName.split(',').slice(0, 3).join(',')
      : location;

  return (
    <div className="relative w-full h-[156px] sm:h-[176px] rounded-xl overflow-hidden border border-white/[0.08] bg-[#070709] select-none">
      {/* Native Dark Map Tiles Layer (no CSS filter needed, iOS Safari safe) */}
      {!loading && tileLayout && !tileErrored ? (
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute left-1/2 top-[44%] grid grid-cols-3 w-[768px] h-[512px]"
            style={{
              transform: `translate(${-TILE_SIZE - tileLayout.offsetX}px, ${-TILE_SIZE - tileLayout.offsetY}px)`,
            }}
          >
            {tileLayout.tiles.map((t) =>
              t.y !== null ? (
                <img
                  key={t.key}
                  src={`/api/map-tile/${ZOOM}/${t.x}/${t.y}`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setTileErrored(true)}
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  className="w-64 h-64 block max-w-none"
                />
              ) : (
                <div key={t.key} className="w-64 h-64 bg-[#0B0C10]" />
              )
            )}
          </div>
        </div>
      ) : (
        /* Architectural Dark Grid Fallback (while loading or if venue is unlisted) */
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[#090A0D] bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,rgba(200,255,0,0.08),transparent_60%)]" />
        </div>
      )}

      {/* Contrast Scrim */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/35 pointer-events-none"
      />

      {/* Center Venue Pin */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center"
      >
        <div className="w-8 h-8 rounded-full bg-[#070709]/95 border-2 border-[#C8FF00] shadow-lg flex items-center justify-center">
          <MapPin className="w-4 h-4 text-[#C8FF00]" />
        </div>
        <div className="w-1.5 h-1.5 rounded-full bg-[#C8FF00]/70 mt-1" />
      </div>

      {/* Bottom Location Bar */}
      <div className="absolute inset-x-0 bottom-0 px-3.5 py-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate">{location}</p>
          <p className="text-[11px] text-zinc-400 truncate">
            {loading ? (
              'Locating venue...'
            ) : tileLayout ? (
              <>
                <span>{shortDisplayName}</span>
                <span className="mx-1.5 text-zinc-600" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-zinc-300">
                  {tileLayout.lat.toFixed(4)}, {tileLayout.lon.toFixed(4)}
                </span>
              </>
            ) : (
              'Venue pin'
            )}
          </p>
        </div>

        <a
          href={externalMapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#111216]/95 hover:bg-[#1C1E26] border border-white/15 text-[11px] font-medium text-zinc-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
        >
          <span>Open Map</span>
          <ExternalLink className="w-3 h-3 text-[#C8FF00]" />
        </a>
      </div>
    </div>
  );
}
