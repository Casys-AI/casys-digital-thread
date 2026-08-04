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
import { deterministicJson, sha256Fingerprint } from "../domain/deterministic-json.ts";
import {
  type Cm01DripTrayMechanicalProof,
  parseCm01DripTrayMechanicalProof,
} from "../domain/cm01-drip-tray-mechanical-proof.ts";
import type {
  ContentFingerprint,
  ProposedThreadAction,
  RequirementEvaluation,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
  ThreadViolation,
  TracedRequirement,
} from "../domain/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../domain/thread-snapshot-extension.ts";
import {
  callDripTrayMechanicalOracle,
  evaluationFromOracle,
  type ParsedOracleResult,
  parseOracleOutcome,
} from "./cm01-drip-tray-mechanical-oracle.ts";
import type { ThreadSnapshotStore } from "../domain/thread-snapshot-store.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  captureCm01DripTrayMechanical,
  type Cm01DripTrayMechanicalCapture,
  parseCm01DripTrayMechanicalCapture,
} from "./cm01-drip-tray-mechanical-capture.ts";
import {
  Cm01DripTrayMechanicalOutcomeUnknownError,
  FileCm01DripTrayMechanicalAttemptStore,
} from "./file-cm01-drip-tray-mechanical-attempt-store.ts";
import { FileCaptureStore } from "./file-capture-store.ts";
import type { EngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";
import type { McpToolClient } from "./http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "./live-thread-update-store.ts";

/**
 * Re-exported from cm01-drip-tray-mechanical-oracle.ts for backward compatibility
 * with existing imports in tests and callers that reference this module.
 */
export type { ParsedOracleResult };
export { evaluationFromOracle, parseOracleOutcome };

export const COFFEE_MACHINE_CM01_V3_MECHANICAL_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanical;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_PROJECT_ID =
  "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_ARTIFACT_ROLE =
  "mechanical-step" as const;

export interface CoffeeMachineCm01V3MechanicalRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}
export interface CoffeeMachineCm01V3MechanicalRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly proof: Cm01DripTrayMechanicalProof;
  /** SysON MCP client used to call syson_constraint_evaluate for the oracle verdict. */
  readonly syson: McpToolClient;
  readonly build123d: McpToolClient;
  readonly calculix: McpToolClient;
  readonly attempts: FileCm01DripTrayMechanicalAttemptStore;
  readonly captures: FileCaptureStore<"cm01-drip-tray-mechanical">;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}
interface Materialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

/** Separate the stored JSON address from the proof's unsigned evidence hash. */
interface PersistedMechanicalCapture {
  readonly capture: Cm01DripTrayMechanicalCapture;
  readonly storageFingerprint: ContentFingerprint;
}

