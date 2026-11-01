export type SecurityHeader = { key: string; value: string };

type Options = { mediaOrigin?: string; collabOrigin?: string; liveKitOrigin?: string; isDev: boolean };

const DEV_ORIGINS = "http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*";

function sources(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(" ");
}

function liveKitSources(origin?: string): string[] {
  if (!origin) return [];
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return [origin];
  }
  const out = [`wss://${url.host}`, `https://${url.host}`];
  if (url.hostname.endsWith(".livekit.cloud")) out.push("wss://*.livekit.cloud", "https://*.livekit.cloud");
  return out;
}

export function securityHeaders({ mediaOrigin, collabOrigin, liveKitOrigin, isDev }: Options): SecurityHeader[] {
  const dev = isDev && DEV_ORIGINS;
  const directives = [
    "default-src 'self'",
    `script-src ${sources("'self'", "'unsafe-inline'", isDev && "'unsafe-eval'")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${sources("'self'", "blob:", "data:", mediaOrigin, "https://*.googleusercontent.com", dev)}`,
    `media-src ${sources("'self'", "blob:", mediaOrigin, dev)}`,
    `connect-src ${sources("'self'", mediaOrigin, collabOrigin, ...liveKitSources(liveKitOrigin), dev)}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    !isDev && "upgrade-insecure-requests",
  ].filter(Boolean);

  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
  ];
  if (!isDev) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
}
