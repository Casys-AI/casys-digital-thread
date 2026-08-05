import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import {
  compileCoffeeMachineCm01SemanticCadPlanR2,
} from "../../domain/coffee-machine-cm01-semantic-cad-plan.ts";
import {
  type CoffeeMachineCm01SemanticRecipeR2,
  parseCoffeeMachineCm01SemanticRecipeR2,
} from "../../domain/coffee-machine-cm01-semantic-recipe.ts";
import {
  type Cm01DripTrayMechanicalProofR2,
  type Cm01DripTrayMechanicalProofR3,
  parseCm01DripTrayMechanicalProofR2,
  parseCm01DripTrayMechanicalProofR3,
} from "../../domain/cm01-drip-tray-mechanical-proof.ts";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  captureCm01DripTrayMechanicalR2,
  parseCm01DripTrayMechanicalR2Capture,
} from "../captures/cm01-drip-tray-mechanical-capture-r2.ts";
import {
  captureCm01DripTrayMechanicalR3,
  parseCm01DripTrayMechanicalR3Capture,
} from "../captures/cm01-drip-tray-mechanical-capture-r3.ts";
import { callDripTrayMechanicalOracle } from "../captures/cm01-drip-tray-mechanical-oracle.ts";
import {
  captureCm01SemanticCadExportR2,
  parseCm01SemanticCadR2Capture,
} from "../captures/cm01-semantic-cad-capture-r2.ts";
import {
  type Cm01R2Materialization,
  CoffeeMachineCm01V3CadR2SuccessorMaterializer,
  CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer,
} from "./coffee-machine-cm01-v3-r2-successor-materializer.ts";
import { CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer } from "./coffee-machine-cm01-v3-r3-successor-materializer.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import type { FileCaptureStore } from "../captures/file-capture-store.ts";
import { checkOracleRequirementsFidelityBeforeDispatch } from "./coffee-machine-cm01-v3-oracle-requirements-run-executor.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

export const COFFEE_MACHINE_CM01_V3_CAD_R2_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_R2_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30;
export const COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3;
export const COFFEE_MACHINE_CM01_V3_R2_PROJECT_ID = "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_R2_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

export interface CoffeeMachineCm01V3R2RunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

/** A write-ahead boundary around a provider call (or a two-provider handoff). */
export interface Cm01R2AttemptStore {
  begin(input: { projectId: string; runId: string; dispatchedAt: string }): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly captureFingerprint: ContentFingerprint }
  >;
  complete(input: {
    projectId: string;
    runId: string;
    completedAt: string;
    captureFingerprint: ContentFingerprint;
  }): Promise<void>;
}

/** Immutable capture storage; its URI deliberately contains no provider path. */
export interface Cm01R2CaptureStore {
  uriFor(fingerprint: ContentFingerprint): string;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  /**
   * Return type is { uri, path } rather than void so that FileCaptureStore<Kind>
   * (whose save() always returns both fields) satisfies this interface. Callers
   * in this executor discard the return value; the widening does not affect them.
   */
  save(
    fingerprint: ContentFingerprint,
    text: string,
  ): Promise<{ readonly uri: string; readonly path: string }>;
}

interface CommonDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly attempts: Cm01R2AttemptStore;
  readonly captures: Cm01R2CaptureStore;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

export interface CoffeeMachineCm01V3CadR2RunExecutorDependencies
  extends CommonDependencies {
  readonly recipe: CoffeeMachineCm01SemanticRecipeR2;
  readonly build123d: McpToolClient;
}

export interface CoffeeMachineCm01V3MechanicalR2RunExecutorDependencies
  extends CommonDependencies {
  readonly proof: Cm01DripTrayMechanicalProofR2;
  readonly syson: McpToolClient;
  readonly build123d: McpToolClient;
  readonly calculix: McpToolClient;
  /** Optional fidelity gate; see CoffeeMachineCm01V3MechanicalRunExecutorDependencies. */
  readonly requirementsCaptures?: FileCaptureStore<"oracle-requirements-seed">;
}

