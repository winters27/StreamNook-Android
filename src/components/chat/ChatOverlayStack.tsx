import { type ReactNode } from 'react';

/**
 * Holds the floating chat overlays (poll, prediction) in one positioned column.
 *
 * Twitch lets a poll and a prediction run at the same time, and both overlays
 * used to pin themselves to the identical absolute box, so one silently painted
 * over the other. Stacking them in a flex column fixes that without measuring
 * anything: each card keeps its own collapsed/expanded height and the next one
 * follows underneath.
 *
 * Empty renders to zero height, so it never sits over chat when nothing is live.
 */
interface ChatOverlayStackProps {
  /** Shifts the column down so it clears the hype train bar. */
  isHypeTrainActive?: boolean;
  children: ReactNode;
}

export function ChatOverlayStack({ isHypeTrainActive, children }: ChatOverlayStackProps) {
  return (
    <div
      className={`absolute ${
        isHypeTrainActive ? 'top-16' : 'top-10'
      } left-2 right-2 z-40 flex flex-col gap-2 transition-[top] duration-300 ease-in-out`}
    >
      {children}
    </div>
  );
}

export default ChatOverlayStack;
