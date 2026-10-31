import { defineConfig, type Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { proxyFeedRequest } from './server/proxy-lib.mjs';

const localPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const pkg = JSON.parse(readFileSync(localPath('./package.json'), 'utf8')) as { version: string };

/**
 * Dev-time CORS proxy mounted directly into the Vite dev/preview server, so
 * `npm run dev` works with no second process to start.
 *
 * The identical handler ships standalone as `npm run proxy` for anyone serving
 * the built bundle from a plain static host.
 */
/** Give every production build a unique service-worker cache name. */
function serviceWorkerVersion(): Plugin {
  return {
    name: 'rss-reader-sw-version',
    closeBundle() {
      const file = localPath('./dist/sw.js');
      const version = `${pkg.version}-${Date.now()}`;
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_VERSION__', version));
    },
  };
}

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
  plugins: [react(), feedProxy(), serviceWorkerVersion()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
