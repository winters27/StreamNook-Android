// Single source of truth for StreamNook entitlement predicates. Owning a paid
// badge is the PERMANENT proof of a tier (granted on the first paid invoice,
// never revoked), so it keeps that tier unlocked for good; an active
// subscription is only a fast path. Keeps the entitling slugs in one place
// instead of scattered string literals. See Brain StreamNook_Cosmetic_Architecture.

export const SUPPORTER_SLUG = 'streamnook-supporter';
export const SUBSCRIBER_SLUG = 'streamnook-subscriber';

export type CosmeticTier = 'free' | 'supporter' | 'subscriber';

export interface EntitlementInput {
  // Slugs the user owns (from the cosmetics entitlement ledger).
  ownedSlugs: ReadonlySet<string>;
  // Whether the user currently has an active subscription (Stripe active /
  // past_due / a live gift). A fast path only; ownership is the durable proof.
  activeSubscription: boolean;
}

export interface Entitlement {
  activeSubscriber: boolean;
  isSupporter: boolean;
  everSubscribed: boolean;
  canPaint: boolean;
  canAtmosphere: boolean;
  tierMet: (tier: CosmeticTier) => boolean;
  owns: (slug: string) => boolean;
}

// Resolve the tier predicates from owned slugs + active status. Supporter =
// owns the supporter OR subscriber badge; ever-subscribed = active now OR owns
// the subscriber badge; paint unlocks at supporter, atmospheres at subscriber.
export function resolveEntitlement(input: EntitlementInput): Entitlement {
  const { ownedSlugs, activeSubscription } = input;
  const isSupporter = ownedSlugs.has(SUPPORTER_SLUG) || ownedSlugs.has(SUBSCRIBER_SLUG);
  const everSubscribed = activeSubscription || ownedSlugs.has(SUBSCRIBER_SLUG);
  const canPaint = everSubscribed || isSupporter;
  const canAtmosphere = everSubscribed;
  return {
    activeSubscriber: activeSubscription,
    isSupporter,
    everSubscribed,
    canPaint,
    canAtmosphere,
    tierMet: (tier) =>
      tier === 'free' ? true : tier === 'supporter' ? canPaint : canAtmosphere,
    owns: (slug) => ownedSlugs.has(slug),
  };
}
