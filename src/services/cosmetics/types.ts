// Shared cosmetic vocabulary. One catalog shape (CosmeticDefinition) that every
// surface can read, mapped from the existing `cosmetics` + `atmospheres`
// catalogs with no schema change. Design: Brain StreamNook_Cosmetic_Architecture.

export type CosmeticType =
  | 'badge'
  | 'atmosphere'
  | 'frame'
  | 'cipher'
  | 'member_plate'
  | 'relic'
  | 'accolade_pin_style';

export type CosmeticSlot =
  | 'badge'
  | 'atmosphere'
  | 'frame'
  | 'cipher'
  | 'member_plate'
  | 'relic_primary'
  | 'accolade_pin';

export type EntitlementRequirement = 'none' | 'supporter' | 'subscriber';
export type OwnershipPolicy = 'permanent' | 'while_entitled';
export type RenderTier = 'none' | 'supporter' | 'subscriber';
export type ReleaseStatus = 'draft' | 'released' | 'retired';
export type CosmeticSource =
  | 'streamnook'
  | 'event'
  | 'achievement'
  | 'subscription'
  | 'twitch'
  | '7tv';

// Every type maps to exactly one equip slot.
export const SLOT_FOR_TYPE: Record<CosmeticType, CosmeticSlot> = {
  badge: 'badge',
  atmosphere: 'atmosphere',
  frame: 'frame',
  cipher: 'cipher',
  member_plate: 'member_plate',
  relic: 'relic_primary',
  accolade_pin_style: 'accolade_pin',
};

// Surfaces a cosmetic may render on. Chat is deliberately narrow (badges +
// atmosphere wash/edge only); everything else is profile / identity-card.
export type CosmeticSurface =
  | 'chat'
  | 'hover'
  | 'profile'
  | 'identity_card'
  | 'collection'
  | 'settings';

export interface AssetManifestAssets {
  static?: string | null;
  animated?: string | null;
  poster?: string | null;
  reduced_motion?: string | null;
  mobile?: string | null;
  desktop?: string | null;
  chat?: string | null;
  profile?: string | null;
  hover?: string | null;
  alpha_mask?: string | null;
  edge_texture?: string | null;
  base_texture?: string | null;
}

export interface AssetManifestRender {
  width?: number;
  height?: number;
  safe_area?: [number, number, number, number];
  scaling?: 'contain' | 'cover' | 'fill' | 'none';
  blend?: string;
  opacity?: number;
  duration_ms?: number;
  loop?: 'infinite' | 'once' | number;
  fallback?: keyof AssetManifestAssets;
  // Names a registered bespoke render component (e.g. the cologne chrome). Absent
  // = the default renderer for the cosmetic_type. Older clients that lack a named
  // renderer fall back to the default, never crash.
  renderer?: string;
}

export interface AssetManifest {
  version: number;
  assets: AssetManifestAssets;
  render?: AssetManifestRender;
}

// The unified cosmetic. Fields the source catalogs do not carry yet (rarity,
// entitlement, render tier, event/set links) default sensibly and get real
// values as definitions gain their own columns in a later stage.
export interface CosmeticDefinition {
  slug: string;
  name: string;
  description: string | null;
  cosmeticType: CosmeticType;
  slot: CosmeticSlot;
  rarity: string | null;
  sourceType: CosmeticSource;
  eventSlug: string | null;
  entitlementRequirement: EntitlementRequirement;
  ownershipPolicy: OwnershipPolicy;
  renderTier: RenderTier;
  isAnimated: boolean;
  supportsReducedMotion: boolean;
  releaseStatus: ReleaseStatus;
  signatureSetSlug: string | null;
  assetManifest: AssetManifest | null;
  isDefault: boolean;
  hidden: boolean;
  sortOrder: number;
  // Type-specific render params carried through from the source catalog
  // (atmosphere accent / chat edge / renderer, badge asset path). Opaque to
  // generic code; consumed by the matching renderer.
  metadata: Record<string, unknown> | null;
}

// Pick the best asset URL from a manifest for the current motion setting.
// Reduced motion prefers a still frame; otherwise the animated asset wins.
export function resolveManifestAsset(
  manifest: AssetManifest | null | undefined,
  opts: { reducedMotion?: boolean } = {},
): string | null {
  const a = manifest?.assets;
  if (!a) return null;
  if (opts.reducedMotion) return a.reduced_motion ?? a.poster ?? a.static ?? null;
  return a.animated ?? a.static ?? a.poster ?? null;
}

// Narrow an unknown JSON value (from a jsonb column) to an AssetManifest.
export function asAssetManifest(raw: unknown): AssetManifest | null {
  if (raw && typeof raw === 'object' && 'assets' in (raw as Record<string, unknown>)) {
    return raw as AssetManifest;
  }
  return null;
}

// ── Equipment (the typed slot model that supersedes active_slug + profile_theme)

// The resolved active loadout: slot -> equipped cosmetic slug (null = cleared).
export type ActiveEquipment = Partial<Record<CosmeticSlot, string | null>>;

// One row of user_cosmetic_equipment (the public active loadout).
export interface EquipmentSlotState {
  slot: CosmeticSlot;
  cosmeticSlug: string | null;
}

// A saved loadout (Subscriber feature): a named set of slot selections.
export interface Loadout {
  id: string;
  name: string;
  isActive: boolean;
  slots: ActiveEquipment;
}

// Derive the atmosphere slug from a profile_theme value: the part before any
// cologne '+coin'/'+border' suffix. 'tier' (free aura) and 'paint' (7TV paint
// background) are background SOURCES, not atmosphere cosmetics, so they map to no
// atmosphere. Mirror of the sync_equipment_atmosphere DB trigger; keep in sync.
export function atmosphereSlugFromProfileTheme(theme: string | null | undefined): string | null {
  const base = (theme ?? '').split('+')[0];
  return base === '' || base === 'tier' || base === 'paint' ? null : base;
}
