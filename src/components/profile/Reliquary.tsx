// The Reliquary: the full collection of a member's earned Relics, shown in a
// modal opened from the profile's Relic strip. Each relic shows its art, name,
// and source. Portaled to the body so it layers above the profile overlay.

import { createPortal } from 'react-dom';
import { resolveCosmeticAsset } from '../cosmeticAssets';
import type { CosmeticCatalogEntry } from '../../services/supabaseService';

export function Reliquary({
  relics,
  onClose,
}: {
  relics: CosmeticCatalogEntry[];
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="glass-panel max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-textPrimary">Reliquary</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-textSecondary transition-colors hover:text-textPrimary"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {relics.map((relic) => {
            const asset = resolveCosmeticAsset(relic);
            return (
              <div key={relic.slug} className="flex items-center gap-3">
                {asset && (
                  <img
                    src={asset}
                    alt={relic.name}
                    draggable={false}
                    className="h-16 w-16 shrink-0 rounded-lg object-contain"
                  />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-textPrimary">{relic.name}</div>
                  {relic.description && (
                    <div className="text-xs text-textSecondary">{relic.description}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
