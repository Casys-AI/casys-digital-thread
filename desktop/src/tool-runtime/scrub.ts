/**
 * Renderer-bound text scrubbing for runtime sentences (#57).
 *
 * Zero-dependency on purpose: chat-side modules (bundled for Node) import
 * from here without pulling the Docker graph. Digests, container ids, and
 * loopback ports belong in diagnostics, never in the ordinary workflow.
 */

export function scrubRendererText(text: string): string {
  return text.replace(/sha256:[a-f0-9]{64}/gi, "sha256:<digest>");
}

/** Redacts container ids and loopback ports. Applied after scrubRendererText. */
export function scrubRuntimeIdentity(text: string): string {
  return scrubRendererText(text)
    .replace(/\b[0-9a-f]{12,64}\b/g, "<id>")
    .replace(/127\.0\.0\.1:\d{1,5}/g, "127.0.0.1:<port>")
    .replace(/localhost:\d{1,5}/g, "localhost:<port>");
}
