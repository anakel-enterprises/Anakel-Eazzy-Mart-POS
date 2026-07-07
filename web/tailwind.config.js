/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
      },
      colors: {
        // "Fresh Grocer" (option 1a) palette — dark green sidebar, soft cards.
        // Hex, not oklch(): Tailwind's /NN opacity modifier can't apply alpha
        // to arbitrary oklch() strings and silently drops the utility.
        brand: {
          sidebar: "#032110",
          sidebarSoft: "#12301e",
          sidebarMuted: "#1c3a27",
          accent: "#2e9e52",
          accentDeep: "#0a562b",
          accentText: "#108846",
          bg: "#eeebe4",
          surface: "#f9f8f5",
          border: "#e9e8e4",
          ink: "#181611",
          inkMuted: "#65635d",
          warn: "#d24e3e",
          warnBg: "#ffcdb6",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
};
