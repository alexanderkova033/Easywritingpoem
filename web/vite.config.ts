import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [react()],
  build: {
    // Target evergreen browsers — produces smaller, faster output.
    target: "es2020",
    // Raise the chunk size warning threshold (word-list is intentionally large).
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/scheduler")
          ) {
            return "vendor-react";
          }
          if (
            id.includes("node_modules/@codemirror") ||
            id.includes("node_modules/@uiw/codemirror") ||
            id.includes("node_modules/@uiw/react-codemirror") ||
            id.includes("node_modules/codemirror") ||
            id.includes("node_modules/@lezer") ||
            id.includes("node_modules/@marijn") ||
            id.includes("node_modules/style-mod") ||
            id.includes("node_modules/w3c-keyname") ||
            id.includes("node_modules/crelt")
          ) {
            return "vendor-codemirror";
          }
          // Word-list and CMU dictionary are large; isolate them so the main
          // bundle stays lean and they can be cached independently.
          if (
            id.includes("node_modules/word-list") ||
            id.includes("node_modules/cmu-pronouncing-dictionary")
          ) {
            return "vendor-dictionaries";
          }
          // docx is pulled in only for export; keep it out of the critical path.
          if (id.includes("node_modules/docx")) {
            return "vendor-docx";
          }
          // Tool-panel analysis code is part of the initial workshop bundle
          // (the panels render immediately). voice/ stays grouped here too.
          // reading/, sharing/, and appearance/ are lazy-loaded via React.lazy
          // — Vite splits each into its own dynamic chunk, so do NOT include
          // them here. Listing them would defeat the code-split.
          if (
            id.includes("/src/workshop/analysis/") ||
            id.includes("/src/workshop/voice/")
          ) {
            return "workshop-tools";
          }
          // Landing page is now lazy-loaded — give it its own chunk so the
          // workshop code (CodeMirror, tools, etc.) doesn't inflate the
          // landing-page download and vice-versa.
          if (id.includes("/src/landing/")) {
            return "landing";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    // In local dev, "vercel dev" runs on :3000 and handles /api/*.
    // If you run bare "vite dev" the analyze button will fail; use "vercel dev" instead.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
