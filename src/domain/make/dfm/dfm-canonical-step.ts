/**
 * DFM-labelled facade over the shared CAD write-geometry STEP attestation.
 * Labels stay "DFM case target"; the identity algorithm lives in CAD.
 */

import {
  attestCanonicalWriteGeometryStep as attestSharedCanonicalWriteGeometryStep,
  DESIGN_WRITE_GEOMETRY_TOOL,
  FORBIDDEN_CANONICAL_GEOMETRY_TOOLS,
  isForbiddenGeometryTool,
  parseWriteGeometryStepOwner,
  WRITE_GEOMETRY_CAPTURE_URI_PREFIX,
} from "../../cad/canonical/canonical-write-geometry-step.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";

export {
  DESIGN_WRITE_GEOMETRY_TOOL,
  isForbiddenGeometryTool,
  parseWriteGeometryStepOwner,
  WRITE_GEOMETRY_CAPTURE_URI_PREFIX,
};

export const FORBIDDEN_DFM_GEOMETRY_TOOLS = FORBIDDEN_CANONICAL_GEOMETRY_TOOLS;

export type DfmCanonicalStepRefusalCode =
  | "media-type"
  | "sha256"
  | "isolated"
  | "parent-absent"
  | "parent-ambiguous"
  | "parent-isolated"
  | "parent-not-canonical"
  | "not-canonical";

export type DfmCanonicalStepAttestation =
  | {
    readonly status: "attested";
    readonly step: ThreadArtifact;
    readonly geometry: ThreadArtifact;
  }
  | {
    readonly status: "refused";
    readonly code: DfmCanonicalStepRefusalCode;
    readonly message: string;
  };

export function attestCanonicalWriteGeometryStep(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  expectedSha256?: string,
): DfmCanonicalStepAttestation {
  return attestSharedCanonicalWriteGeometryStep(
    snapshot,
    artifact,
    expectedSha256,
    { role: "DFM case target" },
  );
}
