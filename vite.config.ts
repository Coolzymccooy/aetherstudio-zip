import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",        // ✅ listen on LAN
      port: 5173,
      strictPort: true,
      hmr: {
        host: "192.168.0.22", // ✅ helps HMR not bind to localhost only
        port: 5173,
      },
      allowedHosts: ["localhost", "127.0.0.1", ".trycloudflare.com"],
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: ["localhost", "127.0.0.1", ".trycloudflare.com"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});