export interface CoffeeMachineCm01V3MechanicalR3RunExecutorDependencies
  extends CommonDependencies {
  readonly proof: Cm01DripTrayMechanicalProofR3;
  readonly syson: McpToolClient;
  readonly build123d: McpToolClient;
  readonly calculix: McpToolClient;
  /** Optional fidelity gate; see CoffeeMachineCm01V3MechanicalRunExecutorDependencies. */
  readonly requirementsCaptures?: FileCaptureStore<"oracle-requirements-seed">;
}

/**
 * Trusted R2 CAD execution. The only agent-controlled value is an already queued
 * run id; recipe, tool, arguments and capture contract remain server-owned.
 */
export class CoffeeMachineCm01V3CadR2RunExecutor {
  readonly #recipe: CoffeeMachineCm01SemanticRecipeR2;
  readonly #build123d: McpToolClient;
  readonly #common: R2ExecutorCommon;

  constructor(dependencies: CoffeeMachineCm01V3CadR2RunExecutorDependencies) {
    this.#recipe = parseCoffeeMachineCm01SemanticRecipeR2(dependencies.recipe);
    this.#build123d = dependencies.build123d;
    this.#common = new R2ExecutorCommon(
      dependencies,
      COFFEE_MACHINE_CM01_V3_CAD_R2_OPERATION,
    );
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3R2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return await this.#common.execute(origin, command, "cad", async (base, run) => {
      const compiled = await compileCoffeeMachineCm01SemanticCadPlanR2(this.#recipe);
      const capture = await this.#common.captureOnce(
        base.project,
        run,
        async () =>
          await captureCm01SemanticCadExportR2(
            this.#build123d,
            compiled,
            this.#common.now,
          ),
        parseCm01SemanticCadR2Capture,
        (value) =>
          value.plan.recipe.key === this.#recipe.recipeKey &&
          deterministicJson(value.plan) === deterministicJson(compiled.plan) &&
          value.script === compiled.script,
      );
      const materialized = new CoffeeMachineCm01V3CadR2SuccessorMaterializer()
        .materialize(
          base.snapshot,
          run.id,
          capture.value,
          capture.uri,
        );
      return { materialized, capturedAt: capture.value.capturedAt };
    });
  }
}

/**
 * Trusted R2 mechanical execution. It requires the R2 assembly in its basis
 * for project lineage while the actual CalculiX input stays the separate,
 * explicitly labelled isolated DripTray STEP.
 */
export class CoffeeMachineCm01V3MechanicalR2RunExecutor {
  readonly #proof: Cm01DripTrayMechanicalProofR2;
  readonly #syson: McpToolClient;
  readonly #build123d: McpToolClient;
  readonly #calculix: McpToolClient;
  readonly #common: R2ExecutorCommon;
  readonly #requirementsCaptures:
    | FileCaptureStore<"oracle-requirements-seed">
    | undefined;

  constructor(dependencies: CoffeeMachineCm01V3MechanicalR2RunExecutorDependencies) {
    this.#proof = parseCm01DripTrayMechanicalProofR2(dependencies.proof);
    this.#syson = dependencies.syson;
    this.#build123d = dependencies.build123d;
    this.#calculix = dependencies.calculix;
    this.#requirementsCaptures = dependencies.requirementsCaptures;
    this.#common = new R2ExecutorCommon(
      dependencies,
      COFFEE_MACHINE_CM01_V3_MECHANICAL_R2_OPERATION,
    );
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3R2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return await this.#common.execute(
      origin,
      command,
      "mechanical",
      async (base, run) => {
        // Fidelity gate before any provider dispatch.
        await checkOracleRequirementsFidelityBeforeDispatch(
          base.snapshot,
          this.#common.snapshots,
          this.#proof,
          this.#syson,
          this.#requirementsCaptures,
        );
        const capture = await this.#common.captureOnce(
          base.project,
          run,
          async () =>
            await captureCm01DripTrayMechanicalR2(
              this.#build123d,
              this.#calculix,
              this.#proof,
              this.#common.now,
            ),
          parseCm01DripTrayMechanicalR2Capture,
        );
        const oracleResults = await callDripTrayMechanicalOracle(
          this.#syson,
          this.#proof.limits,
          {
            displacementMm: capture.value.metrics.maximumDisplacement.value,
            vonMisesMpa: capture.value.metrics.maximumVonMises.value,
          },
        );
        const materialized =
          await new CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer()
            .materialize(
              base.snapshot,
              run.id,
              capture.value,
              capture.uri,
              this.#proof,
              oracleResults,
            );
        return { materialized, capturedAt: capture.value.capturedAt };
      },
    );
  }
}

