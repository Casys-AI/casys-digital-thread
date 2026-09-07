import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { REQUIREMENTS_CAPTURE_URI_PREFIX } from "../../../domain/thread/requirements-tip.ts";

export function requirementsUriPrefix(containerComponent: string): string {
  return `${REQUIREMENTS_CAPTURE_URI_PREFIX}${containerComponent}/`;
}

export function requirementsUriFor(
  containerComponent: string,
  fingerprint: ContentFingerprint,
): string {
  return `${requirementsUriPrefix(containerComponent)}sha256/${fingerprint.digest}`;
}

export function requirementsArtifactId(
  containerComponent: string,
  digest: string,
): string {
  return `requirements-${containerComponent}-${digest}`;
}
