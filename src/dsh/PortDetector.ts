import * as http from 'http';
import * as net from 'net';
import { PortCheckResult } from './types';
import { log } from '../util/logger';

const DSH_PAGE_MARKERS = ['__DSH_BOOT__', 'deepseek-harness', 'dsh-typert-registry', 'dsh-client-connection'];

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        log(`Port probe error on ${port}: ${err.message}`);
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

export async function checkPort(port: number, timeoutMs = 3000): Promise<PortCheckResult> {
  const free = await isPortFree(port);
  if (free) {
    return { occupied: false, isDsh: false };
  }
  const detail = await probeDsh(port, timeoutMs);
  if (detail) {
    return { occupied: true, isDsh: true, statusCode: detail.statusCode, detail: detail.bodySnippet };
  }
  return { occupied: true, isDsh: false };
}

async function probeDsh(port: number, timeoutMs: number): Promise<{ statusCode: number; bodySnippet: string } | undefined> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        timeout: timeoutMs,
        headers: { 'User-Agent': 'EasyVSCGuiForDsh' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          const body = Buffer.concat(chunks).toString('utf8');
          if (total > 128 * 1024) {
            req.destroy();
            if (isDshBody(body)) {
              resolve({ statusCode: res.statusCode ?? 0, bodySnippet: body.slice(0, 2048) });
            } else {
              resolve(undefined);
            }
          }
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (isDshBody(body)) {
            resolve({ statusCode: res.statusCode ?? 0, bodySnippet: body.slice(0, 2048) });
          } else {
            resolve(undefined);
          }
        });
        res.on('error', () => resolve(undefined));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
    req.on('error', () => resolve(undefined));
  });
}

export function isDshBody(body: string): boolean {
  const lower = body.toLowerCase();
  return DSH_PAGE_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

export async function waitForDsh(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    const result = await checkPort(port, 2000);
    if (result.occupied && result.isDsh) {
      return true;
    }
    if (result.occupied && !result.isDsh) {
      lastError = `Port ${port} is occupied by a non-dsh application`;
      break;
    }
    lastError = `Port ${port} not ready`;
    await sleep(500);
  }
  log(`waitForDsh failed: ${lastError}`);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
