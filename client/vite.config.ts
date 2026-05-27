import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    watch: {
      // WSL/devcontainer file events are unreliable; polling guarantees pickup.
      usePolling: true,
      interval: 200,
    },
  },
});
