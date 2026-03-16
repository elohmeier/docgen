import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      // zetaHelper.js is loaded at runtime from public/, not bundled
      external: ["/vendor/zetajs/zetaHelper.js"],
    },
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (WASM threading)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
