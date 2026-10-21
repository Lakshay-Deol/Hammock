import { serve } from '@hono/node-server';
import { createHammockServer } from './app.js';

export function startServer(port = 3000): { close: () => void; port: number } {
  const app = createHammockServer();
  const server = serve({
    fetch: app.fetch,
    port,
  });

  console.log(`🦥 Hammock maintainer approval dashboard running at http://localhost:${port}`);
  return {
    close: () => server.close(),
    port,
  };
}

export { createHammockServer } from './app.js';
