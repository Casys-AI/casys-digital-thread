/**
 * Document CSP for the static Lot 1 shell. Inline CSS is the only extra
 * capability; scripts, images, fonts, network, frames, and forms stay closed.
 */
export const DESKTOP_SHELL_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; object-src 'none'; script-src 'none'; " +
  "style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; " +
  "connect-src 'none'; media-src 'none'; worker-src 'none'; " +
  "manifest-src 'none'";

const DESKTOP_SHELL_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": DESKTOP_SHELL_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/** Pure helper: safe headers for the rendered desktop shell document. */
export function desktopShellResponseHeaders(): Record<string, string> {
  return { ...DESKTOP_SHELL_RESPONSE_HEADERS };
}
