import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // MOS Scene Hunt palette - deep indigo night + amber field-signal accent.
        ink: {
          900: "#0b1020",
          800: "#141a30",
          700: "#1d2542",
          600: "#2a3459",
        },
        signal: {
          DEFAULT: "#f5a524",
          soft: "#ffd08a",
          deep: "#c47c0a",
        },
        moss: {
          DEFAULT: "#2ec27e",
          deep: "#1c7d51",
        },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.06), 0 8px 24px -12px rgba(15,23,42,.18)",
        sheet: "0 -8px 32px -8px rgba(15,23,42,.24)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(.6)", opacity: "0.9" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "rise-in": {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2s cubic-bezier(.2,.6,.4,1) infinite",
        "rise-in": "rise-in .28s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