/** Executes only the fixed V3 isolated DripTray proof with an attested CAD-to-FEA handoff. */
export class CoffeeMachineCm01V3MechanicalRunExecutor {
  readonly #projects;
  readonly #commands;
  readonly #snapshots;
  readonly #proof;
  readonly #syson;
  readonly #build123d;
  readonly #calculix;
  readonly #attempts;
  readonly #captures;
  readonly #lease;
  readonly #live;
  readonly #now;
  constructor(deps: CoffeeMachineCm01V3MechanicalRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#proof = parseCm01DripTrayMechanicalProof(deps.proof);
    this.#syson = deps.syson;
    this.#build123d = deps.build123d;
    this.#calculix = deps.calculix;
    this.#attempts = deps.attempts;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#live = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }
  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3MechanicalRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed CM-01 DripTray mechanical proof.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }
  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3MechanicalRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let materialized: Materialization | undefined;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      await this.requiredBasis(project, run);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary: "Started the reviewed CM-01 isolated DripTray mechanical proof.",
      });
      claimed = true;
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimed(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running") throw unexpected(run, "running");
      const base = await this.requiredBasis(project, run);
      const startedAt = requiredStart(run);
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "running",
        startedAt,
        "DripTray mechanical proof running",
        "Generating the fixed isolated DripTray STEP and running the reviewed static solve. This is concept verification only.",
      );
      const persistedCapture = await this.captureOnce(project, run, startedAt);
      const capture = persistedCapture.capture;
      capturePersisted = true;
      const oracleResults = await callMechanicalConstraintOracle(
        this.#syson,
        capture,
        this.#proof,
      );
      materialized = await materializeCoffeeMachineCm01V3MechanicalSnapshot(
        base,
        run.id,
        capture,
        this.#captures.uriFor(persistedCapture.storageFingerprint),
        this.#proof,
        oracleResults,
      );
      await this.#snapshots.save(materialized.snapshot);
      if ((await this.presence(materialized.snapshot)) !== "exact") {
        throw new Error("CM-01 mechanical snapshot persistence could not be verified.");
      }
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "fresh",
        capture.capturedAt,
        "DripTray mechanical evidence captured",
        "CalculiX independently attested the exact STEP content hash it consumed; normalized extrema and evaluated limits are attached.",
      );
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the attested CM-01 DripTray mechanical evidence.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpected(run, "publishing");
      }
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: step(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Recorded the bounded CM-01 DripTray mechanical proof.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [materialized.evidence],
        });
      } else if (run.status !== "completed") throw unexpected(run, "completed");
      const completed = await this.requiredProject(command.projectId);
      assertCompleted(completed, command);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
      if (materialized && (await this.presence(materialized.snapshot)) === "exact") {
        const completed = await this.completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 mechanical evidence is durable but project attachment did not finish. Retry this exact command; providers will not run again.",
        );
      }
      if (error instanceof Cm01DripTrayMechanicalOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 DripTray mechanical provider outcome is unknown. Inspect the local providers before any reviewed recovery; it will not be replayed automatically.",
        );
      }
      if (capturePersisted) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 mechanical capture is durable but its snapshot was not published. Retry this exact command without repeating providers.",
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }
  private async captureOnce(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    dispatchedAt: string,
  ): Promise<PersistedMechanicalCapture> {
    const attempt = await this.#attempts.begin({
      projectId: project.project.id,
      runId: run.id,
      dispatchedAt,
    });
    if (attempt.action === "completed") {
      const text = await this.#captures.read(attempt.captureFingerprint);
      if (!text) {
        throw new Error("Completed CM-01 mechanical attempt has no readable capture.");
      }
      const capture = await parseCm01DripTrayMechanicalCapture(JSON.parse(text));
      const storageFingerprint = await sha256Fingerprint(capture);
      if (storageFingerprint.digest !== attempt.captureFingerprint.digest) {
        throw new Error(
          "CM-01 mechanical capture storage fingerprint differs from its attempt record.",
        );
      }
      return { capture, storageFingerprint };
    }
    const capture = await captureCm01DripTrayMechanical(
      this.#build123d,
      this.#calculix,
      this.#proof,
      this.#now,
    );
    const text = deterministicJson(capture);
    const parsed = await parseCm01DripTrayMechanicalCapture(JSON.parse(text));
    if (parsed.fingerprint.digest !== capture.fingerprint.digest) {
      throw new Error("CM-01 mechanical capture self-fingerprint is inconsistent.");
    }
    /** Storage addresses the complete capture; capture.fingerprint attests its unsigned evidence body. */
    const storageFingerprint = await sha256Fingerprint(capture);
    await this.#captures.save(storageFingerprint, text);
    await this.#attempts.complete({
      projectId: project.project.id,
      runId: run.id,
      completedAt: capture.capturedAt,
      captureFingerprint: storageFingerprint,
    });
    return { capture, storageFingerprint };
  }
  private async requiredBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ThreadSnapshot> {
    const basis = requireBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 mechanical basis belongs to another subject.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot basis for this CM-01 mechanical run is unavailable.",
      );
    }
    return snapshot;
  }
  private async presence(
    snapshot: ThreadSnapshot,
  ): Promise<"exact" | "absent" | "unknown"> {
    try {
      const persisted = await this.#snapshots.get(snapshot.id);
      return !persisted
        ? "absent"
        : deterministicJson(persisted) === deterministicJson(snapshot)
        ? "exact"
        : "unknown";
    } catch {
      return "unknown";
    }
  }
  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3MechanicalRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((item) => item.id === command.runId);
      if (
        !run || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId ||
        !["running", "publishing"].includes(run.status)
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: step(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "CM-01 DripTray mechanical proof stopped before durable evidence was published.",
        code: "cm01-drip-tray-mechanical-not-published",
        message:
          "The bounded mechanical proof did not produce durable evidence. No automatic provider retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        requireBasis(run).revision,
        "failed",
        safeNow(this.#now),
        "DripTray mechanical proof stopped",
        "The proof stopped before durable evidence was published and was not automatically repeated.",
      );
    } catch { /* preserve original failure */ }
  }
  private async recordLive(
    subjectId: string,
    runId: string,
    baseRevision: number,
    state: "running" | "fresh" | "failed",
    recordedAt: string,
    label: string,
    summary: string,
  ): Promise<void> {
    if (!this.#live) return;
    try {
      await this.#live.appendOnce({
        subjectId,
        runId,
        operationId: COFFEE_MACHINE_CM01_V3_MECHANICAL_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:drip-tray-mechanical`,
            ref: { kind: "artifact", id: `${runId}:drip-tray-mechanical` },
            entityKind: "artifact",
            artifactKind: "solver-result",
            activityRole: "milestone",
            label,
            system: "CalculiX",
            freshness: state,
            summary,
            recordedAt,
          }],
          edges: [],
        },
      });
    } catch { /* presentation must not alter evidence */ }
  }
  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#live?.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch { /* durable result wins */ }
  }
  private async completedFor(command: CoffeeMachineCm01V3MechanicalRunExecutorCommand) {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }
  private async requiredProject(id: string) {
    const project = await this.#projects.get(id);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${id} does not exist.`,
      );
    }
    return project;
  }
}

