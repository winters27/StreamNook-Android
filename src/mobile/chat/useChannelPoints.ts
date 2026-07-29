// Channel points balance + the channel's own points branding.
//
// `get_channel_points_for_channel` runs on the drops token, so this quietly
// yields nothing until the drops account is connected. That is the right
// failure mode: the composer just does not show a points button rather than
// showing a broken one.
//
// The response nests under either `data.community.channel` or
// `data.user.channel` depending on which web client answered, so both are
// accepted — same rule the desktop composer uses.
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Logger } from '../../utils/logger';

export interface ChannelPointsState {
  balance: number | null;
  /** The channel's own name for its points, e.g. "Bones". */
  name: string | null;
  /** The channel's custom points icon; null means render the default glyph. */
  iconUrl: string | null;
  refresh: () => void;
}

interface Loaded {
  /** Which channel this result belongs to; anything else is stale. */
  login: string;
  balance: number | null;
  name: string | null;
  iconUrl: string | null;
}

export function useChannelPoints(channelLogin: string | null | undefined): ChannelPointsState {
  // Stamped with its channel rather than cleared on switch, so changing streams
  // cannot briefly show the previous channel's balance and nothing has to call
  // setState synchronously in the effect to prevent that.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!channelLogin) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<unknown>('get_channel_points_for_channel', { channelLogin });
        if (cancelled) return;
        const data = (result as { data?: Record<string, { channel?: unknown }> })?.data;
        const channel = (data?.community?.channel ?? data?.user?.channel) as
          | { self?: { communityPoints?: { balance?: unknown } }; communityPointsSettings?: { name?: unknown; image?: { url?: unknown } } }
          | undefined;

        const balance = channel?.self?.communityPoints?.balance;
        const settings = channel?.communityPointsSettings;
        setLoaded({
          login: channelLogin,
          balance: typeof balance === 'number' ? balance : null,
          name: typeof settings?.name === 'string' ? settings.name : null,
          iconUrl: typeof settings?.image?.url === 'string' ? settings.image.url : null,
        });
      } catch (err) {
        if (cancelled) return;
        // Not connected, or the channel has points off. Both are normal.
        Logger.debug('[MobilePoints] balance unavailable:', err);
        setLoaded({ login: channelLogin, balance: null, name: null, iconUrl: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelLogin, nonce]);

  const fresh = channelLogin && loaded?.login === channelLogin ? loaded : null;
  return {
    balance: fresh?.balance ?? null,
    name: fresh?.name ?? null,
    iconUrl: fresh?.iconUrl ?? null,
    refresh,
  };
}
