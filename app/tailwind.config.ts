import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1280px" } },
    extend: {
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        display: ["Sora", "system-ui", "sans-serif"],
      },
      colors: {
        navy: { DEFAULT: "#0D1B2A", 600: "#16283B", 500: "#1E3449", 400: "#27425C" },
        mint: { DEFAULT: "#2DD4A8", 600: "#16DFB7", 700: "#0E8F6F" },
        ink: { DEFAULT: "#F7FAFC", muted: "#A9BCCF", faint: "#6E8399" },
        danger: "#F87171",
        warn: "#F5A524",
      },
      // Degraus finos de opacidade usados nas bordas de vidro (border-white/8, /12).
      opacity: { 2: "0.02", 3: "0.03", 4: "0.04", 6: "0.06", 7: "0.07", 8: "0.08", 12: "0.12" },
      borderRadius: { xl: "0.875rem", "2xl": "1.25rem", "3xl": "1.75rem" },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.28), 0 12px 32px -16px rgba(0,0,0,.55)",
        glow: "0 0 0 1px rgba(45,212,168,.35), 0 10px 40px -12px rgba(45,212,168,.35)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" },
                     to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: { "fade-up": "fade-up .22s ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
