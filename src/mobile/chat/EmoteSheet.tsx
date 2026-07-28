// Channel emote picker as a bottom sheet. Provider-sectioned grid over the
// shared per-channel EmoteSet; tapping inserts the emote name into the input.
// CDN URLs render directly (the local disk cache is a desktop optimization).
import React from 'react';
import { MobileSheet } from '../ui/MobileSheet';
import type { Emote, EmoteSet } from '../../services/emoteService';

const SECTIONS: { key: keyof EmoteSet; label: string }[] = [
  { key: 'twitch', label: 'Twitch' },
  { key: '7tv', label: '7TV' },
  { key: 'bttv', label: 'BTTV' },
  { key: 'ffz', label: 'FFZ' },
];

export const EmoteSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  emotes: EmoteSet | null;
  onPick: (name: string) => void;
}> = ({ open, onClose, emotes, onPick }) => (
  <MobileSheet open={open} onClose={onClose} title="Emotes" maxHeightFraction={0.6}>
    {!emotes ? (
      <div className="py-6 text-center text-sm text-textMuted">Loading emotes…</div>
    ) : (
      SECTIONS.map(({ key, label }) => {
        const list = (emotes[key] ?? []) as Emote[];
        if (list.length === 0) return null;
        return (
          <div key={key} className="mb-3">
            <div className="text-[12px] font-semibold text-textMuted uppercase tracking-wide px-1 mb-1.5">
              {label}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {list.map((emote) => (
                <button
                  key={`${emote.provider}-${emote.id}`}
                  onClick={() => onPick(emote.name)}
                  className="flex items-center justify-center h-11 rounded active:bg-surface-active"
                  aria-label={emote.name}
                >
                  <img
                    src={emote.localUrl || emote.url}
                    alt={emote.name}
                    loading="lazy"
                    className="max-h-8 max-w-full object-contain"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          </div>
        );
      })
    )}
  </MobileSheet>
);
