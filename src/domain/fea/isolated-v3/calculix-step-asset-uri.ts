/**
 * Exact, pure URI identities for a CalculiX STEP source.
 *
 * Active Thread geometry exposes bytes through a public content-addressed
 * route.  A resolved plan seals the equivalent internal CAS identity; neither
 * boundary accepts aliases, suffixes or a caller-selected namespace.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { ThreadArtifact } from "../../thread/thread-snapshot.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const PUBLIC_THREAD_STEP_URI = /^\/api\/thread\/assets\/([a-f0-9]{64})\.step$/;

type CalculixStepArtifactIdentity = Pick<
  ThreadArtifact,
  "id" | "kind" | "mediaType" | "uri" | "fingerprint"
>;

export function canonicalCalculixStepPlanCasUri(
  fingerprint: ContentFingerprint,
): string {
  if (
    fingerprint.algorithm !== "sha256" || !SHA256.test(fingerprint.digest)
  ) {
    throw new TypeError("CalculiX STEP fingerprint must be exact lowercase SHA-256.");
  }
  return `casys://thread-asset/sha256/${fingerprint.digest}`;
}

export function canonicalCalculixStepAssetCasUri(
  artifact: CalculixStepArtifactIdentity,
): string {
  const canonicalCasUri = canonicalCalculixStepPlanCasUri(artifact.fingerprint);
  const publicMatch = artifact.uri ? PUBLIC_THREAD_STEP_URI.exec(artifact.uri) : null;
  if (
    artifact.kind !== "step" || artifact.mediaType !== "model/step" ||
    !publicMatch || publicMatch[1] !== artifact.fingerprint.digest
  ) {
    throw new TypeError(
      `Thread artifact ${artifact.id} is not its exact canonical public STEP asset.`,
    );
  }
  return canonicalCasUri;
}
