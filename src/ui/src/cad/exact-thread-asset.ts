/**
 * Workbench GET href for an exact sha256-bound STEP or GLB. Missing, bare,
 * or mismatched identities fail closed — `undefined === undefined` must
 * never revive an arbitrary URI.
 */
export function exactThreadAssetHref(
  uri: string | undefined,
  fingerprint: string | undefined,
  extension: "step" | "glb",
): string | undefined {
  if (uri === undefined || fingerprint === undefined) return undefined;
  const digest = fingerprint.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  if (digest === undefined) return undefined;
  const expected = `/api/thread/assets/${digest}.${extension}`;
  return uri === expected ? uri : undefined;
}
