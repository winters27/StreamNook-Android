import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A physical Android device cannot reach the host's localhost, so `tauri android
// dev` rewrites devUrl to the interface IP it detects and exports that IP as
// TAURI_DEV_HOST for this config to bind to. Without honouring it, Tauri waits
// forever on "Waiting for your frontend dev server to start".
// Unset on desktop `tauri dev`, where `host: false` keeps the current
// localhost-only binding, so desktop behaviour is unchanged.
const devHost = process.env.TAURI_DEV_HOST;

// Android runs on its own port so it can never collide with a desktop `tauri dev`
// (or a leftover preview server) already holding 1420. src-tauri/tauri.android.conf.json
// sets SN_DEV_PORT=1430 and points devUrl at it; desktop keeps the default.
// HMR gets port+1, which must differ per platform for the same reason.
const devPort = Number(process.env.SN_DEV_PORT ?? 1420);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    host: devHost || false,
    port: devPort,
    strictPort: true,
    // HMR needs its own explicit host when serving a device over the network;
    // the default derives the websocket URL from `location`, which is the phone.
    hmr: devHost ? { protocol: 'ws', host: devHost, port: devPort + 1 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-core': ['react', 'react-dom', 'zustand'],
          'vendor-hls': ['hls.js', 'plyr'],
          'vendor-motion': ['framer-motion'],
          'vendor-tauri': [
            '@tauri-apps/api', 
            '@tauri-apps/plugin-shell', 
            '@tauri-apps/plugin-deep-link', 
            '@tauri-apps/plugin-clipboard-manager', 
            '@tauri-apps/plugin-dialog', 
            '@tauri-apps/plugin-notification'
          ],
        }
      }
    }
  }
})
