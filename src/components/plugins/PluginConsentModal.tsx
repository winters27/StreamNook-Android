import { motion, AnimatePresence } from 'framer-motion';
import { Puzzle } from 'lucide-react';
import { capabilityLines, GrantedCaps, PluginTier } from '../../types/plugins';
import TierBadge from './TierBadge';

// Canonical bevel recipe lives in globals.css as --bevel-tile.
const TILE_BEVEL = 'var(--bevel-tile)';

export interface ConsentSubject {
  name: string;
  author: string;
  version: string;
  tier: PluginTier;
  caps: GrantedCaps;
  /// Source label, shown so the user knows where the add-on comes from.
  sourceName: string;
  /// True for an unreviewed community source (adds a trust note).
  community: boolean;
  /// Verb on the confirm button: "Install" or "Enable".
  action: 'Install' | 'Enable';
}

interface Props {
  subject: ConsentSubject | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Install / enable consent. Calm and capability-focused: it shows who made the
 * add-on, where it comes from, and exactly what it can do, then lets the user
 * confirm. Add-ons run as their own program; the capability list (including the
 * login-access note when relevant) is the contract.
 */
const PluginConsentModal = ({ subject, onConfirm, onCancel }: Props) => {
  const lines = subject ? capabilityLines(subject.caps) : [];
  const fromCommunity = subject?.community ?? false;

  return (
    <AnimatePresence>
      {subject && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="glass-panel relative max-h-[85vh] w-[460px] max-w-[90vw] overflow-y-auto p-6"
          >
            <div className="flex items-start gap-3.5">
              <div
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'rgba(165, 185, 150, 0.16)', boxShadow: TILE_BEVEL }}
              >
                <Puzzle size={20} className="text-textPrimary" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold leading-snug text-textPrimary">
                  {subject.action} {subject.name}?
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-textSecondary">
                  <span>by {subject.author}</span>
                  <span className="text-textMuted">·</span>
                  <span>v{subject.version}</span>
                  <span className="text-textMuted">·</span>
                  <TierBadge tier={subject.tier} />
                </div>
              </div>
            </div>

            <p className="mt-4 text-[13px] leading-relaxed text-textSecondary">
              This add-on runs as its own program alongside StreamNook. It can do
              the following:
            </p>

            <div className="mt-3 rounded-lg bg-white/[0.03] py-1.5">
              {lines.map((line) => (
                <div key={line.text} className="flex items-baseline gap-2 px-3.5 py-1">
                  <span
                    className={`h-1 w-1 flex-shrink-0 translate-y-[-2px] rounded-full ${
                      line.warning ? 'bg-amber-300' : 'bg-textMuted'
                    }`}
                  />
                  <span
                    className={`text-[12.5px] leading-relaxed ${
                      line.warning ? 'text-amber-200' : 'text-textPrimary'
                    }`}
                  >
                    {line.text}
                  </span>
                </div>
              ))}
              {lines.length === 0 && (
                <div className="px-3.5 py-1.5 text-[12.5px] text-textSecondary">
                  This add-on requests nothing from StreamNook.
                </div>
              )}
            </div>

            {fromCommunity && (
              <p className="mt-3 text-[12px] leading-relaxed text-textMuted">
                Community sources aren't reviewed by StreamNook. Install add-ons from
                sources you trust.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="glass-button-secondary px-4 py-2 text-[13px] text-textSecondary hover:text-textPrimary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="glass-button-secondary !bg-accent/15 px-4 py-2 text-[13px] font-medium text-textPrimary hover:!bg-accent/25"
              >
                {subject.action}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PluginConsentModal;
