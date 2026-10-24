import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Brand colors live in app/globals.css :root custom properties and are
      // referenced via arbitrary values (e.g. text-[var(--hero-teal)]); the
      // unused ink/signal/moss Tailwind palette was removed in the 2026-10-24
      // token unification after a full-reference search found zero usages.
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