/**
 * Explicit recovery executor. It shares only the already-audited lease and
 * write-ahead machinery; it has a distinct operation, proof parser, capture
 * schema and attempt/capture directories, so it can never requeue failed R2.
 */
export class CoffeeMachineCm01V3MechanicalR3RunExecutor {
  readonly #proof: Cm01DripTrayMechanicalProofR3;
  readonly #syson: McpToolClient;
  readonly #build123d: McpToolClient;
  readonly #calculix: McpToolClient;
  readonly #common: R2ExecutorCommon;
  readonly #requirementsCaptures:
    | FileCaptureStore<"oracle-requirements-seed">
    | undefined;

  constructor(dependencies: CoffeeMachineCm01V3MechanicalR3RunExecutorDependencies) {
    this.#proof = parseCm01DripTrayMechanicalProofR3(dependencies.proof);
    this.#syson = dependencies.syson;
    this.#build123d = dependencies.build123d;
    this.#calculix = dependencies.calculix;
    this.#requirementsCaptures = dependencies.requirementsCaptures;
    this.#common = new R2ExecutorCommon(
      dependencies,
      COFFEE_MACHINE_CM01_V3_MECHANICAL_R3_OPERATION,
    );
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3R2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return await this.#common.execute(
      origin,
      command,
      "mechanical",
      async (base, run) => {
        // Fidelity gate before any provider dispatch.
        await checkOracleRequirementsFidelityBeforeDispatch(
          base.snapshot,
          this.#common.snapshots,
          this.#proof,
          this.#syson,
          this.#requirementsCaptures,
        );
        const capture = await this.#common.captureOnce(
          base.project,
          run,
          async () =>
            await captureCm01DripTrayMechanicalR3(
              this.#build123d,
              this.#calculix,
              this.#proof,
              this.#common.now,
            ),
          parseCm01DripTrayMechanicalR3Capture,
        );
        const oracleResults = await callDripTrayMechanicalOracle(
          this.#syson,
          this.#proof.limits,
          {
            displacementMm: capture.value.metrics.maximumDisplacement.value,
            vonMisesMpa: capture.value.metrics.maximumVonMises.value,
          },
        );
        const materialized =
          await new CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer()
            .materialize(
              base.snapshot,
              run.id,
              capture.value,
              capture.uri,
              this.#proof,
              oracleResults,
            );
        return { materialized, capturedAt: capture.value.capturedAt };
      },
    );
  }
}

interface R2ExecutionBase {
  readonly project: EngineeringProjectSnapshot;
  readonly snapshot: ThreadSnapshot;
}

interface Captured<Capture> {
  readonly value: Capture;
  readonly uri: string;
}

class R2ProviderOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The reviewed CM-01 R2 provider outcome is unknown and will not be replayed automatically.",
    );
  }
}

class R2ExecutorCommon {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #attempts: Cm01R2AttemptStore;
  readonly #captures: Cm01R2CaptureStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #live: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #operation: { readonly id: string; readonly version: string };
  readonly now: () => string;

