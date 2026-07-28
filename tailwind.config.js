// CSS-variable color that supports opacity modifiers (bg-accent/20). A plain
// 'var(...)' string silently generates NO css for modifier classes, which left
// 300+ authored token tints dead until 2026-07-26.
const varColor = (cssVar) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `var(${cssVar})`
    : `color-mix(in srgb, var(${cssVar}) calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        '3xl': '1920px',
      },
      colors: {
        // Theme-aware colors using CSS variables
        background: varColor('--color-background'),
        secondary: varColor('--color-background-secondary'),
        tertiary: varColor('--color-background-tertiary'),
        accent: varColor('--color-accent'),
        'accent-hover': varColor('--color-accent-hover'),
        'accent-muted': varColor('--color-accent-muted'),
        'accent-neon': varColor('--color-accent-neon'),
        textPrimary: varColor('--color-text-primary'),
        textSecondary: varColor('--color-text-secondary'),
        textMuted: varColor('--color-text-muted'),
        border: varColor('--color-border'),
        borderLight: varColor('--color-border-light'),
        borderSubtle: varColor('--color-border-subtle'),
        surface: varColor('--color-surface'),
        'surface-hover': varColor('--color-surface-hover'),
        'surface-active': varColor('--color-surface-active'),
        // Semantic colors
        success: varColor('--color-success'),
        warning: varColor('--color-warning'),
        error: varColor('--color-error'),
        info: varColor('--color-info'),
        // LIVE indicator red: pinned in globals.css, deliberately not themed
        live: varColor('--color-live'),
        // Glass utility
        glass: {
          DEFAULT: varColor('--color-surface'),
          hover: varColor('--color-surface-hover'),
          active: varColor('--color-surface-active'),
        },
        // Highlight colors
        highlight: {
          pink: varColor('--color-highlight-pink'),
          purple: varColor('--color-highlight-purple'),
          blue: varColor('--color-highlight-blue'),
          cyan: varColor('--color-highlight-cyan'),
          green: varColor('--color-highlight-green'),
          yellow: varColor('--color-highlight-yellow'),
          orange: varColor('--color-highlight-orange'),
          red: varColor('--color-highlight-red'),
        },
      },
      fontFamily: {
        // Driven by --app-font (set by applyFont in themes/index.ts) so the
        // `font-sans` utility follows the user's Theme > Font choice. The
        // static entries are fallbacks if the variable is ever unset.
        sans: ['var(--app-font)', 'Satoshi', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Gentle fade + slight grow for overlays/modals so they ease in
        // instead of snapping. Pairs with the house spring feel.
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        droplet: {
          '0%, 100%': {
            transform: 'translateY(-8px)',
            opacity: '0'
          },
          '20%': {
            transform: 'translateY(-8px)',
            opacity: '1'
          },
          '40%': {
            transform: 'translateY(-8px)',
            opacity: '1'
          },
          '60%': {
            transform: 'translateY(8px)',
            opacity: '1'
          },
          '80%': {
            transform: 'translateY(12px)',
            opacity: '0'
          },
        },
        splash: {
          '0%': {
            transform: 'scale(0.5)',
            opacity: '1'
          },
          '50%': {
            transform: 'scale(1.5)',
            opacity: '0.6'
          },
          '100%': {
            transform: 'scale(2.5)',
            opacity: '0'
          },
        },
        ripple: {
          '0%, 56%': {
            transform: 'scale(0.8)',
            opacity: '0'
          },
          '60%': {
            transform: 'scale(1.0)',
            opacity: '0.5'
          },
          '68%': {
            transform: 'scale(1.3)',
            opacity: '0.4'
          },
          '78%': {
            transform: 'scale(1.6)',
            opacity: '0.2'
          },
          '88%': {
            transform: 'scale(1.9)',
            opacity: '0.1'
          },
          '100%': {
            transform: 'scale(2.2)',
            opacity: '0'
          },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
        shimmer: 'shimmer 2s ease-in-out infinite',
        droplet: 'droplet 2.5s ease-in-out infinite',
        splash: 'splash 0.6s ease-out forwards',
        ripple: 'ripple 2.5s ease-out infinite',
      },
    },
  },
  plugins: [],
}
