import type { ServerResponse } from "node:http";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(payload);
}

/** JSON response carrying the entity version as a weak ETag. */
export function sendVersioned(
  res: ServerResponse,
  status: number,
  body: { version: number },
): void {
  sendJson(res, status, body, { ETag: `W/"${body.version}"` });
}

/** Used by the legacy label-printer endpoint in the parts module. */
export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    ...SECURITY_HEADERS,
  });
  res.end(html);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, SECURITY_HEADERS);
  res.end();
}
