// Created and developed by Jai Singh
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vite configuration for the OmniAgent v2 GUI shell.
 *
 * Tauri-specific tuning:
 *   - `server.port = 1420` matches the `devUrl` declared in
 *     `crates/agent-gui/tauri.conf.json`. Changing one without the other
 *     leaves the Tauri webview pointed at the wrong port.
 *   - `server.strictPort = true` so a port-already-in-use error fails fast
 *     instead of silently rolling to 1421 (which Tauri would then 404 on).
 *   - `clearScreen = false` keeps Vite's HMR logs visible alongside the
 *     Tauri CLI output during `cargo tauri dev`.
 *   - `envPrefix = ["VITE_", "TAURI_"]` so the frontend can read either
 *     namespace at build time.
 *   - `build.target = "esnext"` because the webview is Chromium/WebKit2
 *     locked to whatever the host OS ships — no need to target ES2015.
 */

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Don't watch the Rust workspace from the JS dev server; the Tauri CLI
      // owns Rust reloads via cargo-watch.
      ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-popover",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toggle",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
  },
});

// Created and developed by Jai Singh
