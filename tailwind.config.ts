import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171717",
        muted: "#6f6f6b",
        line: "#d8d8d3",
        mist: "#eeeeea",
        signal: {
          50: "#f7f7f4",
          100: "#e3e3de",
          500: "#777771",
          600: "#50504b",
          700: "#2e2e2b",
          900: "#161615"
        },
        caution: "#9a6700",
        danger: "#b42318"
      },
      boxShadow: {
        panel: "0 18px 55px rgba(22, 22, 21, 0.09)",
        popover: "0 24px 70px rgba(22, 22, 21, 0.22)"
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
