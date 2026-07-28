// Bottom sheet: the universal mobile replacement for desktop popovers,
// dropdowns, and context menus. Glass design system, drag-to-dismiss, backdrop
// tap, and Android back integration via the navStore sheet stack.
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMobileNavStore } from '../navStore';

export interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Max sheet height as a viewport fraction. Default 0.72. */
  maxHeightFraction?: number;
}

const DISMISS_DISTANCE = 96;

// Inner surface owns the drag state; it unmounts when the sheet closes, so
// drag position resets naturally without any state-sync effect.
const SheetSurface: React.FC<Omit<MobileSheetProps, 'open'>> = ({
  onClose,
  title,
  children,
  maxHeightFraction = 0.72,
}) => {
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStart.current));
  }, []);

  const onPointerUp = useCallback(() => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragY((y) => {
      if (y > DISMISS_DISTANCE) onClose();
      return 0;
    });
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[9000]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50"
        style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />
      <div
        className="absolute inset-x-0 bottom-0 glass-modal rounded-b-none flex flex-col"
        style={{
          maxHeight: `calc(100dvh * ${maxHeightFraction})`,
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
          paddingBottom: 'var(--sn-safe-b, 0px)',
        }}
      >
        <div
          className="flex flex-col items-center pt-2.5 pb-1 shrink-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="w-9 h-1 rounded-full bg-textMuted/40" />
          {title && (
            <div className="mt-2 text-sm font-semibold text-textPrimary">{title}</div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
};

export const MobileSheet: React.FC<MobileSheetProps> = ({ open, onClose, ...rest }) => {
  const sheetId = useId();
  const pushSheet = useMobileNavStore((s) => s.pushSheet);
  const popSheet = useMobileNavStore((s) => s.popSheet);

  // Register in the Android back-button stack while open (external store sync).
  useEffect(() => {
    if (!open) return;
    pushSheet(sheetId);
    const onBackClose = (e: Event) => {
      if ((e as CustomEvent<string>).detail === sheetId) onClose();
    };
    window.addEventListener('sn:close-sheet', onBackClose);
    return () => {
      window.removeEventListener('sn:close-sheet', onBackClose);
      popSheet(sheetId);
    };
  }, [open, sheetId, pushSheet, popSheet, onClose]);

  if (!open) return null;

  return createPortal(<SheetSurface onClose={onClose} {...rest} />, document.body);
};
