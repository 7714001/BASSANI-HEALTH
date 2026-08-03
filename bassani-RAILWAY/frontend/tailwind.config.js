/** @type {import('tailwindcss').Config} */
module.exports = {
  // This app has no dark mode toggle or design system for one — 'class' means
  // dark: utilities only ever activate if something adds a `dark` class to an
  // ancestor element, which nothing here does. Without this, Tailwind defaults
  // to 'media', which activates dark: classes automatically from the OS/browser
  // color scheme — the exact bug behind "modal looks dark-themed, I don't have
  // dark mode" reports (see GTINPickerModal.js / GTINPool.js, 2026-08-03).
  darkMode: "class",
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bassani: {
          50:  "#E1F5EE",
          100: "#9FE1CB",
          500: "#1D9E75",
          600: "#0f6e56",
          700: "#085041",
          800: "#04342C",
        },
      },
    },
  },
  plugins: [],
};
