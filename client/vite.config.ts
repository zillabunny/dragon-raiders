import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Relative base for production so the build works under a GitHub Pages
  // subpath (https://<user>.github.io/<repo>/) regardless of the repo name.
  // Dev server stays at "/".
  base: command === "build" ? "./" : "/",
  server: {
    port: 5173,
    host: true,
    watch: {
      // WSL/devcontainer file events are unreliable; polling guarantees pickup.
      usePolling: true,
      interval: 200,
    },
  },
}));
