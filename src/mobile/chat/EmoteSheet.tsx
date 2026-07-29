// Channel emote picker as a bottom sheet: provider chips up top jump to their
// section, and each section header sticks while you scroll through it.
// CDN URLs render directly (the local disk cache is a desktop optimization).
import React, { useRef } from 'react';
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
}> = ({ open, onClose, emotes, onPick }) => {
  const sectionRefs = useRef<Partial<Record<string, HTMLDivElement | null>>>({});

  const populated = SECTIONS.filter(
    ({ key }) => ((emotes?.[key] ?? []) as Emote[]).length > 0,
  );

  return (
    <MobileSheet open={open} onClose={onClose} title="Emotes" maxHeightFraction={0.65}>
      {!emotes ? (
        <div className="py-6 text-center text-sm text-textMuted">Loading emotes…</div>
      ) : populated.length === 0 ? (
        <div className="py-6 text-center text-sm text-textMuted">No emotes for this channel.</div>
      ) : (
        <>
          {/* Provider jump chips, sticky above everything. */}
          <div className="sticky top-0 z-20 -mx-4 px-4 pb-2 bg-background/90"
            style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
            <div className="flex gap-1">
              {populated.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() =>
                    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  className="px-3 py-1.5 rounded-full text-[13px] text-textSecondary glass-button-static active:opacity-70"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {populated.map(({ key, label }) => {
            const list = (emotes[key] ?? []) as Emote[];
            return (
              <div
                key={key}
                ref={(el) => {
                  sectionRefs.current[key] = el;
                }}
                className="mb-3 scroll-mt-12"
              >
                <div className="sticky top-11 z-10 -mx-1 px-1 py-1 text-[12px] font-semibold text-textMuted uppercase tracking-wide bg-background/85"
                  style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
                >
                  {label}
                  <span className="ml-1.5 font-normal normal-case text-textMuted/70">
                    {list.length}
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1 mt-1">
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
          })}
        </>
      )}
    </MobileSheet>
  );
};
