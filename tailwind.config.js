/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "brand-navy": "#02256F",
        "brand-blue": "#0D68EF",
        "brand-navy-deep": "#06122E",
        ink: "#0A0F1C",
        paper: "#FFFFFF",
        "paper-alt": "#F6F8FC",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #02256F 0%, #0D68EF 100%)",
      },
      fontFamily: {
        sans: [
          "'Inter var'",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
}
