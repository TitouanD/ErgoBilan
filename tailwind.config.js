/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './types.ts',
    './utils.ts',
    './components/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
    './data/**/*.{ts,tsx}',
  ],
  // dark: applies when .dark-theme is present on any ancestor element
  darkMode: ['class', '.dark-theme'],
  theme: {
    extend: {},
  },
  plugins: [],
};
