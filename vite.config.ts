
import { defineConfig } from "vite";

export default defineConfig({
  base: "/token-craft/",
  server: {
    host: "localhost",
    port: 5173,
    cors: {
      origin: "https://www.owlbear.rodeo",
    },
  },
});
