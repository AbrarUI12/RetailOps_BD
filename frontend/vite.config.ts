import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin API in development too, mirroring the production static-site rewrite.
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8000",
      "/health": process.env.API_PROXY_TARGET ?? "http://localhost:8000",
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});

