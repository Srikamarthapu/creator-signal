import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#15201f",
        muted: "#60716f",
        line: "#dce4e2",
        mist: "#f4f8f7",
        signal: {
          50: "#edfdf9",
          100: "#d0f7ef",
          500: "#15957f",
          600: "#0f766e",
          700: "#115e59",
          900: "#103b37"
        },
        caution: "#9a6700",
        danger: "#b42318"
      },
      boxShadow: {
        panel: "0 12px 35px rgba(19, 32, 31, 0.08)",
        popover: "0 24px 70px rgba(19, 32, 31, 0.2)"
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

