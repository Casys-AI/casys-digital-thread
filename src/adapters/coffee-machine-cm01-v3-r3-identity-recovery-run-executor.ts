import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../domain/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../domain/engineering-project.ts";
import { deterministicJson } from "../domain/deterministic-json.ts";
import {
  type Cm01DripTrayMechanicalProofR3,
  parseCm01DripTrayMechanicalProofR3,
} from "../domain/cm01-drip-tray-mechanical-proof.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../domain/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../domain/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../domain/thread-snapshot-validation.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import { callDripTrayMechanicalOracle } from "./cm01-drip-tray-mechanical-oracle.ts";
import { Cm01DripTrayMechanicalR3CaptureRecovery } from "./cm01-drip-tray-mechanical-r3-capture-recovery.ts";
import type { EngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";
import type { McpToolClient } from "./http-mcp-tool-client.ts";
import type { FileCaptureStore } from "./file-capture-store.ts";
import { checkOracleRequirementsFidelityBeforeDispatch } from "./coffee-machine-cm01-v3-oracle-requirements-run-executor.ts";
import {
  type Cm01R3MechanicalMaterialization,
  CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer,
} from "./coffee-machine-cm01-v3-r3-successor-materializer.ts";
import {
  requireBasis,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

export const COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3IdentityRecovery;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_PROJECT_ID =
  "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_BASIS_REVISION =
  10 as const;

export interface CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly capture: Cm01DripTrayMechanicalR3CaptureRecovery;
  readonly proof: Cm01DripTrayMechanicalProofR3;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  /** Optional fidelity gate; see CoffeeMachineCm01V3MechanicalRunExecutorDependencies. */
  readonly requirementsCaptures?: FileCaptureStore<"oracle-requirements-seed">;
}

interface RecoveryBasis {
  readonly snapshot: ThreadSnapshot;
  readonly historicalRun: EngineeringAgentRun;
  readonly historicalEvidence: ThreadArtifact;
}

/**
 * One bounded repair for the historical R10 naming defect.
 *
 * It loads the immutable, completed R3 capture, emits one new R3-identified
 * successor, and links it as a replacement for (rather than an alias of) the
 * retained R10 record.  No computation/simulation provider client is present;
 * only the oracle (syson) is called to evaluate the limits against the capture.
 */
export class CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #capture: Cm01DripTrayMechanicalR3CaptureRecovery;
  readonly #proof: Cm01DripTrayMechanicalProofR3;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #requirementsCaptures:
    | FileCaptureStore<"oracle-requirements-seed">
    | undefined;

  constructor(
    dependencies:
      CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#capture = dependencies.capture;
    this.#proof = parseCm01DripTrayMechanicalProofR3(dependencies.proof);
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#requirementsCaptures = dependencies.requirementsCaptures;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 R3 identity recovery.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    requireRecoveryRunShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      async () => await this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let materialized: Cm01R3MechanicalMaterialization | undefined;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireRecoveryRunShape(project, run);
      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      await this.#requiredBasis(project, run);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary: "Started the CM-01 R3 mechanical evidence identity recovery.",
      });
      claimed = true;

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireOwnedRecoveryRun(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running") throw unexpectedStatus(run, "running");

      const basis = await this.#requiredBasis(project, run);
      // Fidelity gate: same check as the other mechanical executors — if the
      // basis snapshot carries an oracle-requirements artifact the model must
      // still reflect the committed thresholds before any oracle call.
      await checkOracleRequirementsFidelityBeforeDispatch(
        basis.snapshot,
        this.#snapshots,
        this.#proof,
        this.#syson,
        this.#requirementsCaptures,
      );
      // The original completed attempt is read-only evidence.  Its SHA-256 is
      // checked against the R10 solve before it can materialize R11.
      const captured = await this.#capture.require({
        projectId: project.project.id,
        historicalRunId: basis.historicalRun.id,
        expectedCaptureFingerprint: basis.historicalEvidence.fingerprint,
      });
      // The oracle call is the only external call in this executor: no
      // computation provider is involved, but the verdict must still come from
      // syson_constraint_evaluate rather than a local comparison.
      const oracleResults = await callDripTrayMechanicalOracle(
        this.#syson,
        this.#proof.limits,
        {
          displacementMm: captured.value.metrics.maximumDisplacement.value,
          vonMisesMpa: captured.value.metrics.maximumVonMises.value,
        },
      );
      materialized = await new CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer()
        .materializeIdentityRecovery(
          basis.snapshot,
          run.id,
          basis.historicalRun.id,
          captured.value,
          captured.uri,
          this.#proof,
          oracleResults,
        );
      await this.#snapshots.save(materialized.snapshot);
      if (
        (await snapshotPresence(this.#snapshots, materialized.snapshot)) !== "exact"
      ) {
        throw new Error(
          "CM-01 R3 identity-recovery snapshot persistence could not be verified.",
        );
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the correctly identified CM-01 R3 mechanical evidence.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: step(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            "Recorded the R3-identified CM-01 mechanical successor from the immutable completed R3 capture; R10 remains retained as superseded history.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [{
            snapshotId: materialized.snapshot.id,
            snapshotRevision: materialized.snapshot.revision,
            kind: "artifact",
            id: materialized.evidenceArtifactId,
          }],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const completed = await this.#requiredProject(command.projectId);
      assertCompleted(completed, command);
      return completed;
    } catch (error) {
      if (
        materialized &&
        (await snapshotPresence(this.#snapshots, materialized.snapshot)) === "exact"
      ) {
        const completed = await this.#completedProject(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The R3 identity-recovery snapshot is durable but its project attachment did not finish. Retry this same command; no provider is called.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  async #requiredBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<RecoveryBasis> {
    const basis = requireBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 R3 identity-recovery basis belongs to another project subject.",
      );
    }
    if (
      basis.revision !==
        COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_BASIS_REVISION
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "CM-01 R3 identity recovery is bounded to the retained R10 snapshot.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact retained CM-01 R10 snapshot is unavailable for identity recovery.",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The retained CM-01 R10 snapshot is invalid: ${message(error)}`,
      );
    }
    if (!snapshot.id.includes(":r10:") || !snapshot.id.includes("mechanical-r2-")) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "CM-01 R3 identity recovery requires the exact retained R10 naming-defect snapshot.",
      );
    }
    const historical = requireHistoricalR3Evidence(project, basis, snapshot);
    requireRecoveryBinding(project, run, basis, historical.evidence.id);
    return {
      snapshot,
      historicalRun: historical.run,
      historicalEvidence: historical.evidence,
    };
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #completedProject(
    command: CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.#requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: step(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: "CM-01 R3 mechanical identity recovery stopped before publication.",
        code: "cm01-r3-identity-recovery-not-published",
        message:
          "The immutable R3 capture could not be reprojected under its correct identity. No provider was called.",
      });
    } catch { /* preserve the original recovery error */ }
  }
}

function requireRecoveryRunShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const expected = [["approvedBrief", "approved-brief"], [
    "historicalMechanicalR3Result",
    "thread-entity",
  ]];
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !==
      COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_PROJECT_ID ||
    project.project.subjectId !==
      COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !==
      COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_OPERATION.id ||
    workItem.operation.version !==
      COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_IDENTITY_RECOVERY_OPERATION.version ||
    deterministicJson(
        workItem.operation.bindings.map((
          binding,
        ) => [binding.name, binding.source.kind]),
      ) !==
      deterministicJson(expected)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 R3 mechanical identity-recovery operation.",
    );
  }
  return workItem;
}

function requireOwnedRecoveryRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireRecoveryRunShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 R3 identity-recovery run it claimed.",
    );
  }
}

function requireHistoricalR3Evidence(
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
  snapshot: ThreadSnapshot,
): { run: EngineeringAgentRun; evidence: ThreadArtifact } {
  const runs = project.agentRuns.filter((candidate) => {
    const item = project.workItems.find((work) => work.id === candidate.workItemId);
    return candidate.status === "completed" &&
      item?.operation?.id ===
        COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3.id &&
      item.operation.version ===
        COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3.version &&
      sameSnapshot(candidate.resultSnapshot, basis);
  });
  if (runs.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "CM-01 R3 identity recovery requires exactly one completed original R3 run attached to R10.",
    );
  }
  const run = runs[0]!;
  if (
    run.evidenceRefs.length !== 1 || run.evidenceRefs[0]!.kind !== "artifact" ||
    !sameSnapshot(run.evidenceRefs[0], basis)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The completed original R3 run must expose exactly one R10 artifact evidence reference.",
    );
  }
  const evidence = snapshot.artifacts.find((item) =>
    item.id === run.evidenceRefs[0]!.id
  );
  const prefix = "coffee-machine-cm01-v3-mechanical-r2-";
  if (
    !evidence || evidence.kind !== "solver-result" || !evidence.id.startsWith(prefix) ||
    !evidence.id.endsWith("-solve") || evidence.producer.runId !== run.id
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The R10 source is not the retained historical R3 solve with its known naming defect.",
    );
  }
  return { run, evidence };
}

function requireRecoveryBinding(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  basis: EngineeringThreadSnapshotBasis,
  historicalEvidenceId: string,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
  const binding = workItem.operation!.bindings.find((item) =>
    item.name === "historicalMechanicalR3Result"
  );
  if (
    binding?.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact" ||
    binding.source.reference.id !== historicalEvidenceId ||
    !sameSnapshot(binding.source.reference, basis)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The CM-01 R3 identity-recovery run must bind the exact retained R10 historical solve.",
    );
  }
}

function sameSnapshot(
  value: (EngineeringThreadSnapshotRef | EngineeringThreadEntityRef) | undefined,
  expected: EngineeringThreadSnapshotBasis,
): boolean {
  if (!value || value.snapshotId !== expected.snapshotId) return false;
  const revision = (value as { readonly revision?: unknown }).revision ??
    (value as { readonly snapshotRevision?: unknown }).snapshotRevision;
  return revision === expected.revision;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === step(command.commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 R3 identity-recovery run ${run.id} did not complete through this exact execution command.`,
    );
  }
}

async function snapshotPresence(
  snapshots: ThreadSnapshotStore,
  snapshot: ThreadSnapshot,
): Promise<"exact" | "absent" | "unknown"> {
  try {
    const found = await snapshots.get(snapshot.id);
    return !found
      ? "absent"
      : deterministicJson(found) === deterministicJson(snapshot)
      ? "exact"
      : "unknown";
  } catch {
    return "unknown";
  }
}

function step(commandId: string, suffix: string): string {
  return `${commandId}:${suffix}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown validation failure";
}
