import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works on Firebase Hosting and on
  // GitHub Pages (project subpath) without changes.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
