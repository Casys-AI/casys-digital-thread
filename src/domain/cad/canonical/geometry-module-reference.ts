/**
 * Exact identity of canonical geometry-module evidence.
 *
 * This is deliberately independent from any observer, evaluator, or provider.
 * Consumers use it to reopen one immutable geometry-module capture; they do
 * not infer a moving primary artifact or select a CAD runtime from it.
 */

import { GEOMETRY_MODULE_CAPTURE_SCHEMA } from "../geometry-module-contract.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import { validateContentFingerprint } from "../../compile/isolation/isolated-code-execution.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export interface GeometryModuleReference {
  readonly schemaVersion: typeof GEOMETRY_MODULE_CAPTURE_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
}

/** Parse the closed identity shared by static geometry consumers. */
export function validateGeometryModuleReference(
  value: unknown,
  path = "$geometryModuleReference",
): GeometryModuleReference {
  const root = exactRecord(value, ["schemaVersion", "artifactId", "fingerprint"], path);
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    artifactId: safeId(root.artifactId, `${path}.artifactId`),
    fingerprint: validateContentFingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}
