// The member's equipped Frame, rendered as an overlay that borders its
// positioned parent (the profile hero band). Reuses the Cologne nine-slice
// border-image styling (see MajorCologneChrome.css .cologne-frame). Reads the
// equipped frame from the equipment model; renders nothing when none is equipped.
// The frame art is a wide rectangular nine-slice, so it belongs on the hero band,
// not the circular avatar.

import { useEffect, useState } from 'react';
import { getActiveEquipment, getCosmeticBySlug } from '../../services/supabaseService';
import { resolveCosmeticAsset } from '../cosmeticAssets';
import type { ActiveEquipment } from '../../services/cosmetics/types';

export function ProfileFrame({ userId }: { userId: string | null | undefined }) {
  const [equipment, setEquipment] = useState<ActiveEquipment>({});

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getActiveEquipment(userId)
      .then((e) => {
        if (alive) setEquipment(e);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const frameSlug = equipment.frame;
  const cosmetic = frameSlug ? getCosmeticBySlug(frameSlug) : null;
  const frameUrl = cosmetic ? resolveCosmeticAsset(cosmetic) : null;
  if (!frameUrl) return null;

  return (
    <div
      aria-hidden="true"
      // Inset from the edges so the square gothic corners clear the window's
      // rounded corners (the panel is rounded-xl overflow-hidden), instead of
      // being sliced by them.
      className="pointer-events-none absolute inset-2 z-[3]"
      style={{
        borderStyle: 'solid',
        borderWidth: '18px 14px',
        borderImageSource: `url(${frameUrl})`,
        borderImageSlice: '199 159 199 159',
        borderImageWidth: '18px 14px',
        borderImageRepeat: 'stretch',
      }}
    />
  );
}
