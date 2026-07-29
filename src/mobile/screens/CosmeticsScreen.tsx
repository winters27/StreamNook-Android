// Cosmetics equip: your StreamNook badge and Atmosphere, same server writes
// the desktop editor uses (setActiveCosmetic / setProfileTheme). Rendering
// reuses the shared catalog + asset resolution, so what you equip here paints
// identically in chat and on your profile everywhere.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Lock } from 'phosphor-react';
import { useAppStore } from '../../stores/AppStore';
import { useMobileNavStore } from '../navStore';
import {
  getAccolades,
  getActiveCosmeticSlug,
  getAllCosmetics,
  getOwnedCosmeticSlugs,
  getProfilePrefs,
  setActiveCosmetic,
  setProfileTheme,
} from '../../services/supabaseService';
import { listAtmospheres, type Atmosphere } from '../../services/atmospheres';
import { isCologneTheme } from '../../services/cologneEvent';
import { isSubscriber } from '../../services/subscriberService';
import { resolveCosmeticAsset } from '../../components/cosmeticAssets';
import { Logger } from '../../utils/logger';

export const CosmeticsScreen: React.FC = () => {
  const open = useMobileNavStore((s) => s.cosmeticsOpen);
  const setCosmeticsOpen = useMobileNavStore((s) => s.setCosmeticsOpen);
  const currentUser = useAppStore((s) => s.currentUser);
  const addToast = useAppStore((s) => s.addToast);

  const userId = currentUser?.user_id ?? '';
  const [ownedSlugs, setOwnedSlugs] = useState<Set<string>>(new Set());
  const [activeBadge, setActiveBadge] = useState<string | null>(null);
  const [profileTheme, setProfileThemeState] = useState<string>('tier');
  const [subscribed, setSubscribed] = useState(false);
  const [earnedAccolades, setEarnedAccolades] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!userId) return;
    // Gather everything first, then commit state once after the awaits, so no
    // setState lands synchronously inside the calling effect.
    const owned = getOwnedCosmeticSlugs(userId);
    const active = getActiveCosmeticSlug(userId);
    let theme = 'tier';
    try {
      theme = (await getProfilePrefs(userId)).profileTheme || 'tier';
    } catch (err) {
      Logger.warn('[Cosmetics] prefs read failed:', err);
    }
    let sub = false;
    try {
      sub = await isSubscriber(userId);
    } catch {
      sub = false;
    }
    // Accolade-gated atmospheres unlock off user_accolades, NOT owned cosmetic
    // slugs, and stay hidden until earned (the unlock is meant to be a
    // surprise). Same rule the desktop cosmetics panel uses.
    let accolades = new Set<string>();
    try {
      accolades = new Set(await getAccolades(userId));
    } catch {
      /* leave empty; accolade atmospheres simply stay hidden */
    }
    setOwnedSlugs(owned);
    setActiveBadge(active);
    setProfileThemeState(theme);
    setSubscribed(sub);
    setEarnedAccolades(accolades);
  }, [userId]);

  useEffect(() => {
    // Load-on-open sync from external stores (Supabase registries + prefs).
    // The state commits happen after real awaits; the rule can't see that
    // through the useCallback boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const badges = getAllCosmetics().filter(
    (c) => (c.kind ?? 'badge') === 'badge' && ownedSlugs.has(c.slug),
  );
  const atmospheres = listAtmospheres();

  const equipBadge = async (slug: string) => {
    const next = activeBadge === slug ? null : slug;
    const prev = activeBadge;
    setActiveBadge(next);
    const res = await setActiveCosmetic(userId, next);
    if (!res.ok) {
      setActiveBadge(prev);
      addToast(res.error || 'Could not equip that badge.', 'error');
    }
  };

  // Mirrors the desktop rule: accolade atmospheres unlock for ANY member who
  // earned the accolade (no subscription); subscriber atmospheres are owned
  // per-item, so lapsing keeps everything already unlocked.
  const atmosphereAllowed = (atm: Atmosphere): boolean =>
    atm.unlock?.kind === 'accolade'
      ? earnedAccolades.has(atm.unlock.accoladeId)
      : ownedSlugs.has(atm.id) || subscribed;

  // Accolade-gated atmospheres stay hidden until earned, and Cologne renders
  // through its own event chrome rather than as a plain swatch.
  const visibleAtmospheres = atmospheres.filter(
    (a) =>
      !isCologneTheme(a.id) &&
      (a.unlock?.kind !== 'accolade' || earnedAccolades.has(a.unlock.accoladeId)),
  );

  const equipTheme = async (theme: string) => {
    const prev = profileTheme;
    setProfileThemeState(theme);
    try {
      await setProfileTheme(userId, theme);
    } catch (err) {
      Logger.error('[Cosmetics] theme write failed:', err);
      setProfileThemeState(prev);
      addToast('Could not apply that atmosphere.', 'error');
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 bg-background flex flex-col"
      style={{ paddingTop: 'var(--sn-safe-t, 0px)' }}
    >
      <div className="flex items-center gap-1 px-2 py-2 shrink-0 border-b border-borderSubtle">
        <button
          onClick={() => setCosmeticsOpen(false)}
          className="sn-touch flex items-center justify-center text-textSecondary"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold text-textPrimary">Cosmetics</h1>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
        style={{ paddingBottom: 'calc(var(--sn-safe-b, 0px) + 16px)' }}
      >
        <div className="text-[12px] font-semibold text-textMuted uppercase tracking-wide mb-1.5">
          Badge
        </div>
        {badges.length === 0 ? (
          <div className="glass-panel p-4 text-[13px] text-textMuted mb-4">
            No badges owned yet. Earned and event badges land here.
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 mb-4">
            {badges.map((badge) => {
              const asset = resolveCosmeticAsset(badge);
              const isActive = activeBadge === badge.slug;
              return (
                <button
                  key={badge.slug}
                  onClick={() => void equipBadge(badge.slug)}
                  className={`relative glass-panel p-2 flex flex-col items-center gap-1.5 active:opacity-80 ${
                    isActive ? 'ring-2 ring-accent' : ''
                  }`}
                >
                  {asset ? (
                    <img src={asset} alt="" className="w-9 h-9 object-contain" draggable={false} />
                  ) : (
                    <div className="w-9 h-9 rounded bg-surface" />
                  )}
                  <span className="text-[10.5px] text-textSecondary text-center line-clamp-2 leading-tight">
                    {badge.name}
                  </span>
                  {isActive && (
                    <span className="absolute top-1 right-1 text-accent">
                      <Check size={13} weight="bold" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="text-[12px] font-semibold text-textMuted uppercase tracking-wide mb-1.5">
          Atmosphere
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void equipTheme('tier')}
            className={`glass-panel p-2.5 text-left active:opacity-80 ${
              profileTheme === 'tier' ? 'ring-2 ring-accent' : ''
            }`}
          >
            <div className="w-full h-12 rounded bg-surface mb-1.5" />
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-textPrimary">Default</span>
              {profileTheme === 'tier' && <Check size={13} weight="bold" className="text-accent" />}
            </div>
          </button>
          {visibleAtmospheres.map((atm) => {
            const allowed = atmosphereAllowed(atm);
            const isActive = profileTheme === atm.id || profileTheme.startsWith(`${atm.id}+`);
            return (
              <button
                key={atm.id}
                onClick={() => allowed && void equipTheme(atm.id)}
                disabled={!allowed}
                className={`glass-panel p-2.5 text-left active:opacity-80 disabled:opacity-45 ${
                  isActive ? 'ring-2 ring-accent' : ''
                }`}
              >
                <div className="w-full h-12 rounded mb-1.5" style={{ background: atm.swatch }} />
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] text-textPrimary truncate">{atm.name}</span>
                  {isActive ? (
                    <Check size={13} weight="bold" className="text-accent shrink-0" />
                  ) : !allowed ? (
                    <Lock size={12} className="text-textMuted shrink-0" />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
