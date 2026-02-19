/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        accent: {
          DEFAULT: '#1a73e8', // Google blue
          dark: '#8ab4f8',    // lighter blue for dark mode
        },
        surface: {
          light: '#f8f9fa',
          dark: '#1a1a1a',
        },
        bg: {
          light: '#ffffff',
          dark: '#0d0d0d',
        },
        border: {
          light: '#e8eaed',
          dark: '#303030',
        },
        ink: {
          DEFAULT: '#202124',
          muted: '#5f6368',
        },
        'ink-dark': {
          DEFAULT: '#e8eaed',
          muted: '#9aa0a6',
        },
      },
      fontSize: {
        'hero': ['4.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: '72ch',
          },
        },
      },
    },
  },
  plugins: [],
};
