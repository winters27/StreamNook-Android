// Long-press to arm, then keep dragging in the same gesture.
//
// This cannot be built on the `contextmenu` event that the existing action sheet
// uses. Android does synthesise contextmenu from a hold, but it fires only after
// the hold completes and carries no continuation, so there is no way to keep
// tracking the same finger into a drag. Raw pointer events are the only route.
//
// The hard part is coexisting with chat scrolling. A vertical drag has to stay a
// scroll, so movement before the hold fires CANCELS the press. Once armed, the
// list is locked (touch-action: none) for the rest of the gesture so the browser
// stops trying to scroll underneath the fan.
import { useCallback, useEffect, useRef } from 'react';
import { hapticArm } from '../ui/haptics';

const HOLD_MS = 420;
/** Movement beyond this before the hold fires means the user is scrolling. */
const CANCEL_SLOP_PX = 10;

interface Options {
  /** Resolve the pressed element to a message id, or null to ignore the press. */
  resolve: (el: HTMLElement) => string | null;
  onArm: (messageId: string, x: number, y: number) => void;
  /** Element to lock scrolling on while armed. */
  scrollLockRef: React.RefObject<HTMLElement | null>;
}

export function useLongPressDrag({ resolve, onArm, scrollLockRef }: Options) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; id: string } | null>(null);
  const armed = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const unlock = useCallback(() => {
    const el = scrollLockRef.current;
    if (el) el.style.touchAction = '';
  }, [scrollLockRef]);

  /** Call when the fan closes so a new press can arm again. */
  const release = useCallback(() => {
    armed.current = false;
    start.current = null;
    clearTimer();
    unlock();
  }, [clearTimer, unlock]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary touch/pen. A stray second finger must not re-arm.
      if (!e.isPrimary) return;
      const row = (e.target as HTMLElement).closest('[data-message-id]') as HTMLElement | null;
      if (!row) return;
      const id = resolve(row);
      if (!id) return;
      start.current = { x: e.clientX, y: e.clientY, id };
      armed.current = false;
      clearTimer();
      timer.current = setTimeout(() => {
        const s = start.current;
        if (!s) return;
        armed.current = true;
        const el = scrollLockRef.current;
        if (el) el.style.touchAction = 'none';
        hapticArm();
        onArm(s.id, s.x, s.y);
      }, HOLD_MS);
    },
    [resolve, onArm, clearTimer, scrollLockRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || armed.current) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > CANCEL_SLOP_PX) {
        // Became a scroll. Abandon the press entirely.
        clearTimer();
        start.current = null;
      }
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(() => {
    // If the hold never fired this was a tap or a scroll; the fan owns pointerup
    // once armed, so nothing to do here in that case.
    if (!armed.current) {
      clearTimer();
      start.current = null;
    }
  }, [clearTimer]);

  useEffect(() => release, [release]);

  return { onPointerDown, onPointerMove, onPointerUp, release, isArmed: () => armed.current };
}