  constructor(
    dependencies: CommonDependencies,
    operation: { readonly id: string; readonly version: string },
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#attempts = dependencies.attempts;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
    this.#live = dependencies.liveUpdates;
    this.#operation = operation;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  /**
   * Expose the shared snapshots store so that mechanical executor perform
   * callbacks can pass it to checkOracleRequirementsFidelityBeforeDispatch.
   */
  get snapshots(): ThreadSnapshotStore {
    return this.#snapshots;
  }

  async execute<Capture>(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3R2RunExecutorCommand,
    kind: "cad" | "mechanical",
    perform: (base: R2ExecutionBase, run: EngineeringAgentRun) => Promise<{
      materialized: Cm01R2Materialization;
      capturedAt: string;
    }>,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed CM-01 R2 provider operation.",
      );
    }
    const checked = await this.requiredProject(command.projectId);
    const checkedRun = requireRun(checked, command.runId);
    validateR2RunShape(checked, checkedRun, kind, this.#operation);
    return await this.#lease.withLease(command.projectId, command.runId, async () => {
      let claimed = false;
      let materialized: Cm01R2Materialization | undefined;
      try {
        let project = await this.requiredProject(command.projectId);
        let run = requireRun(project, command.runId);
        validateR2RunShape(project, run, kind, this.#operation);
        const snapshot = await this.requiredBasis(project, run, kind);
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: step(command.commandId, "claim"),
          summary: `Started the reviewed CM-01 R2 ${kind} evidence capture.`,
        });
        claimed = true;
        project = await this.requiredProject(command.projectId);
        run = requireRun(project, command.runId);
        validateClaim(project, run, origin, kind, this.#operation);
        if (run.status === "completed") {
          assertCompleted(project, command);
          await this.reconcile(project.project.subjectId, run.id);
          return project;
        }
        if (run.status !== "running") throw unexpectedStatus(run, "running");
        const startedAt = requiredStart(run);
        await this.recordLive(
          project.project.subjectId,
          run.id,
          snapshot.revision,
          "running",
          startedAt,
          kind === "cad"
            ? "CM-01 30 mm CAD export running"
            : "CM-01 30 mm mechanical proof running",
          kind === "cad"
            ? "Compiling the corrected semantic recipe and exporting the R2 assembly evidence."
            : "Exporting the isolated 30 mm DripTray and running the bounded static solve.",
        );
        const result = await perform({ project, snapshot }, run);
        materialized = result.materialized;
        await this.#snapshots.save(materialized.snapshot);
        if ((await this.presence(materialized.snapshot)) !== "exact") {
          throw new Error(
            "CM-01 R2 successor snapshot persistence could not be verified.",
          );
        }
        await this.recordLive(
          project.project.subjectId,
          run.id,
          snapshot.revision,
          "fresh",
          result.capturedAt,
          kind === "cad"
            ? "CM-01 30 mm CAD evidence captured"
            : "CM-01 30 mm mechanical evidence captured",
          kind === "cad"
            ? "The corrected assembly plan, script and STEP successor are now traceable."
            : "CalculiX attested the exact isolated DripTray STEP it consumed; it did not consume the assembly STEP.",
        );
        project = await this.requiredProject(command.projectId);
        run = requireRun(project, command.runId);
        if (run.status === "running") {
          await this.#commands.publishRun(origin, {
            ...command,
            commandId: step(command.commandId, "publish"),
            expectedRevision: project.revision,
            summary: `Publishing the CM-01 R2 ${kind} successor evidence.`,
          });
        } else if (run.status !== "publishing" && run.status !== "completed") {
          throw unexpectedStatus(run, "publishing");
        }
        project = await this.requiredProject(command.projectId);
        run = requireRun(project, command.runId);
        if (run.status === "publishing") {
          await this.#commands.completeRun(origin, {
            ...command,
            commandId: step(command.commandId, "complete"),
            expectedRevision: project.revision,
            summary: `Recorded the reviewed CM-01 R2 ${kind} successor evidence.`,
            resultSnapshot: snapshotRef(materialized.snapshot),
            evidenceRefs: [{
              snapshotId: materialized.snapshot.id,
              snapshotRevision: materialized.snapshot.revision,
              kind: "artifact",
              id: materialized.evidenceArtifactId,
            }],
          });
        } else if (run.status !== "completed") throw unexpectedStatus(run, "completed");
        const completed = await this.requiredProject(command.projectId);
        assertCompleted(completed, command);
        await this.reconcile(completed.project.subjectId, command.runId);
        return completed;
      } catch (error) {
        if (materialized && (await this.presence(materialized.snapshot)) === "exact") {
          const completed = await this.completedFor(command);
          if (completed) return completed;
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "CM-01 R2 evidence is durable but its project attachment did not finish. Retry this exact command; providers will not run again.",
          );
        }
        if (error instanceof R2ProviderOutcomeUnknownError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "The CM-01 R2 provider outcome is unknown. Inspect local providers before any reviewed recovery; it will not be replayed automatically.",
          );
        }
        if (claimed) await this.recordFailure(origin, command, kind);
        throw error;
      }
    });
  }

  async captureOnce<Capture>(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    capture: () => Promise<Capture>,
    parse: (value: unknown) => Promise<Capture>,
    matches?: (capture: Capture) => boolean,
  ): Promise<Captured<Capture>> {
    let attempt: Awaited<ReturnType<Cm01R2AttemptStore["begin"]>>;
    try {
      attempt = await this.#attempts.begin({
        projectId: project.project.id,
        runId: run.id,
        dispatchedAt: requiredStart(run),
      });
    } catch {
      throw new R2ProviderOutcomeUnknownError();
    }
    if (attempt.action === "completed") {
      const text = await this.#captures.read(attempt.captureFingerprint);
      if (!text) throw new Error("Completed CM-01 R2 attempt has no readable capture.");
      const value = await parse(JSON.parse(text));
      const storageFingerprint = await sha256Fingerprint(value);
      if (
        storageFingerprint.digest !== attempt.captureFingerprint.digest ||
        (matches && !matches(value))
      ) {
        throw new Error(
          "Persisted CM-01 R2 capture does not match the reviewed operation.",
        );
      }
      return { value, uri: this.#captures.uriFor(storageFingerprint) };
    }
    const value = await capture();
    if (matches && !matches(value)) {
      throw new Error(
        "CM-01 R2 provider capture does not match the reviewed operation.",
      );
    }
    const text = deterministicJson(value);
    const parsed = await parse(JSON.parse(text));
    if (deterministicJson(parsed) !== deterministicJson(value)) {
      throw new Error("CM-01 R2 capture is not canonically self-consistent.");
    }
    const storageFingerprint = await sha256Fingerprint(value);
    await this.#captures.save(storageFingerprint, text);
    await this.#attempts.complete({
      projectId: project.project.id,
      runId: run.id,
      completedAt: captureTime(value),
      captureFingerprint: storageFingerprint,
    });
    return { value, uri: this.#captures.uriFor(storageFingerprint) };
  }

  private async requiredBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    kind: "cad" | "mechanical",
  ): Promise<ThreadSnapshot> {
    const basis = requireBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 R2 run basis belongs to another project subject.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot basis for this CM-01 R2 run is unavailable.",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The exact CM-01 R2 basis is invalid: ${message(error)}`,
      );
    }
    requireR2BasisArtifacts(snapshot, kind);
    if (kind === "mechanical") {
      requireMechanicalCadBinding(project, run, snapshot);
    }
    return snapshot;
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  private async presence(
    snapshot: ThreadSnapshot,
  ): Promise<"exact" | "absent" | "unknown"> {
    try {
      const found = await this.#snapshots.get(snapshot.id);
      return !found
        ? "absent"
        : deterministicJson(found) === deterministicJson(snapshot)
        ? "exact"
        : "unknown";
    } catch {
      return "unknown";
    }
  }

  private async completedFor(
    command: CoffeeMachineCm01V3R2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
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
    try {
      await this.#live?.appendOnce({
        subjectId,
        runId,
        operationId: this.#operation.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:${this.#operation.id}@${this.#operation.version}`,
            ref: { kind: "artifact", id: `${runId}:${this.#operation.id}` },
            entityKind: "artifact",
            artifactKind: "evidence",
            activityRole: "milestone",
            label,
            system: this.#operation.id.includes("mechanical")
              ? "CalculiX"
              : "build123d",
            freshness: state,
            summary,
            recordedAt,
          }],
          edges: [],
        },
      });
    } catch { /* presentation is not an evidence prerequisite */ }
  }

  private async reconcile(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#live?.reconcileRunOnce(subjectId, runId, this.now());
    } catch { /* optional overlay */ }
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3R2RunExecutorCommand,
    kind: "cad" | "mechanical",
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: step(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          `CM-01 R2 ${kind} capture stopped before durable evidence was published.`,
        code: `cm01-r2-${kind}-not-published`,
        message:
          "The reviewed provider operation did not produce durable project evidence. No automatic provider retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        requireBasis(run).revision,
        "failed",
        this.now(),
        `CM-01 R2 ${kind} capture stopped`,
        "The operation stopped before canonical evidence was published and was not automatically repeated.",
      );
    } catch { /* preserve the root failure */ }
  }
}

