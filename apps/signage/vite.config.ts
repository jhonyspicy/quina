import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Staging・本番と同じく、画面と同じURLの `/api` をAPI（wrangler dev）へ振り分ける */
const apiProxy = { "/api": { target: "http://localhost:8787", ws: true } };

export default defineConfig({
  plugins: [react()],
  // 同じLANのスマホ・表示端末から開けるようにする
  server: { host: true, port: 5174, strictPort: true, proxy: apiProxy },
  preview: { proxy: apiProxy },
});
