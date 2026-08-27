/**
 * SHA-256 of exact payload bytes as lowercase hex.
 *
 * Neutral kernel primitive for raw CAS identity. Compile provider-ledger
 * reads re-export this helper; resource ingress must import it here, not
 * from `domain/compile/source`.
 */

export async function fingerprintResourceBytes(
  bytes: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
