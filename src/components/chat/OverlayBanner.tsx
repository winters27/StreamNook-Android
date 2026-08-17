import { type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * The collapsible card shared by the chat overlays (polls, predictions).
 *
 * Owns the entrance animation and the card/header chrome only. Positioning is
 * deliberately NOT here: the overlays are laid out by ChatOverlayStack, so two
 * of them can be live at once without landing in the same absolute box.
 *
 * Motion preference needs no handling here. MotionScope wraps the app in a
 * framer MotionConfig, so this transition already respects Interface > Motion.
 */
interface OverlayBannerProps {
  /** Glyph for the accent chip at the head of the row. */
  icon: ReactNode;
  /** Headline. Truncates while collapsed, wraps once expanded. */
  title: ReactNode;
  /** Status pills (timer, Locked, Final, points balance), shown before the chevron. */
  badges?: ReactNode;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  /** Body, rendered only while expanded. */
  children?: ReactNode;
}

export function OverlayBanner({
  icon,
  title,
  badges,
  isExpanded,
  onToggleExpanded,
  children,
}: OverlayBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
    >
      <div className="bg-background rounded-lg border border-border shadow-lg shadow-black/30 overflow-hidden">
        <button
          onClick={onToggleExpanded}
          className={`w-full p-3 bg-backgroundSecondary hover:bg-backgroundSecondary/80 transition-colors ${
            isExpanded ? 'border-b border-borderSubtle' : ''
          }`}
        >
          <div className={`flex gap-2 ${isExpanded ? 'items-start' : 'items-center'}`}>
            <div className="p-1.5 bg-accent/30 rounded-md flex-shrink-0">{icon}</div>
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-semibold text-textPrimary text-left leading-tight ${
                  isExpanded ? '' : 'truncate'
                }`}
              >
                {title}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {badges}
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-textSecondary" />
              ) : (
                <ChevronDown className="w-4 h-4 text-textSecondary" />
              )}
            </div>
          </div>
        </button>

        {isExpanded && <div className="bg-background">{children}</div>}
      </div>
    </motion.div>
  );
}

export default OverlayBanner;
