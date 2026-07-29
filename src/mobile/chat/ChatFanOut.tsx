// Hold-and-drag fan-out for a chat message.
//
// Interaction: long-press a message to arm (haptic thump), keep holding and drag
// to a bucket, release to commit. Releasing away from every bucket cancels.
//
// Two properties are load-bearing and both come from the desktop drag layer,
// which was already better suited to touch than to a mouse:
//
//  - MAGNETIC selection. The nearest bucket within an engage radius wins, rather
//    than requiring the finger to be inside a tile. Nobody is pixel-accurate
//    with a thumb.
//  - CONTINUOUS timeout. Once Timeout is engaged, dragging further out dials the
//    duration on the shared ramp (utils/timeoutRamp), so one gesture covers 5
//    seconds through 14 days with no fixed chip list to run off-screen.
//
// Layout follows one rule: DISTANCE IS SEVERITY. Everyday actions sit on a near
// arc, heavier ones on a far arc, so Ban takes a deliberate longer reach than
// Delete. That is deliberately how the destructive actions are protected,
// instead of a confirmation dialog nobody reads.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  ArrowBendUpLeft,
  Copy,
  Prohibit,
  PushPin,
  Timer,
  TrashSimple,
  UserCircle,
} from 'phosphor-react';
import {
  durationTier,
  formatDuration,
  timeoutSecsFromDistance,
} from '../../utils/timeoutRamp';
import {
  hapticCommit,
  hapticDestructive,
  hapticStep,
  hapticTick,
} from '../ui/haptics';

export type FanAction = 'reply' | 'copy' | 'profile' | 'delete' | 'timeout' | 'ban' | 'pin';

export interface FanTarget {
  messageId: string;
  username: string;
  userId: string;
  content: string;
  /** Anchor point: where the finger went down. */
  originX: number;
  originY: number;
}

interface Bucket {
  id: FanAction;
  label: string;
  Icon: typeof Copy;
  /** 0 = near arc, 1 = far arc. */
  ring: 0 | 1;
  destructive?: boolean;
}

// Near arc = what you reach for constantly. Far arc = heavier, longer reach.
const EVERYONE: Bucket[] = [
  { id: 'reply', label: 'Reply', Icon: ArrowBendUpLeft, ring: 0 },
  { id: 'profile', label: 'Profile', Icon: UserCircle, ring: 0 },
  { id: 'copy', label: 'Copy', Icon: Copy, ring: 1 },
];

const MOD_ONLY: Bucket[] = [
  { id: 'delete', label: 'Delete', Icon: TrashSimple, ring: 0, destructive: true },
  { id: 'timeout', label: 'Timeout', Icon: Timer, ring: 1, destructive: true },
  { id: 'ban', label: 'Ban', Icon: Prohibit, ring: 1, destructive: true },
  { id: 'pin', label: 'Pin', Icon: PushPin, ring: 1 },
];

const TILE = 52;
const NEAR_R = 96;
const FAR_R = 168;
// Generous: a thumb is not precise, and the tiles are far enough apart that a
// wide radius still resolves unambiguously to one of them.
const ENGAGE_R = 58;

interface Props {
  target: FanTarget | null;
  isModerator: boolean;
  /** Pin needs mod powers AND a resolvable message. */
  canPin: boolean;
  onCommit: (action: FanAction, timeoutSecs?: number) => void;
  onCancel: () => void;
}

