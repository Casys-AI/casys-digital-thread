/**
 * Read-only preparation for `verify.observe-assembly-integrity@1`.
 *
 * The injected resolver is the sole authority for reopening the exact current
 * Thread and primary geometry module. This use case only closes the public
 * command, verifies the returned signed identity against it, and compiles the
 * normal append/propose review path. It has no provider, executor or write.
 */

import type {
  ProjectAssemblyIntegrityReviewCommand,
  ProjectAssemblyIntegrityReviewDiagnostic,
  ProjectAssemblyIntegrityReviewResult,
  ProjectAssemblyIntegrityReviewUseCase,
} from "../../../ports/in/cad/assembly-integrity/project-assembly-integrity-review.ts";
import type {
  AssemblyIntegrityReviewExistingWork,
  AssemblyIntegrityReviewResolutionDiagnostic,
  AssemblyIntegrityReviewResolver,
} from "../../../ports/out/cad/assembly-integrity/assembly-integrity-review-resolver.ts";
import {
  encodeAssemblyIntegrityObservationAdmissionParameters,
  parseAssemblyIntegrityObservationAdmissionParameters,
  validateAssemblyIntegrityObservationAdmission,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { fingerprintsEqual } from "../../../../domain/kernel/deterministic-json.ts";
import type { EngineeringOperationRef } from "../../../../domain/project/engineering-project.ts";
import { parseExactThreadSnapshotBasis } from "../../../../domain/project/thread-tip.ts";

export type ProjectAssemblyIntegrityReviewErrorCode = "invalid_request";

/** Stable application error; resolver/provider/storage detail remains internal. */
export class ProjectAssemblyIntegrityReviewError extends Error {
  constructor(
    readonly code: ProjectAssemblyIntegrityReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAssemblyIntegrityReviewError";
  }
}

export interface PrepareProjectAssemblyIntegrityReviewDependencies {
  readonly resolver: AssemblyIntegrityReviewResolver;
}

export class PrepareProjectAssemblyIntegrityReview
  implements ProjectAssemblyIntegrityReviewUseCase {
  readonly #resolver: AssemblyIntegrityReviewResolver;

  constructor(dependencies: PrepareProjectAssemblyIntegrityReviewDependencies) {
    this.#resolver = dependencies.resolver;
  }

  async execute(value: unknown): Promise<ProjectAssemblyIntegrityReviewResult> {
    let command: ProjectAssemblyIntegrityReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw new ProjectAssemblyIntegrityReviewError(
        "invalid_request",
        "The assembly-integrity review request failed exact validation.",
      );
    }

    let resolution;
    try {
      resolution = await this.#resolver.resolve(command);
    } catch {
      return notResolved(command, "unavailable", [{
        code: "review-resolution-failed",
        artifactId: command.geometryModule.artifactId,
        message:
          "The exact current Thread and primary geometry module could not be reopened for review.",
      }]);
    }
    if (resolution.status !== "resolved") {
      return notResolved(
        command,
        resolution.status,
        resolution.diagnostics.map(toDiagnostic),
      );
    }

    try {
      const admission = validateAssemblyIntegrityObservationAdmission(
        resolution.admission,
      );
      if (!admissionMatchesCommand(admission, command)) {
        return notResolved(command, "unresolved", [{
          code: "review-resolution-mismatch",
          artifactId: command.geometryModule.artifactId,
          message:
            "The reopened observation admission does not match the named exact Thread basis and primary geometry module.",
        }]);
      }
      const expectedProjectRevision = positiveInteger(
        resolution.expectedProjectRevision,
        "$assemblyIntegrityReview.expectedProjectRevision",
      );
      const decisionParameters = encodeAssemblyIntegrityObservationAdmissionParameters(
        admission,
      );
      const replay = parseAssemblyIntegrityObservationAdmissionParameters(
        decisionParameters,
      );
      if (!admissionMatchesCommand(replay, command)) {
        throw new TypeError("The signed observation admission did not replay exactly.");
      }
      return resolved(
        command,
        replay,
        decisionParameters,
        expectedProjectRevision,
        resolution.existingWork,
      );
    } catch {
      return notResolved(command, "unresolved", [{
        code: "review-admission-invalid",
        artifactId: command.geometryModule.artifactId,
        message:
          "The server-owned observation admission was not an exact factual identity for this review.",
      }]);
    }
  }
}

