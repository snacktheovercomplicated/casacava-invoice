import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  server: {
    port: 5173,
    // The API runs on the Worker; wrangler serves it on 8787 in development.
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
    // The shared money and words modules live outside web/.
    fs: { allow: [".."] },
  },
});
