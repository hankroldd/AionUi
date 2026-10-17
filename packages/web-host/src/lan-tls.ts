/**
 * [mycowork] R061: built-in TLS listener for LAN access, and the advertised network URL.
 *
 * Every TLS connection (loopback or not) is handed to the in-process http.Server, so the A67 guard sees the real
 * remoteAddress of the TLSSocket.
 */
import type { Server as HttpServer } from 'node:http';
import tls from 'node:tls';

export type TlsListenerOptions = { cert: string | Buffer; key: string | Buffer; port: number; host?: string };

export async function startTlsListener(httpServer: HttpServer, opts: TlsListenerOptions): Promise<tls.Server> {
  const { cert, key, port, host = '0.0.0.0' } = opts;
  const srv = tls.createServer({ cert, key, minVersion: 'TLSv1.2' }, (sock) => {
    httpServer.emit('connection', sock);
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, host, () => {
      srv.off('error', reject);
      resolve();
    });
  });
  return srv;
}

/** https on the TLS port when there is one, else http on the plain port; undefined without a LAN IP. */
export function networkUrlFor(lanIP: string | undefined, plainPort: number, tlsPort: number | undefined): string | undefined {
  if (!lanIP) return undefined;
  return tlsPort ? `https://${lanIP}:${tlsPort}` : `http://${lanIP}:${plainPort}`;
}
