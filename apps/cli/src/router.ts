import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string | undefined>) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

/**
 * Minimal HTTP router — matches method + path pattern, extracts named params.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    const regexStr = path.replace(/:([^/]+)/g, (_, name: string) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({ method: method.toUpperCase(), pattern: new RegExp(`^${regexStr}$`), paramNames, handler });
  }

  get(path: string, handler: Handler): void { this.add('GET', path, handler); }
  post(path: string, handler: Handler): void { this.add('POST', path, handler); }
  put(path: string, handler: Handler): void { this.add('PUT', path, handler); }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split('?')[0] ?? '/';
    const method = req.method?.toUpperCase() ?? 'GET';

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(url);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => { params[name] = match[i + 1] ?? ''; });
      await route.handler(req, res, params);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Not found', errorCode: 'NOT_FOUND' }));
  }
}

/** Parse query string from request URL. */
export function parseQuery(req: IncomingMessage): Record<string, string> {
  const raw = req.url?.split('?')[1] ?? '';
  const result: Record<string, string> = {};
  for (const part of raw.split('&')) {
    const [k, v] = part.split('=');
    if (k) result[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return result;
}

/** Read and parse JSON body. */
export async function readBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T); }
      catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    });
    req.on('error', (e) => { reject(e); });
  });
}

/** Send a JSON response. */
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function ok(res: ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data });
}

export function actionOk(res: ServerResponse, message: string, extra?: Record<string, unknown>): void {
  json(res, 200, { success: true, message, ...extra });
}

export function notFound(res: ServerResponse, errorCode: string, message: string): void {
  json(res, 404, { success: false, message, errorCode });
}

export function badRequest(res: ServerResponse, errorCode: string, message: string): void {
  json(res, 400, { success: false, message, errorCode });
}

export function conflict(res: ServerResponse, errorCode: string, message: string): void {
  json(res, 409, { success: false, message, errorCode });
}

export function serverError(res: ServerResponse, message: string): void {
  json(res, 500, { success: false, message, errorCode: 'INTERNAL_ERROR' });
}
