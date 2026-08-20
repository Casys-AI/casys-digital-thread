/**
 * Keep technical identities recognizable without letting them dominate a
 * reading surface. This function changes presentation only; callers retain
 * the complete value for accessible names, copying, and exact records.
 */
export function compactTechnicalIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 28) return trimmed;

  const shaPrefix = trimmed.startsWith("sha256:") ? "sha256:" : "";
  const body = shaPrefix ? trimmed.slice(shaPrefix.length) : trimmed;
  if (/^[a-f0-9]{64}$/.test(body)) {
    return `${shaPrefix}${body.slice(0, 12)}…${body.slice(-6)}`;
  }
  if (
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
      .test(trimmed)
  ) {
    return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
  }
  return `${trimmed.slice(0, 16)}…${trimmed.slice(-8)}`;
}

/**
 * Compact each segment of a technical summary (`step · <sha256>`), leaving the
 * human-readable segments untouched. Presentation only: callers keep the
 * complete string for the accessible name and for copying.
 */
export function compactTechnicalSummary(value: string): string {
  return value
    .split(" · ")
    .map((segment) => compactTechnicalIdentifier(segment))
    .join(" · ");
}

/**
 * Shorten fingerprints *embedded inside* a label
 * (`geometry-preview-<64 hex>-assembly`), where the identity is glued to
 * readable words rather than isolated in its own segment. Presentation only:
 * the complete label stays available for the accessible name and for copying.
 */
export function compactEmbeddedFingerprints(value: string): string {
  return value.replace(
    /[a-f0-9]{32,}/g,
    (match) => `${match.slice(0, 12)}…${match.slice(-6)}`,
  );
}
