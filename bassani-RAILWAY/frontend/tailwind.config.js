/** @type {import('tailwindcss').Config} */
module.exports = {
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