export function coffeeMachineCm01V3MechanicalGoldenProjection(
  snapshot: ThreadSnapshot,
) {
  const stepArtifact = snapshot.artifacts.find((artifact) =>
    artifact.name === "CM-01 V3 isolated DripTray STEP" &&
    artifact.producer.serverId === "build123d" &&
    artifact.producer.tool === "build123d_export"
  );
  const consumption = stepArtifact &&
    snapshot.consumptions.find((item) =>
      item.artifactId === stepArtifact.id && item.consumer.serverId === "calculix" &&
      item.consumer.tool === "calculix_solve_static"
    );
  if (!stepArtifact || !consumption) {
    throw new Error(
      "CM-01 V3 snapshot has no attested DripTray mechanical STEP handoff.",
    );
  }
  const readings = new Map(snapshot.observations.map((item) => [item.metric, item]));
  const evaluations = snapshot.evaluations.filter((item) =>
    item.requirementId.includes("drip-tray")
  );
  return {
    step: {
      artifactRole: COFFEE_MACHINE_CM01_V3_MECHANICAL_ARTIFACT_ROLE,
      sha256: stepArtifact.fingerprint.digest,
    },
    consumption: {
      artifactRole: COFFEE_MACHINE_CM01_V3_MECHANICAL_ARTIFACT_ROLE,
      consumer: { serverId: "calculix", tool: "calculix_solve_static" },
      status: consumption.status,
      observedSha256: consumption.observedFingerprint.digest,
    },
    measurements: ["assembly_max_displacement", "assembly_max_von_mises"].map(
      (metric) => {
        const observation = readings.get(metric);
        if (!observation) {
          throw new Error(`CM-01 V3 mechanical metric ${metric} is absent.`);
        }
        return {
          metric,
          value: observation.quantity.value,
          unit: observation.quantity.unit,
        };
      },
    ),
    evaluations: evaluations.map((item) => ({
      metric:
        snapshot.requirements.find((requirement) =>
          requirement.id === item.requirementId
        )?.criterion.metric ?? "",
      status: item.status,
    })),
  } as const;
}

/**
 * Materialize only the causal claims that provider outputs attest.
 *
 * build123d does not return an input-script fingerprint, so the reviewed proof
 * declaration documents the fixed case but is not claimed as a consumed STEP
 * input. CalculiX does attest the STEP fingerprint, and that is the one
 * verified artifact consumption represented in the thread.
 */
