import type { Config } from 'tailwindcss'

/**
 * YelloTalk theme — the brand is sunny yellow with playful mascot accents
 * (Pink Bird, Blue Rhino, Green Rabbit). Warm near-white surfaces, dark ink.
 * Tokens are RGB channels in globals.css (:root = light, [data-theme=dark]).
 *
 * `brand` = bright yellow used for FILLS (buttons/logo/3D) with dark text.
 * `gold` = a readable amber used for TEXT accents (links, active nav).
 */
const token = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`

// Legacy palette classes recolor to the YelloTalk mascot palette.
const YELLOW = {
  50: '#fdf7e8', 100: '#f9ecc9', 200: '#f2d998', 300: '#e8be5c',
  400: '#d9a02a', 500: '#c78a0a', 600: '#a5710a', 700: '#82580a',
  800: '#684609', 900: '#513608', 950: '#2f2004',
}
const PINK = {
  50: '#ffeaf1', 100: '#ffd0de', 200: '#ffa6c1', 300: '#ff7aa2',
  400: '#ff5c8a', 500: '#f43f72', 600: '#db1f5b', 700: '#b3184a',
  800: '#8f183e', 900: '#761736', 950: '#45071b',
}
const BLUE = {
  50: '#e8f5fd', 100: '#c8e9fb', 200: '#97d4f6', 300: '#5cbcef',
  400: '#2e9be0', 500: '#1f83c7', 600: '#196ba3', 700: '#175683',
  800: '#16466a', 900: '#143a58', 950: '#0c2436',
}
const GREEN = {
  50: '#e9f9ef', 100: '#ccf0d9', 200: '#9fe3b7', 300: '#66d08f',
  400: '#3bb96b', 500: '#2aa35c', 600: '#22854b', 700: '#1d6a3d',
  800: '#195532', 900: '#14432a', 950: '#0a2417',
}
const ORANGE = {
  50: '#fef3e6', 100: '#fbe0bf', 200: '#f7c485', 300: '#f2a24b',
  400: '#f08a24', 500: '#de7311', 600: '#b95a0e', 700: '#93470f',
  800: '#763a10', 900: '#5f2f0e', 950: '#341806',
}
const RED = {
  50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5',
  400: '#f87171', 500: '#ed4c3c', 600: '#dc2626', 700: '#b91c1c',
  800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a',
}
const NEUTRAL = {
  50: '#f9f8f3', 100: '#f1ede4', 200: '#e5ded0', 300: '#cfc7b4',
  400: '#948c78', 500: '#6a6455', 600: '#514c40', 700: '#38342b',
  800: '#24211a', 900: '#17150f', 950: '#0e0c08',
}

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        base: token('base'),
        panel: token('panel'),
        raised: token('raised'),
        line: token('line'),
        linehi: token('linehi'),
        ink: token('ink'),
        dim: token('dim'),
        faint: token('faint'),
        gold: { DEFAULT: token('gold'), hi: token('goldhi') }, // readable amber (text)
        brand: { DEFAULT: token('brand'), hi: token('brandhi') }, // bright yellow (fills)
        glow: token('glow'), // pink
        side: token('side'), // blue
        ok: token('ok'), // green
        warn: token('warn'), // orange
        err: token('err'),

        background: token('base'),
        foreground: token('ink'),
        card: { DEFAULT: token('raised'), foreground: token('ink') },
        popover: { DEFAULT: token('raised'), foreground: token('ink') },
        primary: { DEFAULT: token('brand'), foreground: token('onaccent') },
        secondary: { DEFAULT: token('panel'), foreground: token('ink') },
        muted: { DEFAULT: token('panel'), foreground: token('dim') },
        accent: { DEFAULT: token('panel'), foreground: token('ink') },
        destructive: { DEFAULT: token('err'), foreground: token('onerr') },
        border: token('line'),
        input: token('line'),
        ring: token('gold'),

        rose: YELLOW, pink: YELLOW,
        fuchsia: PINK, purple: PINK, violet: PINK,
        indigo: BLUE, blue: BLUE, sky: BLUE, cyan: BLUE,
        emerald: GREEN, green: GREEN, teal: GREEN, lime: GREEN,
        amber: ORANGE, orange: ORANGE, yellow: ORANGE,
        red: RED,
        gray: NEUTRAL, slate: NEUTRAL, zinc: NEUTRAL, neutral: NEUTRAL, stone: NEUTRAL,
      },
      borderRadius: {
        none: '0px',
        sm: '8px',
        DEFAULT: '10px',
        md: '12px',
        lg: '14px',
        xl: '18px',
        '2xl': '22px',
        '3xl': '30px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(60 40 8 / 0.06)',
        DEFAULT: '0 1px 3px 0 rgb(60 40 8 / 0.08), 0 1px 2px -1px rgb(60 40 8 / 0.05)',
        md: '0 4px 14px -3px rgb(60 40 8 / 0.12)',
        lg: '0 12px 30px -8px rgb(60 40 8 / 0.16)',
        xl: '0 24px 50px -16px rgb(60 40 8 / 0.20)',
        '2xl': '0 32px 64px -24px rgb(60 40 8 / 0.24)',
        glow: '0 8px 26px -6px rgb(255 198 26 / 0.5)',
        none: 'none',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        pulseglow: { '0%,100%': { opacity: '0.5' }, '50%': { opacity: '1' } },
      },
      animation: {
        float: 'float 5s ease-in-out infinite',
        pulseglow: 'pulseglow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