function parseCommand(value: unknown): ProjectAssemblyIntegrityReviewCommand {
  const root = exactRecord(
    value,
    ["projectId", "basis", "geometryModule"],
    "$assemblyIntegrityReview",
  );
  const geometryModule = exactRecord(
    root.geometryModule,
    ["artifactId", "fingerprint"],
    "$assemblyIntegrityReview.geometryModule",
  );
  const fingerprint = validateContentFingerprint(
    geometryModule.fingerprint,
    "$assemblyIntegrityReview.geometryModule.fingerprint",
  );
  const artifactId = exactId(
    geometryModule.artifactId,
    "$assemblyIntegrityReview.geometryModule.artifactId",
  );
  if (artifactId !== `geometry-${fingerprint.digest}`) {
    throw new TypeError(
      "$assemblyIntegrityReview.geometryModule.artifactId must equal geometry-<sha256>.",
    );
  }
  return deepFreeze({
    projectId: exactId(root.projectId, "$assemblyIntegrityReview.projectId"),
    basis: parseExactThreadSnapshotBasis(root.basis, "$assemblyIntegrityReview.basis"),
    geometryModule: { artifactId, fingerprint },
  });
}

function resolved(
  command: ProjectAssemblyIntegrityReviewCommand,
  admission: ReturnType<typeof validateAssemblyIntegrityObservationAdmission>,
  decisionParameters: ReturnType<
    typeof encodeAssemblyIntegrityObservationAdmissionParameters
  >,
  expectedProjectRevision: number,
  existingWork: AssemblyIntegrityReviewExistingWork | undefined,
): ProjectAssemblyIntegrityReviewResult {
  const operation = operationFor(command);
  const proposed = {
    summary:
      "Prepare a factual assembly-integrity observation over the exact current canonical geometry module.",
    parameters: decisionParameters,
  } as const;
  if (existingWork !== undefined) {
    const selected = parseExistingWork(existingWork);
    return deepFreeze({
      status: "resolved" as const,
      projectId: command.projectId,
      basis: command.basis,
      geometryModule: command.geometryModule,
      diagnostics: [],
      operation,
      work: {
        phaseId: selected.phaseId,
        workItemId: selected.workItemId,
        operation,
        ...(selected.gateClaims.length === 0
          ? {}
          : { gateClaims: selected.gateClaims }),
      },
      decision: {
        decisionId: selected.decision.id,
        title: selected.decision.title,
        question: selected.decision.question,
      },
      admission,
      decisionParameters,
      next: {
        propose: {
          tool: "project_decision_propose" as const,
          arguments: {
            decisionId: selected.decision.id,
            proposal: proposed,
          },
        },
      },
      grants: "none" as const,
    });
  }
  const digestPrefix = command.geometryModule.fingerprint.digest.slice(0, 16);
  const phaseId = `phase-assembly-integrity-${digestPrefix}-r${command.basis.revision}`;
  const workItemId =
    `work-assembly-integrity-${digestPrefix}-r${command.basis.revision}`;
  const decisionId =
    `decision-assembly-integrity-${digestPrefix}-r${command.basis.revision}`;
  const appendCommandId =
    `append-assembly-integrity-${digestPrefix}-r${command.basis.revision}`;
  const phase = {
    id: phaseId,
    name: "Assembly integrity observation",
    description:
      "Prepare a factual assembly-integrity observation over one exact canonical geometry module.",
  } as const;
  const work = deepFreeze({ phaseId, workItemId, operation });
  const decision = deepFreeze({
    decisionId,
    title: "Approve assembly integrity observation",
    question:
      "Approve verify.observe-assembly-integrity@1 for this exact canonical geometry module?",
  });
  const next = deepFreeze({
    append: {
      tool: "project_change_append" as const,
      arguments: {
        commandId: appendCommandId,
        projectId: command.projectId,
        baseSnapshot: {
          snapshotId: command.basis.snapshotId,
          revision: command.basis.revision,
          subjectId: command.basis.subjectId,
        },
        expectedRevision: expectedProjectRevision,
        phases: [phase],
        workItems: [{
          id: workItemId,
          phaseId,
          owner: "agent" as const,
          dependsOnWorkItemIds: [],
          decisionIds: [decisionId],
          operation,
        }],
        requiredDecisions: [{
          id: decisionId,
          phaseId,
          title: decision.title,
          question: decision.question,
        }],
      },
    },
    propose: {
      tool: "project_decision_propose" as const,
      arguments: {
        decisionId,
        proposal: {
          ...proposed,
        },
      },
    },
  });
  return deepFreeze({
    status: "resolved" as const,
    projectId: command.projectId,
    basis: command.basis,
    geometryModule: command.geometryModule,
    diagnostics: [],
    operation,
    work,
    decision,
    admission,
    decisionParameters,
    next,
    grants: "none" as const,
  });
}

