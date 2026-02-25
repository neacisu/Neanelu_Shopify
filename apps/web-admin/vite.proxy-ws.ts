import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import * as net from 'node:net';
import type { Duplex } from 'node:stream';

const WS_PATH = '/api/queues/ws';

function parseTarget(target: string): { host: string; port: number } {
  const u = new URL(target);
  return { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
}

/**
 * Proxy WebSocket la backend prin pipe TCP direct, ca mesajele să nu se piardă (evită bug-uri proxy Vite).
 */
export function proxyQueuesWs(backendTarget: string): Plugin {
  const { host, port } = parseTarget(backendTarget);

  return {
    name: 'neanelu-proxy-queues-ws',
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;

      const originalListeners = httpServer.listeners('upgrade');
      httpServer.removeAllListeners('upgrade');

      httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = req.url ?? '';
        if (url.startsWith(WS_PATH)) {
          const backend = net.createConnection({ host, port }, () => {
            const requestLine = `GET ${url} HTTP/1.1\r\n`;
            const headers: string[] = [];
            headers.push(`Host: ${host}:${port}`);
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              const key = req.rawHeaders[i];
              const val = req.rawHeaders[i + 1];
              if (key && key.toLowerCase() !== 'host') headers.push(`${key}: ${val}`);
            }
            headers.push('\r\n');
            backend.write(requestLine + headers.join('\r\n'));
            backend.write(head);
            socket.pipe(backend);
            backend.pipe(socket);
          });

          backend.on('error', (err) => {
            server.config.logger.error(`[proxy-ws] backend: ${err.message}`);
            socket.destroy();
          });
          socket.on('error', (err) => {
            server.config.logger.error(`[proxy-ws] client: ${err.message}`);
            backend.destroy();
          });
          return;
        }

        for (const fn of originalListeners) {
          (fn as (req: IncomingMessage, socket: Duplex, head: Buffer) => void)(req, socket, head);
        }
      });
    },
  };
}
