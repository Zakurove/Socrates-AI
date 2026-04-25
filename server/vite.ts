import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, type ViteDevServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const viteLogger = {
  info: (msg: string) => log(msg),
  warn: (msg: string) => log(`[warn] ${msg}`),
  error: (msg: string) => log(`[error] ${msg}`),
  warnOnce: (msg: string) => log(`[warn] ${msg}`),
  clearScreen: () => {},
  hasErrorLogged: () => false,
  hasWarned: false,
};

export function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${timestamp} [server] ${message}`);
}

export async function setupVite(app: Express): Promise<ViteDevServer> {
  const vite = await createViteServer({
    root: path.resolve(PROJECT_ROOT, "client"),
    configFile: path.resolve(PROJECT_ROOT, "vite.config.ts"),
    server: { middlewareMode: true, hmr: true },
    appType: "spa",
    customLogger: viteLogger,
  });

  app.use(vite.middlewares);

  // SPA fallback: serve index.html for non-API routes
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // Skip API routes
    if (url.startsWith("/api")) {
      return next();
    }

    try {
      const clientIndexPath = path.resolve(PROJECT_ROOT, "client", "index.html");
      let html = await fs.promises.readFile(clientIndexPath, "utf-8");
      html = await vite.transformIndexHtml(url, html);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });

  return vite;
}

export function serveStatic(app: Express): void {
  const distPath = path.resolve(PROJECT_ROOT, "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find production build at ${distPath}. Run "npm run build" first.`,
    );
  }

  app.use(express.static(distPath));

  // SPA fallback
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
