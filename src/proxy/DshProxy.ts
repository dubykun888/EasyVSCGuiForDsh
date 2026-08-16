import * as http from 'http';
import * as net from 'net';
import { log } from '../util/logger';

export type ProxyTheme = 'light' | 'dark';

export interface DshProxyOptions {
  upstreamPort: number;
  theme: ProxyTheme;
}

/**
 * Local HTTP/WebSocket reverse proxy used only for the VS Code side bar.
 * It forwards to the real dsh port and rewrites theme-related payloads so the
 * embedded UI can follow the VS Code theme without touching the dsh service.
 */
export class DshProxy {
  private server?: http.Server;
  private port = 0;
  private upstreamPort: number;
  private theme: ProxyTheme;
  private readonly sockets = new Set<net.Socket>();

  constructor(options: DshProxyOptions) {
    this.upstreamPort = options.upstreamPort;
    this.theme = options.theme;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get portNumber(): number {
    return this.port;
  }

  get upstreamPortNumber(): number {
    return this.upstreamPort;
  }

  setTheme(theme: ProxyTheme): void {
    this.theme = theme;
  }

  async start(): Promise<number> {
    if (this.server) {
      return this.port;
    }
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        server.removeListener('error', reject);
        resolve();
      });
    });
    log(`DshProxy listening on 127.0.0.1:${this.port} -> 127.0.0.1:${this.upstreamPort}`);
    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const socket of this.sockets) {
        socket.destroy();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: this.upstreamPort,
        path: req.url ?? '/',
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${this.upstreamPort}` },
      },
      (upRes) => {
        const headers = { ...upRes.headers };
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];

        const contentType = String(headers['content-type'] ?? '');
        const contentEncoding = String(headers['content-encoding'] ?? 'identity').toLowerCase();
        const canRewrite =
          (contentType.includes('text/html') || contentType.includes('application/json')) &&
          (contentEncoding === '' || contentEncoding === 'identity');
        if (canRewrite) {
          delete headers['content-length'];
          const chunks: Buffer[] = [];
          upRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          upRes.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const rewritten = this.rewriteBody(body, contentType);
            res.writeHead(upRes.statusCode ?? 200, headers);
            res.end(rewritten);
          });
          upRes.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(502);
            }
            res.end();
          });
        } else {
          res.writeHead(upRes.statusCode ?? 200, headers);
          upRes.pipe(res);
        }
      }
    );
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
      }
      res.end('proxy error');
    });
    req.pipe(upstream);
  }

  private rewriteBody(body: string, contentType: string): string {
    if (contentType.includes('text/html')) {
      // Initial theme bootstrap injected by dsh.
      body = body.replace(/preference\s*=\s*["']system["']/g, `preference = "${this.theme}"`);
      body = body.replace(/preference:\s*["']system["']/g, `preference: "${this.theme}"`);
      body = body.replace(/["']system["']\s*===?\s*preference/g, `"${this.theme}" === preference`);
    }
    if (contentType.includes('application/json')) {
      body = body.replace(/"preference"\s*:\s*"system"/g, `"preference":"${this.theme}"`);
      body = body.replace(/"ui-theme"\s*:\s*\{([^}]*)"preference"\s*:\s*"system"/g, `"ui-theme":{$1"preference":"${this.theme}"`);
    }
    return body;
  }

  private handleUpgrade(req: http.IncomingMessage, socket: import('stream').Duplex, head: Buffer): void {
    const upstream = net.connect(this.upstreamPort, '127.0.0.1', () => {
      const headers = { ...req.headers, host: `127.0.0.1:${this.upstreamPort}` };
      const headerLines = Object.entries(headers).map(([key, value]) => {
        const v = Array.isArray(value) ? value.join(', ') : String(value);
        return `${key}: ${v}`;
      });
      const raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headerLines.join('\r\n')}\r\n\r\n`;
      upstream.write(raw);
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  }
}
