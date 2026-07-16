import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" (not "autoUpdate") deliberately leaves a newly-downloaded
      // service worker waiting instead of silently activating it — this app
      // registers it manually (see lib/swUpdate.ts) so a cashier with an
      // in-progress cart controls exactly when the page reloads to pick up
      // the new version, rather than having it swapped out from under them.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "apple-touch-icon.png", "favicon.png"],
      manifest: {
        name: "Anakel Eazzy Mart POS",
        short_name: "Eazzy Mart POS",
        description: "Point of sale for Anakel Eazzy Mart",
        theme_color: "#173a2a",
        background_color: "#173a2a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          // Same full-bleed design already keeps its content within Android's
          // maskable safe zone, so it doubles as the maskable icon without a
          // separate asset — no risk of the "A" or leaf getting cropped.
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Runtime API calls always go to the network first; only the app
        // shell is precached so a cashier can still open the till offline.
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /\/api\/.*/,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
