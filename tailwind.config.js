/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'], // admin studio
        editorial: ['"Playfair Display"', 'Georgia', 'serif'], // public mediakit headings
      },
      colors: {
        // Admin studio: warm stone neutrals + a muted plum accent.
        plum: {
          50: '#faf5fb',
          100: '#f3e8f5',
          500: '#8b5a8c',
          600: '#754a76',
          700: '#5f3c60',
        },
        // Public mediakit: dark editorial. Near-black surfaces + warm ivory text.
        ink: {
          950: '#0a0a0c',
          900: '#101014',
          850: '#15151b',
          800: '#1b1b22',
          700: '#26262f',
          600: '#34343f',
        },
        ivory: '#f5f2ec', // warm off-white text on ink
        // Single warm accent (rose) — fashion-editorial, ties to the plum admin hue.
        blush: {
          300: '#f3b8c6',
          400: '#ec8aa1',
          500: '#e0617f',
          600: '#c8466a',
        },
      },
    },
  },
  plugins: [],
}
