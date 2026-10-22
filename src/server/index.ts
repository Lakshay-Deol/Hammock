import { serve } from '@hono/node-server';
import { createHammockServer } from './app.js';

export function startServer(port?: number): { close: () => void; port: number } {
  const listenPort = port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
  const app = createHammockServer();
  const server = serve({
    fetch: app.fetch,
    port: listenPort,
  });

  console.log(`🦥 Hammock maintainer approval dashboard running at http://localhost:${listenPort}`);
  return {
    close: () => server.close(),
    port: listenPort,
  };
}

export { createHammockServer } from './app.js';
