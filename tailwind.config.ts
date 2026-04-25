import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
      },
      fontSize: {
        xs: ["12px", "1.5"],
        sm: ["13px", "1.5"],
        base: ["15px", "1.55"],
        lg: ["18px", "1.4"],
        xl: ["20px", "1.3"],
        "2xl": ["26px", "1.25"],
        "3xl": ["36px", "1.15"],
        // Premium Apple HIG-calibrated type scale (iter6 DESIGN_BRIEF §1)
        display: ["34px", { lineHeight: "1.08", letterSpacing: "-0.028em", fontWeight: "700" }],
        h1: ["28px", { lineHeight: "1.15", letterSpacing: "-0.022em", fontWeight: "700" }],
        h2: ["22px", { lineHeight: "1.25", letterSpacing: "-0.016em", fontWeight: "600" }],
        h3: ["17px", { lineHeight: "1.35", letterSpacing: "-0.012em", fontWeight: "600" }],
        body: ["15px", "1.55"],
        caption: ["13px", { lineHeight: "1.4", fontWeight: "500" }],
        label: ["11px", { lineHeight: "1.3", letterSpacing: "0.08em", fontWeight: "600" }],
        numeric: ["26px", { lineHeight: "1", fontWeight: "600" }],
      },
      letterSpacing: {
        label: "0.08em",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        // Named aliases remapped to new scale
        card: "var(--shadow-sm)",
        raised: "var(--shadow-md)",
        float: "var(--shadow-lg)",
      },
      colors: {
        // shadcn semantic tokens — read from CSS vars
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        // Primary — Owl Purple ramp + DEFAULT/foreground from CSS vars
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          50: "#F5F1FB",
          100: "#E8DCF5",
          200: "#CDBAE8",
          300: "#A882D6",
          400: "#7B4DB8",
          500: "#5A2E9A",
          600: "#3E1A6E",
          700: "#2D1152",
          800: "#1E0A38",
          900: "#0F0520",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        // Accent — Wisdom Amber ramp + DEFAULT/foreground from CSS vars
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          100: "#FDF3DC",
          400: "#F0BC50",
          500: "#E8A520",
          600: "#C47A0A",
        },
        // Brand accent (Wisdom Amber) — explicit token
        "brand-accent": {
          DEFAULT: "hsl(var(--brand-accent) / <alpha-value>)",
          foreground: "hsl(var(--brand-accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
          surface: "hsl(var(--success-surface) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
          surface: "hsl(var(--warning-surface) / <alpha-value>)",
        },
        // Warm purple-tinted gray neutrals
        warm: {
          50: "#F8F6FB",
          100: "#E8E4F0",
          200: "#C8C2D4",
          400: "#9B94A8",
          600: "#6B6478",
          800: "#3A3340",
          950: "#1A1520",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          "InterVariable",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Display"',
          '"SF Pro Text"',
          "InterVariable",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        body: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          "InterVariable",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          '"SF Mono"',
          "Menlo",
          "Monaco",
          '"JetBrains Mono"',
          "monospace",
        ],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-listening": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.7", transform: "scale(1.05)" },
        },
        "mic-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.6", transform: "scale(1.15)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-listening": "pulse-listening 2s ease-in-out infinite",
        "mic-pulse": "mic-pulse 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
