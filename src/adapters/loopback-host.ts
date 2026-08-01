const LOOPBACK_HOSTNAMES = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
]);

export function isExplicitLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/** Reject DNS-rebinding aliases even when Origin and Host agree with each other. */
export function requestUsesExplicitLoopbackHost(request: Request): boolean {
  if (!isExplicitLoopbackHostname(new URL(request.url).hostname)) return false;
  const host = request.headers.get("Host");
  if (!host) return true;
  try {
    return isExplicitLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
