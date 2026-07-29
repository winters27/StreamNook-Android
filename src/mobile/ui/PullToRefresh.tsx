// Pull-to-refresh: the standard mobile refresh idiom. Wraps a scrollable
// container; dragging down from the very top reveals a glass indicator that
// arms past a threshold and runs onRefresh on release. Dependency-free
// (pointer events), styled on the design system: inset-bevel disc, no glow.
import React, { useCallback, useRef, useState } from 'react';
import { ArrowClockwise } from 'phosphor-react';

const ARM_THRESHOLD_PX = 72;
const MAX_PULL_PX = 120;

export const PullToRefresh: React.FC<{
  onRefresh: () => Promise<unknown>;
  className?: string;
  children: React.ReactNode;
}> = ({ onRefresh, className, children }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (refreshing) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.clientY;
    pulling.current = false;
  }, [refreshing]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startY.current === null || refreshing) return;
    const el = scrollRef.current;
    if (!el) return;
    const dy = e.clientY - startY.current;
    // Only hijack the gesture while the list is at its top and moving down.
    if (el.scrollTop > 0 && !pulling.current) {
      startY.current = null;
      return;
    }
    if (dy <= 0 && !pulling.current) return;
    pulling.current = true;
    setDragging(true);
    // Rubber-band: diminishing returns past the threshold.
    setPull(Math.min(MAX_PULL_PX, dy * 0.5));
  }, [refreshing]);

  const finish = useCallback(() => {
    if (startY.current === null) return;
    startY.current = null;
    pulling.current = false;
    setDragging(false);
    setPull((current) => {
      if (current >= ARM_THRESHOLD_PX * 0.5 && !refreshing) {
        setRefreshing(true);
        void Promise.resolve(onRefresh()).finally(() => {
          setRefreshing(false);
          setPull(0);
        });
        return ARM_THRESHOLD_PX * 0.5;
      }
      return 0;
    });
  }, [onRefresh, refreshing]);

  const armed = pull >= ARM_THRESHOLD_PX * 0.5;
  const indicatorVisible = pull > 4 || refreshing;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {indicatorVisible && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          style={{ top: Math.max(6, pull - 34) }}
        >
          <div className="glass-button-static w-9 h-9 rounded-full flex items-center justify-center">
            <ArrowClockwise
              size={18}
              className={`${refreshing ? 'animate-spin' : ''} ${
                armed || refreshing ? 'text-accent' : 'text-textMuted'
              }`}
              style={
                !refreshing
                  ? { transform: `rotate(${Math.min(360, pull * 4)}deg)` }
                  : undefined
              }
            />
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto ${className ?? ''}`}
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: dragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        {children}
      </div>
    </div>
  );
};
