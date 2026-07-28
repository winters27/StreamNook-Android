// Renders a source platform's real brand mark (Twitch glitch / Kick), bundled as
// colored SVGs. Falls back to a brand-color dot for providers whose logo isn't
// bundled yet. Used on MultiChat tabs, per-column headers, and mod-panel cells.

import { Tooltip } from './ui/Tooltip';
import twitchLogo from '../assets/provider-logos/twitch.svg?url';
import kickLogo from '../assets/provider-logos/kick.svg?url';
import youtubeLogo from '../assets/provider-logos/youtube.svg?url';
import tiktokLogo from '../assets/provider-logos/tiktok.svg?url';
import { PROVIDERS, type ProviderId } from '../types/providers';

const LOGOS: Partial<Record<ProviderId, string>> = {
  twitch: twitchLogo,
  kick: kickLogo,
  youtube: youtubeLogo,
  tiktok: tiktokLogo,
};

/** The bundled brand-logo URL for a provider, or undefined if not bundled. */
export function providerLogo(provider: ProviderId): string | undefined {
  return LOGOS[provider];
}

export function ProviderLogo({
  provider,
  size = 12,
  className = '',
}: {
  provider: ProviderId;
  size?: number;
  className?: string;
}) {
  const meta = PROVIDERS[provider];
  const src = providerLogo(provider);
  if (src) {
    return (
      <Tooltip content={meta.label}>
        <img
          src={src}
          alt={meta.label}
          draggable={false}
          className={`shrink-0 ${className}`}
          style={{ width: size, height: size }}
        />
      </Tooltip>
    );
  }
  // Fallback: brand-color dot for providers without a bundled logo yet.
  return (
    <Tooltip content={meta.label}>
      <span
        className={`shrink-0 rounded-full ${className}`}
        style={{ width: size, height: size, backgroundColor: meta.color }}
      />
    </Tooltip>
  );
}

export default ProviderLogo;
