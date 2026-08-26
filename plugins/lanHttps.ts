import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { listLanHosts } from './remoteCamHub';

const { generate } = createRequire(import.meta.url)('selfsigned') as {
  generate: (
    attrs: Array<{ name: string; value: string }>,
    options: {
      days?: number;
      keySize?: number;
      algorithm?: string;
      extensions?: Array<{
        name: string;
        altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }>;
      }>;
    },
  ) => { private: string; cert: string };
};

/**
 * Keep Vite on HTTP so phones/WeChat can open the QR.
 * Optional HTTPS on port+1 for Safari gyro after the user trusts the cert.
 */
export function lanHttps(): Plugin {
  const { key, cert } = makeLanCertificate();
  return {
    name: 'lan-https-sidecar',
    configureServer(server) {
      attachSidecar(server, key, cert, server.config.server.port ?? 5173);
    },
    configurePreviewServer(server) {
      attachSidecar(server, key, cert, server.config.preview.port ?? 4173);
    },
  };
}

function attachSidecar(
  server: ViteDevServer | PreviewServer,
  key: string,
  cert: string,
  fallbackPort: number,
): void {
  const start = () => {
    const addr = server.httpServer?.address();
    const httpPort = typeof addr === 'object' && addr ? (addr as AddressInfo).port : fallbackPort;
    const httpsServer = createServer({ key, cert }, server.middlewares);
    httpsServer.on('error', (err) => {
      console.warn(`[lan-https] ${httpPort + 1} ${err.message}`);
    });
    httpsServer.listen(httpPort + 1, '0.0.0.0', () => {
      console.log(`  ➜  Phone HTTPS (optional gyro): https://localhost:${httpPort + 1}/`);
    });
    server.httpServer?.once('close', () => httpsServer.close());
  };

  if (server.httpServer?.listening) start();
  else server.httpServer?.once('listening', start);
}

function makeLanCertificate(): { key: string; cert: string } {
  const altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  for (const host of listLanHosts()) {
    altNames.push({ type: 7, ip: host.ip });
  }

  const pems = generate([{ name: 'commonName', value: 'localhost' }], {
    days: 825,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  return { key: pems.private, cert: pems.cert };
}
