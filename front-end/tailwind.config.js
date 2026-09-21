/** @type {import('tailwindcss').Config} */

// Tailwind's theme is projected from the design tokens in src/styles/tokens.css
// rather than restating them. A utility such as `text-ink` and a stylesheet rule
// using `var(--color-ink)` therefore resolve to the same value by construction,
// and a token is changed in exactly one place.
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    // Book cover art is the only colour in the interface, so the palette is
    // replaced outright rather than extended - there is no blue-500 to reach for.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      grey: {
        0: 'var(--grey-0)',
        50: 'var(--grey-50)',
        100: 'var(--grey-100)',
        200: 'var(--grey-200)',
        300: 'var(--grey-300)',
        400: 'var(--grey-400)',
        500: 'var(--grey-500)',
        600: 'var(--grey-600)',
        700: 'var(--grey-700)',
        800: 'var(--grey-800)',
        900: 'var(--grey-900)',
        1000: 'var(--grey-1000)',
      },
      paper: {
        DEFAULT: 'var(--color-paper)',
        sunken: 'var(--color-paper-sunken)',
        raised: 'var(--color-paper-raised)',
      },
      ink: {
        DEFAULT: 'var(--color-ink)',
        secondary: 'var(--color-ink-secondary)',
        muted: 'var(--color-ink-muted)',
        inverse: 'var(--color-ink-inverse)',
        'inverse-muted': 'var(--color-ink-inverse-muted)',
      },
      rule: {
        DEFAULT: 'var(--color-rule)',
        subtle: 'var(--color-rule-subtle)',
        strong: 'var(--color-rule-strong)',
      },
      scrim: 'var(--color-scrim)',
    },
    fontFamily: {
      serif: 'var(--font-serif)',
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
    fontSize: {
      label: 'var(--text-label)',
      xs: 'var(--text-xs)',
      sm: 'var(--text-sm)',
      base: 'var(--text-body)',
      h4: 'var(--text-h4)',
      h3: 'var(--text-h3)',
      h2: 'var(--text-h2)',
      h1: 'var(--text-h1)',
      display: 'var(--text-display)',
    },
    spacing: {
      0: 'var(--space-0)',
      1: 'var(--space-1)',
      2: 'var(--space-2)',
      3: 'var(--space-3)',
      4: 'var(--space-4)',
      5: 'var(--space-5)',
      6: 'var(--space-6)',
      8: 'var(--space-8)',
      10: 'var(--space-10)',
      12: 'var(--space-12)',
      16: 'var(--space-16)',
      20: 'var(--space-20)',
      24: 'var(--space-24)',
    },
    borderRadius: {
      none: 'var(--radius-none)',
      sm: 'var(--radius-sm)',
      full: 'var(--radius-full)',
    },
    extend: {
      maxWidth: {
        page: 'var(--measure-page)',
        text: 'var(--measure-text)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        standard: 'var(--ease-standard)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      boxShadow: {
        overlay: 'var(--shadow-overlay)',
      },
    },
  },
  plugins: [],
};
