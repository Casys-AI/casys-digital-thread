/**
 * Exact work-item operation for sealing one technical compilation admission.
 *
 * The preview, not an agent, binds the selected SysML artifact to its exact
 * review Thread basis. The operation intentionally carries no provider,
 * executable, profile, source, or runtime detail.
 */

import { deepFreeze, exactRecord, safeId } from "../../kernel/case-validation.ts";
import type {
  EngineeringOperationRef,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../../project/thread-tip.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "./technical-compilation-proposal.ts";

export const TECHNICAL_COMPILATION_ADMISSION_BINDING_NAME = "sysmlModel" as const;
export const TECHNICAL_COMPILATION_ADMISSION_BINDING_SOURCE_KIND =
  "thread-entity" as const;
export const TECHNICAL_COMPILATION_ADMISSION_ARTIFACT_KIND = "artifact" as const;

const ASSEMBLY_PATH = "$technicalCompilationAdmissionOperation";

/** Exact SysML artifact named by the admission-seal work item. */
export interface TechnicalCompilationAdmissionArtifactRef
  extends EngineeringThreadEntityRef {
  readonly kind: typeof TECHNICAL_COMPILATION_ADMISSION_ARTIFACT_KIND;
}

/** Single closed binding of the reviewed SysML artifact. */
export interface TechnicalCompilationAdmissionBinding {
  readonly name: typeof TECHNICAL_COMPILATION_ADMISSION_BINDING_NAME;
  readonly source: {
    readonly kind: typeof TECHNICAL_COMPILATION_ADMISSION_BINDING_SOURCE_KIND;
    readonly reference: TechnicalCompilationAdmissionArtifactRef;
  };
}

/**
 * The MCP JSON shape remains `{ id, version, bindings }`, so callers can put
 * the returned value directly into the later appended work item.
 */
export interface TechnicalCompilationAdmissionOperation
  extends EngineeringOperationRef {
  readonly id: typeof COMPILE_SEAL_ADMISSION_OPERATION.id;
  readonly version: typeof COMPILE_SEAL_ADMISSION_OPERATION.version;
  readonly bindings: readonly [TechnicalCompilationAdmissionBinding];
}

/** Facts selected by the server after canonical admission-parameter parsing. */
export interface TechnicalCompilationAdmissionOperationInput {
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly sysmlArtifactId: string;
}

/**
 * Assemble the only admissible operation for a ready technical compilation.
 *
 * Do not accept a caller-selected operation identity: the domain owns the
 * exact seal operation, and the selected artifact is anchored to the exact
 * review basis rather than its historical creation snapshot.
 */
export function assembleTechnicalCompilationAdmissionOperation(
  input: TechnicalCompilationAdmissionOperationInput,
): TechnicalCompilationAdmissionOperation {
  const root = exactRecord(
    input,
    ["basis", "sysmlArtifactId"],
    ASSEMBLY_PATH,
  );
  const basis = parseExactThreadSnapshotBasis(
    root.basis,
    `${ASSEMBLY_PATH}.basis`,
  );
  const sysmlArtifactId = safeId(
    root.sysmlArtifactId,
    `${ASSEMBLY_PATH}.sysmlArtifactId`,
  );
  return deepFreeze({
    id: COMPILE_SEAL_ADMISSION_OPERATION.id,
    version: COMPILE_SEAL_ADMISSION_OPERATION.version,
    bindings: [{
      name: TECHNICAL_COMPILATION_ADMISSION_BINDING_NAME,
      source: {
        kind: TECHNICAL_COMPILATION_ADMISSION_BINDING_SOURCE_KIND,
        reference: {
          snapshotId: basis.snapshotId,
          snapshotRevision: basis.revision,
          kind: TECHNICAL_COMPILATION_ADMISSION_ARTIFACT_KIND,
          id: sysmlArtifactId,
        },
      },
    }],
  });
}
