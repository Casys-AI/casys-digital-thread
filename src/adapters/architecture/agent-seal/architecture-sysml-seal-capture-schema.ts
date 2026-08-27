/**
 * Canonical `architecture-sysml-seal-capture/1.0` schema.
 *
 * Single owner of the seal-capture shape, shared by the seal executor
 * (writer) and the Workbench enricher (reader): a projector must never import
 * an executor to validate evidence, and a schema change must break both sides
 * at the same import site instead of silently drifting.
 */

import { EngineeringProjectCommandError } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type ArchitectureSysmlSealAdmission,
  encodeArchitectureSysmlSealParameters,
  MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  parseArchitectureSysmlSealParameters,
} from "../../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import {
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import {
  type ArchitectureSysmlSourceAnalysisReference,
  validateArchitectureSysmlSourceAnalysisCaptureDocument,
} from "./architecture-sysml-source-analysis-capture.ts";

export const ARCHITECTURE_SYSML_SEAL_CAPTURE_SCHEMA =
  "architecture-sysml-seal-capture/1.0" as const;
export const ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX =
  "casys://architecture-sysml-seal-capture/sha256/" as const;

export interface ArchitectureSysmlSealCapture {
  readonly schemaVersion: typeof ARCHITECTURE_SYSML_SEAL_CAPTURE_SCHEMA;
  readonly kind: "architecture-sysml-seal";
  readonly operation: typeof MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION;
  readonly trustedRunId: string;
  readonly decisionId: string;
  readonly sealedAt: string;
  readonly admission: ArchitectureSysmlSealAdmission;
  readonly sourceCapture: ArchitectureSysmlSourceAnalysisReference;
  readonly unresolvedConstructs: readonly {
    readonly id: string;
    readonly kind: string;
  }[];
}

export function assertAdmissionMatchesCapture(
  admission: ArchitectureSysmlSealAdmission,
  reference: ArchitectureSysmlSourceAnalysisReference,
): void {
  if (
    reference.source.id !== admission.sourceId ||
    reference.profile.id !== admission.profile.id ||
    reference.profile.version !== admission.profile.version ||
    !fingerprintsEqual(reference.profile.fingerprint, admission.profile.fingerprint) ||
    reference.source.sha256 !== admission.source.sha256 ||
    reference.source.byteCount !== admission.source.byteCount ||
    reference.source.casUri !== admission.source.casUri ||
    reference.analysis.analyzer.id !== admission.analysis.analyzer.id ||
    reference.analysis.analyzer.version !== admission.analysis.analyzer.version ||
    reference.analysis.policy.profile !== admission.analysis.policy.profile ||
    reference.analysis.policy.status !== admission.analysis.policy.status ||
    reference.analysis.sha256 !== admission.analysis.sha256 ||
    reference.analysis.byteCount !== admission.analysis.byteCount ||
    reference.analysis.casUri !== admission.analysis.casUri
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The reopened architecture SysML capture does not match the signed admission identities.",
    );
  }
}

export function validateArchitectureSysmlSealCapture(
  value: unknown,
): ArchitectureSysmlSealCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "admission",
    "sourceCapture",
    "unresolvedConstructs",
  ], "$architectureSysmlSealCapture");
  literalValue(
    root.schemaVersion,
    ARCHITECTURE_SYSML_SEAL_CAPTURE_SCHEMA,
    "$architectureSysmlSealCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "architecture-sysml-seal",
    "$architectureSysmlSealCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$architectureSysmlSealCapture.operation",
  );
  literalValue(
    operation.id,
    MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.id,
    "$architectureSysmlSealCapture.operation.id",
  );
  literalValue(
    operation.version,
    MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION.version,
    "$architectureSysmlSealCapture.operation.version",
  );
  if (typeof root.sealedAt !== "string" || Number.isNaN(Date.parse(root.sealedAt))) {
    throw new TypeError("$architectureSysmlSealCapture.sealedAt must be ISO-8601.");
  }
  const admission = parseArchitectureSysmlSealParameters(
    encodeArchitectureSysmlSealParameters(root.admission),
  );
  const sourceCapture = validateArchitectureSysmlSourceAnalysisCaptureDocument(
    root.sourceCapture,
    "$architectureSysmlSealCapture.sourceCapture",
  );
  assertAdmissionMatchesCapture(admission, sourceCapture);
  if (!Array.isArray(root.unresolvedConstructs)) {
    throw new TypeError(
      "$architectureSysmlSealCapture.unresolvedConstructs must be an array.",
    );
  }
  const unresolvedConstructs = root.unresolvedConstructs.map((item, index) => {
    const construct = exactRecord(
      item,
      ["id", "kind"],
      `$architectureSysmlSealCapture.unresolvedConstructs[${index}]`,
    );
    return {
      id: safeId(
        construct.id,
        `$architectureSysmlSealCapture.unresolvedConstructs[${index}].id`,
      ),
      kind: safeId(
        construct.kind,
        `$architectureSysmlSealCapture.unresolvedConstructs[${index}].kind`,
      ),
    };
  });
  return {
    schemaVersion: ARCHITECTURE_SYSML_SEAL_CAPTURE_SCHEMA,
    kind: "architecture-sysml-seal",
    operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$architectureSysmlSealCapture.trustedRunId",
    ),
    decisionId: safeId(root.decisionId, "$architectureSysmlSealCapture.decisionId"),
    sealedAt: root.sealedAt,
    admission,
    sourceCapture,
    unresolvedConstructs,
  };
}
