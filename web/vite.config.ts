import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
  },
  // transformers.js ships its own ESM + wasm; let it load onnxruntime at runtime
  // rather than having Vite try to pre-bundle it.
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  worker: { format: "es" },
});
