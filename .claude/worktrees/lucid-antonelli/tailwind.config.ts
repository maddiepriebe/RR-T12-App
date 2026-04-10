import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#e7eaf0",
          100: "#c2cad8",
          200: "#9aaabe",
          300: "#718aa4",
          400: "#507090",
          500: "#2e577d",
          600: "#254f72",
          700: "#1a3f5f",
          800: "#10304d",
          900: "#0a2240",
          950: "#061629",
        },
        gold: {
          50: "#fdf8e7",
          100: "#faedc4",
          200: "#f7e09d",
          300: "#f3d275",
          400: "#f1c757",
          500: "#eebb38",
          600: "#d4a52e",
          700: "#b38a22",
          800: "#927117",
          900: "#785b0d",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
