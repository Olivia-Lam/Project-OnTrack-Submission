import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The SGDS package entry and its React wrappers must be pre-bundled together so they share one
  // copy of each component - otherwise every custom element is defined twice and the page crashes.
  optimizeDeps: {
    include: ["@govtechsg/sgds-web-component", "@govtechsg/sgds-web-component/react"],
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
