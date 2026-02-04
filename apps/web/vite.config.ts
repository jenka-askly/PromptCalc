/**
 * Purpose: Configure Vite for the PromptCalc React frontend.
 * Persists: None.
 * Security Risks: Proxies API calls to the local Functions host.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:7071",
        changeOrigin: true,
      },
    },
  },
});
