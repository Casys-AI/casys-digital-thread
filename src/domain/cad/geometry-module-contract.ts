/**
 * Shared geometry-module literal identities.
 *
 * Runtime input-bundle encoding and canonical module evidence both import
 * these strings. This module must not import module-assembly or evidence
 * parsers: those sides consume the contract, never the reverse.
 */

import { GEOMETRY_BUNDLE_PLACEMENT_CONVENTION } from "./canonical/geometry-bundle.ts";
import {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_TARGET_CAPTURE_SCHEMAS,
  type GeometryTargetCaptureSchema,
} from "./geometry-capture-contract.ts";

export { GEOMETRY_MODULE_CAPTURE_SCHEMA };
export const GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA =
  "geometry-module-input-bundle/1.0" as const;
export const GEOMETRY_MODULE_UNIT_SYSTEM = "mm" as const;
export const GEOMETRY_MODULE_PLACEMENT_CONVENTION =
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION;
export const GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE = "model/step" as const;
export const GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS = Object.freeze(
  GEOMETRY_TARGET_CAPTURE_SCHEMAS,
);

export type GeometryModuleChildCaptureSchema = GeometryTargetCaptureSchema;
