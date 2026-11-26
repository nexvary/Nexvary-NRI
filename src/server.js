import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { modules } from './content.js';
import { render } from './render.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const stylesheet = readFileSync(new URL('../public/styles.css', import.meta.url));

export function createApp() {
  return createServer((req, res) => {
    const headers = {
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
      return;
    }

    if (!req.url?.startsWith('/')) {
      res.writeHead(400, headers).end();
      return;
    }

    const { pathname, searchParams } = new URL(`http://localhost${req.url}`);
    if (pathname === '/styles.css') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/css; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : stylesheet);
      return;
    }

    const lang = searchParams.get('lang') === 'en' ? 'en' : 'ar';
    const requestedView = searchParams.get('view') ?? 'dashboard';
    const available = pathname === '/' && (Object.hasOwn(modules, requestedView) || requestedView === 'developer');
    const view = available ? requestedView : 'not-found';

    res.writeHead(available ? 200 : 404, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': lang });
    res.end(req.method === 'HEAD' ? undefined : render({ lang, view, version }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  const app = createApp().listen(port, host, () => {
    const { address, port: selectedPort } = app.address();
    const displayAddress = address.includes(':') ? `[${address}]` : address;
    console.log(`NRI preview: http://${displayAddress}:${selectedPort}`);
  });
}
