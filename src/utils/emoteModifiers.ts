import type { CSSProperties } from 'react';

/**
 * Modifier-emote flag bits, shared by the chat renderer and the emote picker.
 *
 * Bits 0..17 are FrankerFaceZ's own, in FFZ's authoritative declaration order.
 * Bits 18+ are ours, for BetterTTV effects that have no FFZ equivalent. Codes
 * whose effect is genuinely identical share a bit instead of getting a
 * duplicate, which is why BetterTTV's `h!`, `v!`, `c!` and `z!` map onto
 * FlipX, FlipY, Cursed and NoSpace.
 *
 * The backend mirrors this table in `src-tauri/src/services/emote_service.rs`;
 * the two are hand-kept in sync and guarded by exact-value tests there.
 */
export const MOD_HIDDEN = 1; // modifier draws no art of its own
export const MOD_FLIP_X = 1 << 1;
export const MOD_FLIP_Y = 1 << 2;
export const MOD_GROW_X = 1 << 3; // FFZ ffzW: double width, aspect preserved
export const MOD_SLIDE = 1 << 4;
export const MOD_APPEAR = 1 << 5;
export const MOD_LEAVE = 1 << 6;
export const MOD_ROTATE = 1 << 7;
export const MOD_ROTATE_90 = 1 << 8;
export const MOD_GREYSCALE = 1 << 9;
export const MOD_SEPIA = 1 << 10;
export const MOD_RAINBOW = 1 << 11;
export const MOD_HYPER_RED = 1 << 12;
export const MOD_SHAKE = 1 << 13;
export const MOD_CURSED = 1 << 14;
export const MOD_JAM = 1 << 15;
export const MOD_BOUNCE = 1 << 16;
export const MOD_NO_SPACE = 1 << 17; // eats the space before the target

/**
 * Marker: this modifier attaches to the emote AFTER it, not before it.
 * BetterTTV modifiers are prefixes; FrankerFaceZ modifiers are suffixes.
 * It is a routing bit, not an effect, so it never reaches the effect wrappers.
 */
export const MOD_PREFIX = 1 << 18;
export const MOD_BTTV_WIDE = 1 << 19; // fixed 4:1 stretch, aspect NOT preserved
export const MOD_BTTV_ROTATE_L = 1 << 20;
export const MOD_BTTV_ROTATE_R = 1 << 21;
export const MOD_BTTV_PARTY = 1 << 22;
export const MOD_BTTV_SHAKE = 1 << 23; // BTTV's own step-start jitter

/** Bits that only reroute or hide, and so never produce an effect wrapper. */
export const MOD_NON_EFFECT_BITS = MOD_HIDDEN | MOD_PREFIX;

/** Static `transform` pieces, composed in table order. */
export const MODIFIER_TRANSFORMS: Array<[number, string]> = [
  [MOD_FLIP_X, 'scaleX(-1)'],
  [MOD_FLIP_Y, 'scaleY(-1)'],
  [MOD_ROTATE_90, 'rotate(90deg)'],
  [MOD_BTTV_ROTATE_L, 'rotate(-90deg)'],
  [MOD_BTTV_ROTATE_R, 'rotate(90deg)'],
];

/** Static `filter` pieces, composed in table order. */
export const MODIFIER_FILTERS: Array<[number, string]> = [
  [MOD_GREYSCALE, 'grayscale(1)'],
  [MOD_SEPIA, 'sepia(1)'],
  [MOD_CURSED, 'grayscale(1) brightness(0.7) contrast(2.5)'],
  [MOD_HYPER_RED, 'brightness(0.2) sepia(1) brightness(2.2) contrast(3) saturate(8)'],
];

/**
 * Animated effects and their keyframe classes (defined in globals.css). Each
 * one gets its OWN wrapper element: two animations on a single element that
 * animate the same property cancel each other out, and ffzHyper alone needs a
 * static filter plus the shake animation to coexist.
 */
export const ANIMATED_MODIFIERS: Array<[number, string]> = [
  [MOD_RAINBOW, 'sn-ffz-anim-rainbow'],
  [MOD_SHAKE, 'sn-ffz-anim-shake'],
  [MOD_JAM, 'sn-ffz-anim-jam'],
  [MOD_BOUNCE, 'sn-ffz-anim-bounce'],
  [MOD_ROTATE, 'sn-ffz-anim-spin'],
  [MOD_SLIDE, 'sn-ffz-anim-slide'],
  [MOD_APPEAR, 'sn-ffz-anim-appear'],
  [MOD_LEAVE, 'sn-ffz-anim-leave'],
  [MOD_BTTV_PARTY, 'sn-bttv-anim-party'],
  [MOD_BTTV_SHAKE, 'sn-bttv-anim-shake'],
];

/**
 * Static preview styling for a modifier emote in a hover card, so the card
 * shows what the effect DOES instead of the placeholder art alone. Animated
 * effects are deliberately left out: a looping preview under the cursor is
 * distracting, and the widening ones are what a reader actually needs to see.
 */
export const staticModifierStyle = (flags?: number): CSSProperties => {
  if (!flags) return {};
  const transforms: string[] = [];
  for (const [bit, value] of MODIFIER_TRANSFORMS) {
    if (flags & bit) transforms.push(value);
  }
  // Widening reads as a preview-only horizontal scale here; in chat both are
  // real width changes on the image itself.
  if (flags & MOD_GROW_X) transforms.push('scaleX(2)');
  if (flags & MOD_BTTV_WIDE) transforms.push('scaleX(4)');

  const filters: string[] = [];
  for (const [bit, value] of MODIFIER_FILTERS) {
    if (flags & bit) filters.push(value);
  }

  return {
    ...(transforms.length ? { transform: transforms.join(' ') } : {}),
    ...(filters.length ? { filter: filters.join(' ') } : {}),
  };
};