function validateR2RunShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  kind: "cad" | "mechanical",
  operation: { readonly id: string; readonly version: string },
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const expected = kind === "cad"
    ? [["approvedBrief", "approved-brief"], [
      "dripTrayHeightCorrection",
      "thread-entity",
    ]]
    : [["approvedBrief", "approved-brief"], [
      "dripTrayHeightCorrection",
      "thread-entity",
    ], ["revisedCadStep", "thread-entity"]];
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== COFFEE_MACHINE_CM01_V3_R2_PROJECT_ID ||
    project.project.subjectId !== COFFEE_MACHINE_CM01_V3_R2_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !== operation.id ||
    workItem.operation.version !== operation.version ||
    deterministicJson(
        workItem.operation.bindings.map((
          binding,
        ) => [binding.name, binding.source.kind]),
      ) !== deterministicJson(expected)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `This executor may run only the canonical CM-01 V3 ${kind} @2 operation.`,
    );
  }
  const bindings = workItem.operation.bindings;
  const correction = bindings.find((binding) =>
    binding.name === "dripTrayHeightCorrection"
  );
  if (
    correction?.source.kind !== "thread-entity" ||
    correction.source.reference.kind !== "artifact" ||
    correction.source.reference.id !==
      "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record" ||
    correction.source.reference.snapshotId !== run.basis.snapshotId ||
    correction.source.reference.snapshotRevision !== run.basis.revision
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The CM-01 R2 run must bind the exact correction artifact from its basis.",
    );
  }
  if (kind === "mechanical") {
    const cad = bindings.find((binding) => binding.name === "revisedCadStep");
    if (
      cad?.source.kind !== "thread-entity" ||
      cad.source.reference.kind !== "artifact" ||
      cad.source.reference.snapshotId !== run.basis.snapshotId ||
      cad.source.reference.snapshotRevision !== run.basis.revision
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The CM-01 R2 mechanical run must bind an exact revised CAD STEP from its basis.",
      );
    }
  }
  return workItem;
}

