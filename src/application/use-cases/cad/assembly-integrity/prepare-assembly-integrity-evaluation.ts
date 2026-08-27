/**
 * Server-owned preparation of a trusted L4 assembly-integrity capture.
 *
 * This is the executor-facing counterpart to the project-only review.  It
 * accepts only the registered run identity/basis stamped by the server, then
 * delegates all factual input selection to the exact L3 recross.
 */

import type {
  EvaluateAssemblyIntegrityCommand,
  EvaluateAssemblyIntegrityResult,
  EvaluateAssemblyIntegrityUseCase,
} from "../../../ports/in/cad/assembly-integrity/evaluate-assembly-integrity.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import {
  createAssemblyIntegrityEvaluationCapture,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  deepFreeze,
  exactRecord,
  nonEmptyText,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import {
  parseExactThreadSnapshotBasis,
  selectCurrentThreadTip,
} from "../../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  type AssemblyIntegrityEvaluationRecrossDependencies,
  type AssemblyIntegrityEvaluationRecrossSnapshotStore,
  recrossAssemblyIntegrityEvaluation,
} from "./recross-assembly-integrity-evaluation.ts";

export interface PrepareAssemblyIntegrityEvaluationDependencies
  extends AssemblyIntegrityEvaluationRecrossDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: AssemblyIntegrityEvaluationRecrossSnapshotStore;
}

export class PrepareAssemblyIntegrityEvaluation
  implements EvaluateAssemblyIntegrityUseCase {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #dependencies: AssemblyIntegrityEvaluationRecrossDependencies;
  readonly #snapshots: AssemblyIntegrityEvaluationRecrossSnapshotStore;

  constructor(dependencies: PrepareAssemblyIntegrityEvaluationDependencies) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#dependencies = {
      snapshots: dependencies.snapshots,
      observations: dependencies.observations,
      inputs: dependencies.inputs,
    };
  }

  async execute(
    value: EvaluateAssemblyIntegrityCommand,
  ): Promise<EvaluateAssemblyIntegrityResult> {
    let command: EvaluateAssemblyIntegrityCommand;
    try {
      command = parseCommand(value);
    } catch {
      return unavailable(
        "invalid-run-command",
        "The L4 evaluator did not receive an exact server-stamped run basis.",
      );
    }
    let project;
    try {
      project = await this.#projects.get(command.projectId);
      if (project) project = validateEngineeringProjectSnapshot(project);
    } catch {
      return unavailable(
        "project-unavailable",
        "The exact L4 project is unavailable.",
      );
    }
    if (!project || project.project.id !== command.projectId) {
      return unavailable(
        "project-unavailable",
        "The exact L4 project is unavailable.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (
      tip.status !== "ok" ||
      tip.basis.snapshotId !== command.basis.snapshotId ||
      tip.basis.revision !== command.basis.revision ||
      tip.basis.subjectId !== command.basis.subjectId
    ) {
      return unavailable(
        "basis-unavailable",
        "The queued L4 run basis is not the unique current Thread tip.",
      );
    }
    const runs = project.agentRuns.filter((run) => run.id === command.trustedRunId);
    if (runs.length !== 1) {
      return unavailable(
        "run-unavailable",
        "The trusted L4 run is not unique in the project.",
      );
    }
    const run = runs[0]!;
    if (
      !sameBasis(run.basis, command.basis) ||
      run.startedAt !== command.evaluatedAt
    ) {
      return unresolved(
        "run-basis-mismatch",
        "The trusted L4 run does not retain the exact current basis and start time.",
      );
    }
    const works = project.workItems.filter((item) => item.id === run.workItemId);
    if (works.length !== 1) {
      return unavailable(
        "l4-work-unavailable",
        "The trusted L4 run does not resolve to one work revision.",
      );
    }
    let head;
    try {
      const raw = this.#snapshots.getFresh
        ? await this.#snapshots.getFresh(command.basis.snapshotId)
        : await this.#snapshots.get(command.basis.snapshotId);
      head = raw ? validateThreadSnapshot(raw) : undefined;
    } catch {
      head = undefined;
    }
    if (!head || !sameSnapshotBasis(head, command.basis)) {
      return unavailable(
        "basis-unavailable",
        "The exact queued L4 Thread basis is unavailable.",
      );
    }

    const recrossed = await recrossAssemblyIntegrityEvaluation(
      this.#dependencies,
      {
        project,
        head,
        basis: command.basis,
        currentWork: works[0]!,
        trustedRunId: command.trustedRunId,
      },
    );
    if (recrossed.status !== "resolved") return recrossed;
    try {
      const capture = await createAssemblyIntegrityEvaluationCapture({
        schemaVersion: "assembly-integrity-evaluation-capture/1.0",
        kind: "assembly-integrity-evaluation",
        operation: {
          id: "verify.evaluate-assembly-integrity",
          version: "1",
        },
        trustedRunId: command.trustedRunId,
        evaluatedAt: command.evaluatedAt,
        basis: command.basis,
        geometryModule: recrossed.observationCapture.geometryModule,
        assemblyStep: recrossed.observationCapture.assemblyStep,
        observation: {
          schemaVersion: recrossed.observationCapture.schemaVersion,
          artifactId: recrossed.artifactInputs[2]!.id,
          fingerprint: recrossed.artifactInputs[2]!.fingerprint,
          observationFingerprint: recrossed.observationCapture.observationFingerprint,
        },
        inputBundle: recrossed.observationCapture.inputBundle,
        method: recrossed.method,
        evaluation: recrossed.evaluation,
      });
      return deepFreeze({
        status: "resolved" as const,
        capture,
        artifactInputs: recrossed.artifactInputs,
        diagnostics: [],
      });
    } catch {
      return unresolved(
        "capture-construction-failed",
        "The exact L4 evidence selection could not be represented as the closed custom capture.",
      );
    }
  }
}

