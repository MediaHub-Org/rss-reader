import { defineConfig, type Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { proxyFeedRequest } from './server/proxy-lib.mjs';

const localPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Dev-time CORS proxy mounted directly into the Vite dev/preview server, so
 * `npm run dev` works with no second process to start.
 *
 * The identical handler ships standalone as `npm run proxy` for anyone serving
 * the built bundle from a plain static host.
 */
function feedProxy(): Plugin {
  const handle = async (url: string | null, res: ServerResponse): Promise<boolean> => {
    if (!url) return false;
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    if (pathname !== '/proxy') return false;

    const result = await proxyFeedRequest(searchParams.get('url'), 12_000);
    res.statusCode = result.status;
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.end(result.body);
    return true;
  };

  const middleware = () =>
    async (
      req: { url?: string },
      res: ServerResponse,
      next: (error?: unknown) => void
    ) => {
      try {
        if (await handle(req.url ?? null, res)) return;
      } catch (err) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }
      next();
    };

  return {
    name: 'rss-feed-proxy',
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}

export default defineConfig({
  plugins: [react(), feedProxy()],
  resolve: {
    // rss-parser is a Node library; xml2js/sax touch these at module load.
    // Aliasing keeps the spec-mandated parser working in a browser bundle
    // without dragging in heavyweight polyfills.
    alias: [
      { find: /^events$/, replacement: localPath('./node_modules/events/events.js') },
      { find: /^timers$/, replacement: localPath('./src/shims/timers.js') },
      { find: /^stream$/, replacement: localPath('./src/shims/stream.js') },
    ],
  },
  server: { port: 5173 },
});
