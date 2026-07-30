// Pinned messages, as a dropdown that opens DOWNWARD.
//
// This replaces a thin line that opened a bottom sheet. A sheet sliding up from
// the bottom of the screen to show something anchored at the TOP of chat is the
// wrong mental model: the content should come out of the thing you tapped.
//
// Collapsed is the desktop's slim bar — pin glyph, sender in their colour,
// truncated text, a +N when several are pinned, and a chevron. Expanding grows
// the same element downward into the full message; nothing moves up from under
// the screen. `sn-popover` carries the shared glass so it matches the desktop
// pin rather than being a second look.
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CaretDown, PushPin } from 'phosphor-react';

export interface PinnedItem {
  id: string;
  message_id: string;
  message_text: string;
  sender_name: string;
  sender_color: string;
}

interface Props {
  pins: PinnedItem[];
  expanded: boolean;
  onToggle: () => void;
}

export const PinnedBanner: React.FC<Props> = ({ pins, expanded, onToggle }) => {
  if (pins.length === 0) return null;
  const first = pins[0];

  return (
    <div className="pointer-events-auto w-full">
      <button
        type="button"
        onClick={onToggle}
        className="sn-popover w-full flex items-center gap-2 px-2.5 py-1.5 text-left active:opacity-80"
      >
        <PushPin size={12} weight="fill" className="text-accent shrink-0" />
        <span
          className="text-[12px] font-bold shrink-0 max-w-[35%] truncate"
          style={{ color: first.sender_color || undefined, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
        >
          {first.sender_name}
        </span>
        {/* The preview only reads while collapsed; once open the full text is
            right below it and repeating it twice looks like a bug. */}
        {!expanded && (
          <span className="text-[12px] text-textPrimary/85 truncate min-w-0 flex-1">
            {first.message_text}
          </span>
        )}
        {expanded && <span className="flex-1" />}
        {pins.length > 1 && (
          <span className="text-[11px] font-semibold text-textSecondary shrink-0 tabular-nums">
            +{pins.length - 1}
          </span>
        )}
        <motion.span
          className="shrink-0 text-textSecondary"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <CaretDown size={12} weight="bold" />
        </motion.span>
      </button>

      {/* Height animation so the card unrolls out of the bar rather than
          appearing. overflow-hidden is what makes the reveal read as downward. */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="pins"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="sn-popover mt-1 px-2.5 py-2 flex flex-col gap-2">
              {pins.map((pin) => (
                <div key={pin.id} className="text-[13px] leading-relaxed">
                  <span
                    className="font-bold"
                    style={{
                      color: pin.sender_color || undefined,
                      textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    }}
                  >
                    {pin.sender_name}
                  </span>
                  <span className="text-textPrimary">: {pin.message_text}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