function operationFor(
  command: ProjectAssemblyIntegrityReviewCommand,
): EngineeringOperationRef {
  return deepFreeze({
    id: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
    version: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    bindings: [{
      name: "geometryModule",
      source: {
        kind: "thread-entity",
        reference: {
          snapshotId: command.basis.snapshotId,
          snapshotRevision: command.basis.revision,
          kind: "artifact",
          id: command.geometryModule.artifactId,
        },
      },
    }],
  });
}

function parseExistingWork(
  value: AssemblyIntegrityReviewExistingWork,
): AssemblyIntegrityReviewExistingWork {
  const root = exactRecord(
    value,
    ["phaseId", "workItemId", "decision", "gateClaims"],
    "$assemblyIntegrityReview.existingWork",
  );
  const decision = exactRecord(
    root.decision,
    ["id", "title", "question"],
    "$assemblyIntegrityReview.existingWork.decision",
  );
  if (!Array.isArray(root.gateClaims)) {
    throw new TypeError(
      "$assemblyIntegrityReview.existingWork.gateClaims must be an array.",
    );
  }
  const gateClaimIds = new Set<string>();
  const gateClaims = root.gateClaims.map((value, index) => {
    const claim = exactRecord(
      value,
      ["gateItemId", "role", "status"],
      `$assemblyIntegrityReview.existingWork.gateClaims[${index}]`,
    );
    if (claim.role !== "contributes-to" || claim.status !== "current") {
      throw new TypeError(
        "$assemblyIntegrityReview.existingWork.gateClaims must remain contributes-to/current.",
      );
    }
    const gateItemId = exactId(
      claim.gateItemId,
      `$assemblyIntegrityReview.existingWork.gateClaims[${index}].gateItemId`,
    );
    if (gateClaimIds.has(gateItemId)) {
      throw new TypeError(
        "$assemblyIntegrityReview.existingWork.gateClaims must not duplicate a gate item.",
      );
    }
    gateClaimIds.add(gateItemId);
    return {
      gateItemId,
      role: "contributes-to" as const,
      status: "current" as const,
    };
  });
  return deepFreeze({
    phaseId: exactId(root.phaseId, "$assemblyIntegrityReview.existingWork.phaseId"),
    workItemId: exactId(
      root.workItemId,
      "$assemblyIntegrityReview.existingWork.workItemId",
    ),
    decision: {
      id: exactId(decision.id, "$assemblyIntegrityReview.existingWork.decision.id"),
      title: nonBlankText(
        decision.title,
        "$assemblyIntegrityReview.existingWork.decision.title",
      ),
      question: nonBlankText(
        decision.question,
        "$assemblyIntegrityReview.existingWork.decision.question",
      ),
    },
    gateClaims,
  });
}

function notResolved(
  command: ProjectAssemblyIntegrityReviewCommand,
  status: "unresolved" | "unavailable",
  diagnostics: readonly ProjectAssemblyIntegrityReviewDiagnostic[],
): ProjectAssemblyIntegrityReviewResult {
  return deepFreeze({
    status,
    projectId: command.projectId,
    basis: command.basis,
    geometryModule: command.geometryModule,
    diagnostics,
    grants: "none" as const,
  });
}

function toDiagnostic(
  diagnostic: AssemblyIntegrityReviewResolutionDiagnostic,
): ProjectAssemblyIntegrityReviewDiagnostic {
  return {
    code: diagnostic.code,
    artifactId: diagnostic.artifactId,
    message: diagnostic.message,
  };
}

function admissionMatchesCommand(
  admission: ReturnType<typeof validateAssemblyIntegrityObservationAdmission>,
  command: ProjectAssemblyIntegrityReviewCommand,
): boolean {
  return admission.projectId === command.projectId &&
    admission.basis.snapshotId === command.basis.snapshotId &&
    admission.basis.revision === command.basis.revision &&
    admission.basis.subjectId === command.basis.subjectId &&
    admission.geometryModule.artifactId === command.geometryModule.artifactId &&
    fingerprintsEqual(
      admission.geometryModule.fingerprint,
      command.geometryModule.fingerprint,
    );
}

function exactId(value: unknown, path: string): string {
  const id = safeId(value, path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} must not use a latest alias.`);
  }
  return id;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return Number(value);
}

function nonBlankText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be non-blank text.`);
  }
  return value;
}
