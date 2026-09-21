/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae5ff',
          200: '#bdd0ff',
          300: '#90b0ff',
          400: '#5c85fc',
          500: '#375ef6',
          600: '#213deb',
          700: '#1a2dd7',
          800: '#1c28ae',
          900: '#1c2989',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.06), 0 1px 3px rgb(16 24 40 / 0.1)',
      },
    },
  },
  plugins: [],
};
