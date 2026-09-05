import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.API_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
