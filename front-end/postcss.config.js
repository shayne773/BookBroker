// Vite has no built-in Tailwind support the way react-scripts 5 did, so the
// PostCSS pipeline is declared here.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
