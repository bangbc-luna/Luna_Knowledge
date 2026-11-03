const LOOPBACK_ALIASES: Record<string, string> = {
  localhost: '127.0.0.1',
  '127.0.0.1': 'localhost',
};

export function corsOrigins(origins: string[], nodeEnv: string): string[] {
  if (nodeEnv !== 'development') return origins;
  const result = new Set(origins);
  for (const origin of origins) {
    const url = URL.parse(origin);
    const alias = url && LOOPBACK_ALIASES[url.hostname];
    if (!url || !alias) continue;
    url.hostname = alias;
    result.add(url.origin);
  }
  return [...result];
}
