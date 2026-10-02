import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // 同じLANのスマホ・表示端末から開けるようにする
  server: { host: true, port: 5174, strictPort: true },
});
