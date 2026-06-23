import type { Config } from "tailwindcss";

/**
 * Patent Geyser 2.0 Design System — "Technical Authority".
 * Brand colors and fonts are defined as CSS variables in app/globals.css
 * and surfaced here so utility classes (e.g. bg-panel, text-ink) work everywhere.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        brand: "#2c3032", // Charcoal Slate
        accent: "#7799b1", // Muted Steel Blue
        action: "#d97757", // Rust / Terracotta (agent working)
        // Semantic, theme-aware via CSS vars
        bg: "var(--bg)",
        panel: "var(--panel)",
        border: "var(--border)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      spacing: {
        // 4px grid is the Tailwind default; expose the panel rhythm explicitly
        panel: "16px",
      },
      keyframes: {
        "pulse-border": {
          "0%, 100%": { borderColor: "rgba(119, 153, 177, 0.5)" },
          "50%": { borderColor: "rgba(119, 153, 177, 0.15)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-border": "pulse-border 2s ease-in-out infinite",
        "fade-in": "fade-in 150ms ease-in-out",
      },
      transitionTimingFunction: {
        util: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