export async function materializeCoffeeMachineCm01V3MechanicalSnapshot(
  base: ThreadSnapshot,
  runId: string,
  capture: Cm01DripTrayMechanicalCapture,
  uri: string,
  proof: Cm01DripTrayMechanicalProof,
  oracleResults: ReadonlyMap<string, ParsedOracleResult>,
): Promise<Materialization> {
  const prefix = `coffee-machine-cm01-v3-mechanical-${capture.fingerprint.digest}`;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const cad: ThreadOperationRef = {
    serverId: "build123d",
    tool: "build123d_export",
    runId,
  };
  const solver: ThreadOperationRef = {
    serverId: "calculix",
    tool: "calculix_solve_static",
    runId,
  };
  const local: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "evaluate_cm01_drip_tray_limits",
    runId,
  };
  /**
   * The oracle is the sole authority on the verdict (D2). No <= comparison is
   * recomputed locally. The serverId/tool pair is declared here so the
   * ThreadOperationRef in evaluations is accurate: the verdict belongs to
   * syson_constraint_evaluate, not to the local orchestrator.
   */
  const oracleEvaluator: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    runId,
  };
  const proofFingerprint = await sha256Fingerprint(proof);
  const proofId = `${prefix}-proof`;
  const stepId = `${prefix}-step`;
  const solveId = `${prefix}-solve`;
  const artifacts: ThreadArtifact[] = [
    artifact(
      proofId,
      "CM-01 V3 reviewed DripTray proof case",
      "document",
      proofFingerprint,
      uri,
      "application/json",
      local,
      [],
      freshness,
    ),
    artifact(
      stepId,
      "CM-01 V3 isolated DripTray STEP",
      "step",
      capture.step.fingerprint,
      `${uri}#${capture.step.name}`,
      "model/step",
      cad,
      [],
      freshness,
    ),
    artifact(
      solveId,
      "CM-01 V3 CalculiX static result",
      "solver-result",
      capture.fingerprint,
      `${uri}#calculix`,
      "application/json",
      solver,
      [stepId],
      freshness,
    ),
  ];
  const consumption: ThreadArtifactConsumption = {
    id: `${prefix}-calculix-consumes-step`,
    artifactId: stepId,
    consumer: solver,
    observedFingerprint: capture.handoff.fingerprint,
    verifiedAt: capture.capturedAt,
    status: "verified",
  };
  const displacementId = `${prefix}-assembly-max-displacement`;
  const stressId = `${prefix}-assembly-max-von-mises`;
  const observations = [
    {
      id: displacementId,
      name: "DripTray maximum displacement",
      metric: "assembly_max_displacement",
      quantity: { value: capture.metrics.maximumDisplacement.value, unit: "mm" },
      source: {
        operation: solver,
        artifactIds: [solveId],
        capturedAt: capture.capturedAt,
      },
      freshness,
    },
    {
      id: stressId,
      name: "DripTray maximum von Mises stress",
      metric: "assembly_max_von_mises",
      quantity: { value: capture.metrics.maximumVonMises.value, unit: "MPa" },
      source: {
        operation: solver,
        artifactIds: [solveId],
        capturedAt: capture.capturedAt,
      },
      freshness,
    },
  ];
  const requirements: TracedRequirement[] = [
    requirement(
      `${prefix}-drip-tray-displacement`,
      "CM-01 DripTray maximum displacement",
      "assembly_max_displacement",
      proof.limits.maximumDisplacementMm,
      "mm",
      proofId,
      stepId,
      freshness,
    ),
    requirement(
      `${prefix}-drip-tray-von-mises`,
      "CM-01 DripTray maximum von Mises stress",
      "assembly_max_von_mises",
      proof.limits.maximumVonMisesMpa,
      "MPa",
      proofId,
      stepId,
      freshness,
    ),
  ];
  const evaluations: RequirementEvaluation[] = requirements.map(
    (requirement, index) => {
      const oracleResult = oracleResults.get(requirement.criterion.metric);
      if (!oracleResult) {
        throw new Error(
          `Oracle result missing for metric "${requirement.criterion.metric}".`,
        );
      }
      return evaluationFromOracle(
        requirement,
        observations[index]!,
        oracleResult,
        oracleEvaluator,
        solveId,
        capture.capturedAt,
        freshness,
      );
    },
  );
  /**
   * Violations are derived from oracle verdicts only — never hardcoded. A fail
   * verdict without a named violation would be rejected by validateThreadSnapshot
   * (missing_violation); a violation without a fail verdict would equally be
   * rejected (unexpected_violation). Both rules are enforced symmetrically.
   */
  const violations: ThreadViolation[] = evaluations.flatMap((ev, index) => {
    if (ev.status !== "fail") return [];
    const req = requirements[index]!;
    const obs = observations[index]!;
    return [{
      id: `${ev.id}-violation`,
      name: `${req.name} exceeds the reviewed concept limit`,
      requirementId: req.id,
      evaluationId: ev.id,
      severity: "error" as const,
      status: "open" as const,
      detectedAt: capture.capturedAt,
      observationIds: [obs.id],
      evidenceArtifactIds: [solveId],
      summary: ev.message,
      freshness,
    }];
  });
  const proposedActions: ProposedThreadAction[] = violations.map((v) => ({
    id: `${v.id}-action`,
    name: `Review the concept limit violation: ${v.name}`,
    kind: "review" as const,
    readiness: "ready" as const,
    rationale: "A bounded oracle verdict identified a concept limit violation in the " +
      "V3 mechanical path; operator review is required before any further action is taken.",
    targets: [{ kind: "artifact" as const, id: solveId }],
    addressesViolationIds: [v.id],
    dependsOnActionIds: [],
  }));
  const extension = {
    id: `${prefix}-extension`,
    name: "Capture the attested CM-01 V3 DripTray static proof",
    subjectId: base.subject.id,
    capturedAt: capture.capturedAt,
    artifacts,
    consumptions: [consumption],
    observations,
    requirements,
    evaluations,
    violations,
    proposedActions,
    provenance: [
      link(
        `${prefix}-solve-from-step`,
        solveId,
        stepId,
        "derived_from",
        "CalculiX solved the isolated DripTray STEP after independently attesting its content hash.",
      ),
      link(
        `${prefix}-consumption-uses-step`,
        consumption.id,
        stepId,
        "uses",
        "CalculiX reported the SHA-256 of the STEP it consumed.",
        "consumption",
      ),
      ...observations.map((observation) =>
        link(
          `${observation.id}-from-solve`,
          observation.id,
          solveId,
          "derived_from",
          "The normalized mechanical observation came from the static solve.",
          "observation",
        )
      ),
      ...requirements.map((requirement) =>
        link(
          `${requirement.id}-traces-to-step`,
          requirement.id,
          stepId,
          "traces_to",
          "The reviewed concept limit constrains the isolated DripTray STEP proof target.",
          "requirement",
        )
      ),
      ...evaluations.flatMap((evaluation) => [
        link(
          `${evaluation.id}-evaluates-requirement`,
          evaluation.id,
          evaluation.requirementId,
          "evaluates",
          "The SysON constraint oracle classified the reviewed concept limit.",
          "evaluation",
          "requirement",
        ),
        ...evaluation.observationIds.map((observationId) =>
          link(
            `${evaluation.id}-uses-${observationId}`,
            evaluation.id,
            observationId,
            "uses",
            "The SysON constraint oracle used the normalized static-solve observation.",
            "evaluation",
            "observation",
          )
        ),
        ...evaluation.evidenceArtifactIds.map((artifactId) =>
          link(
            `${evaluation.id}-evidences-${artifactId}`,
            evaluation.id,
            artifactId,
            "evidences",
            "The static-solve evidence supports the bounded evaluation.",
            "evaluation",
          )
        ),
      ]),
      ...violations.flatMap((v) => [
        {
          id: `${v.id}-caused-by`,
          relation: "caused_by" as const,
          from: { kind: "violation" as const, id: v.id },
          to: { kind: "evaluation" as const, id: v.evaluationId },
          rationale:
            "The bounded oracle verdict on the concept limit caused this violation.",
        },
        ...v.evidenceArtifactIds.map((artId) => ({
          id: `${v.id}-evidences-${artId}`,
          relation: "evidences" as const,
          from: { kind: "violation" as const, id: v.id },
          to: { kind: "artifact" as const, id: artId },
          rationale:
            "The CalculiX solver result is the direct evidence for this violation.",
        })),
      ]),
      ...proposedActions.map((a) => ({
        id: `${a.id}-addresses`,
        relation: "addresses" as const,
        from: { kind: "action" as const, id: a.id },
        to: { kind: "violation" as const, id: a.addressesViolationIds[0]! },
        rationale:
          "This review action is proposed to address the concept limit violation.",
      })),
    ],
  };
  const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: capture.capturedAt,
  });
  const evidence = applied.snapshot.artifacts.find((item) => item.id === solveId);
  if (!evidence) throw new Error("CM-01 mechanical extension has no solver evidence.");
  return {
    snapshot: applied.snapshot,
    evidence: {
      snapshotId: applied.snapshot.id,
      snapshotRevision: applied.snapshot.revision,
      kind: "artifact",
      id: evidence.id,
    },
  };
}
function artifact(
  id: string,
  name: string,
  kind: ThreadArtifact["kind"],
  fingerprint: ContentFingerprint,
  uri: string,
  mediaType: string,
  producer: ThreadOperationRef,
  inputArtifactIds: string[],
  freshness: ThreadFreshness,
): ThreadArtifact {
  return {
    id,
    name,
    kind,
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType,
    producer,
    inputArtifactIds,
    freshness,
  };
}
function requirement(
  id: string,
  name: string,
  metric: string,
  value: number,
  unit: "mm" | "MPa",
  sourceArtifactId: string,
  targetArtifactId: string,
  freshness: ThreadFreshness,
): TracedRequirement {
  return {
    id,
    name,
    statement: `${metric} <= ${value} [${unit}]`,
    version: "cm01-v3",
    criterion: { metric, operator: "<=", limit: { value, unit } },
    trace: { sourceArtifactId, elementId: id, targetArtifactIds: [targetArtifactId] },
    freshness,
  };
}
/**
 * Thin adapter for the V1 path.
 *
 * callMechanicalConstraintOracle extracts the scalar metrics/limits from the
 * V1 capture and proof types and delegates to callDripTrayMechanicalOracle in
 * cm01-drip-tray-mechanical-oracle.ts.  The R2/R3 executors call
 * callDripTrayMechanicalOracle directly with their own capture/proof types.
 */