export const ChatFanOut: React.FC<Props> = ({
  target,
  isModerator,
  canPin,
  onCommit,
  onCancel,
}) => {
  const buckets = useMemo(() => {
    const list = [...EVERYONE, ...(isModerator ? MOD_ONLY : [])];
    return canPin ? list : list.filter((b) => b.id !== 'pin');
  }, [isModerator, canPin]);

  // Tile centres, fanned across an upward arc from the press point and clamped
  // so nothing lands off-screen.
  const placed = useMemo(() => {
    if (!target) return [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rings: Record<0 | 1, Bucket[]> = {
      0: buckets.filter((b) => b.ring === 0),
      1: buckets.filter((b) => b.ring === 1),
    };
    const out: { bucket: Bucket; x: number; y: number }[] = [];
    ([0, 1] as const).forEach((ring) => {
      const items = rings[ring];
      if (items.length === 0) return;
      const radius = ring === 0 ? NEAR_R : FAR_R;
      // Fan across the upper half, widening as the ring grows.
      const spread = ring === 0 ? 110 : 150;
      const start = -90 - spread / 2;
      const step = items.length === 1 ? 0 : spread / (items.length - 1);
      items.forEach((bucket, i) => {
        const deg = items.length === 1 ? -90 : start + step * i;
        const rad = (deg * Math.PI) / 180;
        const x = Math.min(
          vw - TILE / 2 - 8,
          Math.max(TILE / 2 + 8, target.originX + Math.cos(rad) * radius),
        );
        const y = Math.min(
          vh - TILE / 2 - 8,
          Math.max(TILE / 2 + 8, target.originY + Math.sin(rad) * radius),
        );
        out.push({ bucket, x, y });
      });
    });
    return out;
  }, [target, buckets]);

  const [active, setActive] = useState<FanAction | null>(null);
  const [secs, setSecs] = useState<number | null>(null);
  // Refs mirror the live values so the window-level pointer handlers, which are
  // installed once, always read current state without re-binding every move.
  const activeRef = useRef<FanAction | null>(null);
  const secsRef = useRef<number | null>(null);
  const tierRef = useRef<number | null>(null);

  // `placed` is a dependency rather than a ref: it only changes when the target
  // or the bucket set changes, never during a drag, so re-binding on it costs
  // nothing and avoids touching a ref during render.
  useEffect(() => {
    if (!target) {
      activeRef.current = null;
      secsRef.current = null;
      tierRef.current = null;
      return;
    }

    const onMove = (e: PointerEvent) => {
      const tiles = placed;
      let best: FanAction | null = null;
      let bestD = Infinity;
      for (const t of tiles) {
        const d = Math.hypot(e.clientX - t.x, e.clientY - t.y);
        if (d < bestD) {
          bestD = d;
          best = t.bucket.id;
        }
      }
      if (bestD > ENGAGE_R) best = null;

      // Timeout stays engaged once entered, and dragging FURTHER from its tile
      // dials the duration up. Without the sticky behaviour the duration would
      // reset the moment the finger left the engage radius.
      let duration: number | null = null;
      const tTile = tiles.find((t) => t.bucket.id === 'timeout');
      if (tTile) {
        const out = Math.hypot(e.clientX - tTile.x, e.clientY - tTile.y);
        if (best === 'timeout' || (activeRef.current === 'timeout' && out > ENGAGE_R)) {
          best = 'timeout';
          duration = timeoutSecsFromDistance(Math.max(0, out - ENGAGE_R / 2));
        }
      }

      if (best !== activeRef.current) {
        activeRef.current = best;
        setActive(best);
        if (best) hapticTick();
        tierRef.current = null;
      }
      if (duration !== secsRef.current) {
        secsRef.current = duration;
        setSecs(duration);
        if (duration !== null) {
          const tier = durationTier(duration);
          if (tierRef.current !== null && tier !== tierRef.current) hapticStep();
          tierRef.current = tier;
        }
      }
    };

    const onUp = () => {
      const chosen = activeRef.current;
      const duration = secsRef.current;
      if (!chosen) {
        onCancel();
        return;
      }
      const bucket = [...EVERYONE, ...MOD_ONLY].find((b) => b.id === chosen);
      if (bucket?.destructive) hapticDestructive();
      else hapticCommit();
      onCommit(chosen, chosen === 'timeout' ? (duration ?? 600) : undefined);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [target, placed, onCommit, onCancel]);

  if (!target) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9500] touch-none" style={{ pointerEvents: 'none' }}>
      {/* Dim so the fan reads against a busy chat, and so it is obvious the rest
          of the UI is not what you are interacting with. */}
      <motion.div
        className="absolute inset-0 bg-black/45"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.1 }}
      />

      {/* The message you grabbed, echoed at the press point so there is never
          any doubt about who the action lands on. */}
      <motion.div
        className="absolute glass-panel px-2.5 py-1.5 max-w-[70vw] rounded-full"
        style={{ left: target.originX, top: target.originY, translateX: '-50%', translateY: '-50%' }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 40 }}
      >
        <span className="text-[12px] font-semibold text-textPrimary">{target.username}</span>
      </motion.div>

      {placed.map(({ bucket, x, y }, i) => {
        const on = active === bucket.id;
        return (
          <motion.div
            key={bucket.id}
            className="absolute flex flex-col items-center justify-center rounded-full border"
            style={{
              left: x,
              top: y,
              width: TILE,
              height: TILE,
              translateX: '-50%',
              translateY: '-50%',
              backgroundColor: on
                ? bucket.destructive
                  ? 'color-mix(in srgb, var(--color-error) 30%, var(--color-background))'
                  : 'color-mix(in srgb, var(--color-accent) 30%, var(--color-background))'
                : 'color-mix(in srgb, var(--color-background) 92%, transparent)',
              borderColor: on
                ? bucket.destructive
                  ? 'var(--color-error)'
                  : 'var(--color-accent)'
                : 'var(--color-border-subtle)',
            }}
            initial={{ opacity: 0, scale: 0.5, left: target.originX, top: target.originY }}
            animate={{ opacity: 1, scale: on ? 1.18 : 1, left: x, top: y }}
            transition={{
              type: 'spring',
              stiffness: 520,
              damping: 34,
              // Stagger outward so the fan reads as opening, not as appearing.
              delay: 0.012 * i,
            }}
          >
            <bucket.Icon
              size={20}
              weight={on ? 'fill' : 'regular'}
              className={
                on
                  ? bucket.destructive
                    ? 'text-error'
                    : 'text-accent'
                  : 'text-textSecondary'
              }
            />
            <span className="text-[8.5px] mt-0.5 text-textMuted leading-none">
              {bucket.id === 'timeout' && secs !== null ? formatDuration(secs) : bucket.label}
            </span>
          </motion.div>
        );
      })}
    </div>,
    document.body,
  );
};
