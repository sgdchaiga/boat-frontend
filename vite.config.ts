import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const proxySupabaseFunctions = env.VITE_DEV_PROXY_SUPABASE_FUNCTIONS === "true";

  const supabaseFunctionsProxy: Record<string, { target: string; changeOrigin: boolean; secure: boolean; rewrite: (p: string) => string }> = {};
  if (proxySupabaseFunctions && supabaseUrl) {
    try {
      const base = new URL(supabaseUrl);
      supabaseFunctionsProxy["/__sb_functions"] = {
        target: `${base.protocol}//${base.host}`,
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/__sb_functions/, "/functions/v1"),
      };
    } catch {
      /* ignore invalid VITE_SUPABASE_URL */
    }
  }

  return {
    plugins: [react()],

    server: {
      // Same-origin proxy so the SPA can call boat-server without CORS during `vite` dev.
      // Use VITE_BOAT_API_URL=/boat-api (or leave API base empty — see communicationsApi).
      proxy: {
        "/boat-api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/boat-api/, ""),
        },
        ...supabaseFunctionsProxy,
      },
    },

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },

    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("pdfjs-dist") || id.includes("jspdf") || id.includes("html2canvas") || id.includes("dompurify")) {
              return "vendor-pdf";
            }
            if (id.includes("xlsx")) return "vendor-xlsx";
            if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
            if (id.includes("@supabase")) return "vendor-supabase";
            if (id.includes("lucide-react")) return "vendor-icons";
            return "vendor";
          },
        },
      },
    },

    optimizeDeps: {
      include: [
        "@supabase/supabase-js",
        "jspdf",
        "jspdf-autotable",
        "lucide-react",
        "react",
        "react-dom",
        "react-hot-toast",
        "recharts",
        "xlsx",
      ],
    },
  };
});