export async function callMechanicalConstraintOracle(
  syson: McpToolClient,
  capture: Cm01DripTrayMechanicalCapture,
  proof: Cm01DripTrayMechanicalProof,
): Promise<ReadonlyMap<string, ParsedOracleResult>> {
  return await callDripTrayMechanicalOracle(syson, proof.limits, {
    displacementMm: capture.metrics.maximumDisplacement.value,
    vonMisesMpa: capture.metrics.maximumVonMises.value,
  });
}
function link(
  id: string,
  fromId: string,
  toId: string,
  relation: "derived_from" | "uses" | "traces_to" | "evaluates" | "evidences",
  rationale: string,
  fromKind:
    | "artifact"
    | "consumption"
    | "observation"
    | "requirement"
    | "evaluation" = "artifact",
  toKind: "artifact" | "requirement" | "observation" = "artifact",
) {
  return {
    id,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale,
  };
}
function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== COFFEE_MACHINE_CM01_V3_MECHANICAL_PROJECT_ID ||
    project.project.subjectId !== COFFEE_MACHINE_CM01_V3_MECHANICAL_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_MECHANICAL_OPERATION.id ||
    workItem.operation.version !== COFFEE_MACHINE_CM01_V3_MECHANICAL_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued CM-01 V3 DripTray mechanical operation.",
    );
  }
  return workItem;
}
function requireClaimed(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
) {
  const item = requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the CM-01 mechanical run it claimed.",
    );
  }
  return item;
}
function requireRun(
  project: EngineeringProjectSnapshot,
  runId: string,
): EngineeringAgentRun {
  const run = project.agentRuns.find((item) => item.id === runId);
  if (!run) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Agent run ${runId} does not exist in project ${project.project.id}.`,
    );
  }
  return run;
}
function requireBasis(run: EngineeringAgentRun): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 mechanical run ${run.id} must have an exact ThreadSnapshot basis.`,
    );
  }
  return run.basis;
}
function requiredStart(run: EngineeringAgentRun): string {
  if (!run.startedAt || Number.isNaN(Date.parse(run.startedAt))) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 mechanical run ${run.id} has no durable start timestamp.`,
    );
  }
  return run.startedAt;
}
function snapshotRef(snapshot: ThreadSnapshot): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}
function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3MechanicalRunExecutorCommand,
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
      `CM-01 mechanical run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}
function unexpected(run: EngineeringAgentRun, status: string) {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `CM-01 mechanical run ${run.id} is ${run.status}; expected ${status}.`,
  );
}
function step(commandId: string, phase: string): string {
  return `${commandId}:cm01-drip-tray-mechanical:${phase}`;
}
function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}
