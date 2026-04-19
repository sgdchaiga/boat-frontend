import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    // Same-origin proxy so the SPA can call boat-server without CORS during `vite` dev.
    // Use VITE_BOAT_API_URL=/boat-api (or leave API base empty — see communicationsApi).
    proxy: {
      "/boat-api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/boat-api/, ""),
      },
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  optimizeDeps: {
    exclude: ['lucide-react'],
  },
})