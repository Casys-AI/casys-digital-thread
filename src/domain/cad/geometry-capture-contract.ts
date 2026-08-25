/** Literal identities shared by canonical target-geometry capture families. */

import type { ContentFingerprint } from "../kernel/primitives.ts";

export const GEOMETRY_PART_CAPTURE_SCHEMA = "geometry-part-capture/1.0" as const;
export const GEOMETRY_MODULE_CAPTURE_SCHEMA = "geometry-module-capture/1.0" as const;

export const GEOMETRY_TARGET_CAPTURE_SCHEMAS = Object.freeze(
  [GEOMETRY_PART_CAPTURE_SCHEMA, GEOMETRY_MODULE_CAPTURE_SCHEMA] as const,
);

export type GeometryTargetCaptureSchema =
  (typeof GEOMETRY_TARGET_CAPTURE_SCHEMAS)[number];

/** Exact active same-target tip signed by either target capture family. */
export interface GeometryTargetPredecessor {
  readonly schemaVersion: GeometryTargetCaptureSchema;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly partDefinitionElementId: string;
}
