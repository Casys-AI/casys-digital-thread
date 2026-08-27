/**
 * Named work-item operation for one later admitted isolated run.
 *
 * The bound artifact is the selected `compile.seal-admission@3` document. The
 * thread-entity snapshot is the current review basis, never the historical
 * creation revision of that admission. Registered operation identity is an
 * input: CAD, Modelica, and SPICE constants stay in those domains.
 */

import {
  deepFreeze,
  exactRecord,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import type {
  EngineeringOperationRef,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../../project/thread-tip.ts";

export const COMPILATION_ADMISSION_BINDING_NAME = "compilationAdmission" as const;
export const COMPILATION_ADMISSION_BINDING_SOURCE_KIND = "thread-entity" as const;
export const COMPILATION_ADMISSION_ARTIFACT_KIND = "artifact" as const;

const ASSEMBLY_PATH = "$compilationAdmissionRunOperation";

/** Exact Thread artifact named by one `compilationAdmission` binding. */
export interface CompilationAdmissionRunArtifactRef extends EngineeringThreadEntityRef {
  readonly kind: typeof COMPILATION_ADMISSION_ARTIFACT_KIND;
}

/** Single closed binding: one compilationAdmission thread-entity artifact. */
export interface CompilationAdmissionRunBinding {
  readonly name: typeof COMPILATION_ADMISSION_BINDING_NAME;
  readonly source: {
    readonly kind: typeof COMPILATION_ADMISSION_BINDING_SOURCE_KIND;
    readonly reference: CompilationAdmissionRunArtifactRef;
  };
}

/**
 * Registered admitted-compilation execution operation. JSON stays
 * `{ id, version, bindings }` so MCP clients can reuse it verbatim.
 */
export interface CompilationAdmissionRunOperation extends EngineeringOperationRef {
  readonly bindings: readonly [CompilationAdmissionRunBinding];
}

/** Facts required to assemble one closed admitted-compilation run operation. */
export interface CompilationAdmissionRunOperationInput {
  readonly operation: {
    readonly id: string;
    readonly version: string;
  };
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
}

export function assembleCompilationAdmissionRunOperation(
  input: CompilationAdmissionRunOperationInput,
): CompilationAdmissionRunOperation {
  const root = exactRecord(
    input,
    ["operation", "basis", "artifactId"],
    ASSEMBLY_PATH,
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    `${ASSEMBLY_PATH}.operation`,
  );
  const id = safeId(operation.id, `${ASSEMBLY_PATH}.operation.id`);
  const version = safeVersion(
    operation.version,
    `${ASSEMBLY_PATH}.operation.version`,
  );
  const basis = parseExactThreadSnapshotBasis(
    root.basis,
    `${ASSEMBLY_PATH}.basis`,
  );
  const artifactId = safeId(root.artifactId, `${ASSEMBLY_PATH}.artifactId`);
  const assembled: CompilationAdmissionRunOperation = {
    id,
    version,
    bindings: [{
      name: COMPILATION_ADMISSION_BINDING_NAME,
      source: {
        kind: COMPILATION_ADMISSION_BINDING_SOURCE_KIND,
        reference: {
          snapshotId: basis.snapshotId,
          snapshotRevision: basis.revision,
          kind: COMPILATION_ADMISSION_ARTIFACT_KIND,
          id: artifactId,
        },
      },
    }],
  };
  return deepFreeze(assembled);
}
