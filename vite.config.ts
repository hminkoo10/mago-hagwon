import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { toWebRequest, sendWebResponse, clientIp } from "./server/node-adapter.ts";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "hagwon-api",
      configureServer(server) {
        let api: any;
        const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/")) return next();
          try {
            if (!api) {
              const mod = await server.ssrLoadModule("/server/handler.ts");
              api = mod.createApi({
                env,
              });
            }
            await sendWebResponse(
              res,
              await api(toWebRequest(req, `http://${req.headers.host}`), clientIp(req, env.TRUST_PROXY === "1")),
            );
          } catch (e) {
            next(e);
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 8476, strictPort: true },
  ssr: { external: ["node:sqlite"] },
}));
