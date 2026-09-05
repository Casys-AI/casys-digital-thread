/**
 * Profile-owned CalculiX Microsandbox worker identity.
 *
 * This is the catalogued inspectImage pin. Callers never select an image,
 * digest, tag, or backend. Candidate publication identity stays on the
 * first-party distribution matrix; this module never emits `latest`.
 */

/** Microsandbox inspectImage manifest. Product runtime imageReference. */
export const LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE =
  "casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2" as const;
