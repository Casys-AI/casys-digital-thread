import { ASSET_DIGEST_SCHEMA } from "./contracts.ts";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256HexText(text: string): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(text));
}

/** One config digest over the exact packaged fleet and fixture bytes. */
export async function configDigestForAssets(
  fleetText: string,
  fixtureText: string,
): Promise<string> {
  const fleet = await sha256HexText(fleetText);
  const fixture = await sha256HexText(fixtureText);
  const envelope =
    `{"fixture":"${fixture}","fleet":"${fleet}","schema":"${ASSET_DIGEST_SCHEMA}"}`;
  return `sha256:${await sha256HexText(envelope)}`;
}