function validateClaim(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
  kind: "cad" | "mechanical",
  operation: { readonly id: string; readonly version: string },
): void {
  validateR2RunShape(project, run, kind, operation);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 R2 run it claimed.",
    );
  }
}

function requireR2BasisArtifacts(
  snapshot: ThreadSnapshot,
  kind: "cad" | "mechanical",
): void {
  const correction = snapshot.artifacts.filter((item) =>
    item.id === "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record" &&
    item.freshness.status === "fresh"
  );
  if (correction.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The CM-01 R2 run basis lacks its fresh correction artifact.",
    );
  }
  if (kind === "cad") return;
  const assembly = snapshot.artifacts.filter((item) =>
    item.kind === "step" && item.name === "CM-01 30 mm DripTray assembly STEP export" &&
    item.freshness.status === "fresh"
  );
  if (assembly.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The CM-01 R2 mechanical basis lacks its fresh R2 assembly STEP successor.",
    );
  }
}

/**
 * The mechanical operation never treats an arbitrary artifact in the same
 * snapshot as its revised CAD binding. The basis must contain the R2 assembly
 * and the reviewed binding must name that exact assembly artifact. CalculiX
 * still receives its separately generated isolated DripTray STEP later.
 */
function requireMechanicalCadBinding(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
  const binding = workItem.operation!.bindings.find((item) =>
    item.name === "revisedCadStep"
  );
  const assembly = snapshot.artifacts.find((item) =>
    item.kind === "step" &&
    item.name === "CM-01 30 mm DripTray assembly STEP export" &&
    item.freshness.status === "fresh"
  );
  if (
    binding?.source.kind !== "thread-entity" ||
    !assembly || binding.source.reference.id !== assembly.id
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The CM-01 R2 mechanical run must bind the exact fresh R2 assembly STEP from its basis.",
    );
  }
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3R2RunExecutorCommand,
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
      `CM-01 R2 run ${run.id} did not complete through this exact execution command.`,
    );
  }
}
function step(commandId: string, suffix: string): string {
  return `${commandId}:${suffix}`;
}
function captureTime(value: unknown): string {
  if (
    typeof value !== "object" || value === null ||
    typeof (value as { capturedAt?: unknown }).capturedAt !== "string"
  ) throw new Error("CM-01 R2 capture has no timestamp.");
  return (value as { capturedAt: string }).capturedAt;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown validation failure";
}
