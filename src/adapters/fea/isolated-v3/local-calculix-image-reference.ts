/**
 * Profile-owned CalculiX Microsandbox worker identity.
 *
 * This is the catalogued inspectImage pin. Callers never select an image,
 * digest, tag, or backend. Candidate publication identity stays on the
 * first-party distribution matrix; this module never emits `latest`.
 */

/** Microsandbox inspectImage manifest. Product runtime imageReference. */
export const LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE =
  "casys/calculix-microsandbox-worker@sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771" as const;