function parseCommand(value: unknown): EvaluateAssemblyIntegrityCommand {
  const root = exactRecord(
    value,
    ["projectId", "trustedRunId", "basis", "evaluatedAt"],
    "$evaluateAssemblyIntegrity",
  );
  return deepFreeze({
    projectId: safeId(root.projectId, "$evaluateAssemblyIntegrity.projectId"),
    trustedRunId: safeId(
      root.trustedRunId,
      "$evaluateAssemblyIntegrity.trustedRunId",
    ),
    basis: parseExactThreadSnapshotBasis(
      root.basis,
      "$evaluateAssemblyIntegrity.basis",
    ),
    evaluatedAt: isoInstant(
      root.evaluatedAt,
      "$evaluateAssemblyIntegrity.evaluatedAt",
    ),
  });
}

function sameBasis(
  value: unknown,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EngineeringThreadSnapshotBasis>;
  return candidate.kind === "thread-snapshot" &&
    candidate.snapshotId === basis.snapshotId &&
    candidate.revision === basis.revision &&
    candidate.subjectId === basis.subjectId;
}

function sameSnapshotBasis(
  value: {
    readonly id: string;
    readonly revision: number;
    readonly subject: { readonly id: string };
  },
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return value.id === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subject.id === basis.subjectId;
}

function isoInstant(value: unknown, path: string): string {
  const result = nonEmptyText(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result
  ) {
    throw new TypeError(`${path} must be a canonical UTC ISO-8601 instant.`);
  }
  return result;
}

function unavailable(
  code: string,
  message: string,
): EvaluateAssemblyIntegrityResult {
  return { status: "unavailable", diagnostics: [{ code, message }] };
}

function unresolved(
  code: string,
  message: string,
): EvaluateAssemblyIntegrityResult {
  return { status: "unresolved", diagnostics: [{ code, message }] };
}
