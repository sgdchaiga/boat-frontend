import type { Config } from "tailwindcss";

/** BOAT: warm neutrals + teal brand + semantic states for consistent UI. */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
          950: "#042f2e",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f8fafc",
          subtle: "#f1f5f9",
          page: "#f1f5f9",
        },
        semantic: {
          success: { DEFAULT: "#059669", soft: "#d1fae5", border: "#a7f3d0", text: "#065f46" },
          warning: { DEFAULT: "#d97706", soft: "#fef3c7", border: "#fde68a", text: "#92400e" },
          danger: { DEFAULT: "#dc2626", soft: "#fee2e2", border: "#fecaca", text: "#991b1b" },
          info: { DEFAULT: "#2563eb", soft: "#dbeafe", border: "#bfdbfe", text: "#1e40af" },
        },
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.06)",
        "card-hover": "0 10px 15px -3px rgb(15 23 42 / 0.08), 0 4px 6px -4px rgb(15 23 42 / 0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
