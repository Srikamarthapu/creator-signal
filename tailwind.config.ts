import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f1f1d",
        muted: "#77746d",
        line: "#dedbd4",
        mist: "#f3f1ed",
        signal: {
          50: "#f6f5f2",
          100: "#e8e4dc",
          500: "#6f655a",
          600: "#4b4640",
          700: "#302f2c",
          900: "#20201e"
        },
        caution: "#9a6700",
        danger: "#b42318"
      },
      boxShadow: {
        panel: "0 18px 50px rgba(42, 39, 34, 0.08)",
        popover: "0 24px 70px rgba(42, 39, 34, 0.2)"
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
} satisfies Config;
