/**
 * Trusted executor for `buy.capture-configuration-cost@1`.
 *
 * Calls locked `erpnext_buy_capture` only after a qualified ERP binding and
 * signed MRTR. Publishes a documentary candidate, not approved spend.
 */

import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { BuyConfigurationSourceReader } from "../../application/ports/out/buy/buy-configuration-source-reader.ts";
import type { BuyQualifiedErpBindingResolver } from "../../application/ports/out/buy/buy-qualified-erp-binding.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  buyGeometryApplicability,
  recrossBuyConfigurationThreadBasis,
} from "../../domain/buy/buy-applicability.ts";
import {
  type BuyConfiguration,
  validateBuyConfiguration,
} from "../../domain/buy/buy-configuration.ts";
import { computeBuyCostCandidate } from "../../domain/buy/buy-cost-bundle.ts";
import { selectBuyCostLines } from "../../domain/buy/buy-cost-selection.ts";
import {
  BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
  BUY_CAPTURE_CONFIGURATION_COST_TOOL,
} from "../../domain/buy/buy-operations.ts";
import {
  type BuyCaptureDecisionParameters,
  parseBuyCaptureDecisionParameters,
} from "../../domain/buy/buy-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadEntityKind,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../application/control-plane/capability-runtime-execution-admission.ts";
import { requiredQualifiedPersistentComposePublication } from "../../application/control-plane/capability-runtime-persistent-compose-publication.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../application/control-plane/capability-runtime-execution-session.ts";
import type {
  CapabilityRuntimeExecutionEligibility,
  CapabilityRuntimeSecretSnapshotResolver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { CapabilityRuntimeLaunchGroupSafetyError } from "../../application/control-plane/capability-runtime-launch-group-supervisor.ts";
import {
  type CapabilityRuntimeLaunchGroupReference,
  sameCapabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { LocalErpnextBuyInstallationProfile } from "../control-plane/local-erpnext-buy-installation-profile.ts";
import {
  type CapabilityRuntimeBoundMcpClient,
  CapabilityRuntimeConnectionError,
} from "../../application/ports/out/capability/capability-runtime-connection.ts";
import { ERPNEXT_BUY_RUNTIME_BINDING_ID } from "../control-plane/local-erpnext-buy-installation-profile.ts";
import type { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../shared/thread-write-basis-guard.ts";
import {
  BUY_CANDIDATE_CAPTURE_SCHEMA,
  type BuyCandidateCapture,
  canonicalBuyCandidateCaptureText,
  validateBuyCandidateCapture,
} from "../../domain/buy/buy-candidate-capture.ts";
import {
  assertBuyCompleted,
  buyCommandStep,
  buyErrorMessage,
  exactBuyBasisSnapshot,
  requireBuyMrtrApproval,
  requireBuyOperationShape,
} from "./buy-executor-support.ts";
import { ErpnextBuyCaptureClient } from "./erpnext-buy-capture-client.ts";
import type { BuySourceCaptureEnvelope } from "../../domain/buy/buy-source-capture.ts";

export { BUY_CAPTURE_CONFIGURATION_COST_OPERATION };

export const BUY_CAPTURE_THREAD_WRITE_OUTCOME_UNKNOWN =
  "buy-capture-configuration-cost-thread-write-outcome-unknown";

export interface BuyCaptureThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface BuyCaptureConfigurationCostRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: BuyCaptureThreadSnapshotStore;
  readonly captures: Pick<
    FileCaptureStore<"buy-configuration-cost-candidate">,
    "save" | "read" | "uriFor"
  >;
  readonly configurations: BuyConfigurationSourceReader;
  readonly bindings: BuyQualifiedErpBindingResolver;
  readonly erpnext?: ErpnextBuyCaptureClient;
  readonly lease: EngineeringProjectRunLease;
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin" | "releaseRecorded"
  >;
  readonly capabilityRuntimeConnection?: CapabilityRuntimeBoundMcpClient;
  readonly erpInstallation?: LocalErpnextBuyInstallationProfile;
  readonly erpLaunchGroup?: CapabilityRuntimeLaunchGroupReference;
  readonly capabilityRuntimeSecrets?: Pick<
    CapabilityRuntimeSecretSnapshotResolver,
    "beginSnapshot"
  >;
}

export class BuyCaptureConfigurationCostRunExecutor {
  constructor(
    private readonly deps: BuyCaptureConfigurationCostRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the buy-capture-configuration-cost run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireBuyOperationShape(
      project,
      run,
      BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
      BUY_CAPTURE_CONFIGURATION_COST_OPERATION.version,
      BUY_CAPTURE_CONFIGURATION_COST_TOOL,
    );
    const { proposal } = requireBuyMrtrApproval(project, run, "Buy capture");
    let decisionParams: BuyCaptureDecisionParameters;
    try {
      decisionParams = parseBuyCaptureDecisionParameters(proposal.parameters);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Buy capture decision parameters are invalid: ${buyErrorMessage(error)}`,
      );
    }
    const binding = await this.deps.bindings.resolve({ project });
    if (binding.status !== "qualified") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        binding.reason,
      );
    }
    if (
      binding.binding.sourceInstance.siteId !==
        decisionParams.authorizedSiteFingerprint
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Authorized ERP site fingerprint does not match the qualified binding.",
      );
    }
    return await this.deps.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, decisionParams),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
    decisionParams: BuyCaptureDecisionParameters,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      requireBuyOperationShape(
        preClaim,
        requireRun(preClaim, command.runId),
        BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
        BUY_CAPTURE_CONFIGURATION_COST_OPERATION.version,
        BUY_CAPTURE_CONFIGURATION_COST_TOOL,
      );
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;
      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );
      const preClaimRun = requireRun(preClaim, command.runId);
      if (
        preClaimRun.status === "queued" ||
        preClaimRun.status === "running" ||
        preClaimRun.status === "publishing"
      ) {
        await this.deps.commands.claimRun(origin, {
          ...command,
          commandId: buyCommandStep(command.commandId, "claim"),
          summary: "Started the Buy configuration-cost capture.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(
          preClaimRun,
          "queued or this agent's running/publishing",
        );
      }
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      if (run.status === "completed") {
        assertBuyCompleted(project, command);
        return project;
      }
      const { decision } = requireBuyMrtrApproval(project, run, "Buy capture");
      const basis = requireBasis(run);
      const basisSnapshot = await exactBuyBasisSnapshot(
        this.deps.snapshots,
        basis,
      );
      await assertThreadSnapshotLineageIntact(
        basisSnapshot,
        this.deps.snapshots,
      );
      const configuration = await this.#reopenConfiguration(decisionParams);
      if (configuration.projectId !== command.projectId) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "Buy configuration projectId does not match the run project.",
        );
      }
      requireMatchingConfigurationBasis(basis, configuration);
      requireCurrentGeometry(basisSnapshot, configuration);
      const binding = await this.deps.bindings.resolve({ project });
      if (binding.status !== "qualified") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          binding.reason,
        );
      }
      if (
        binding.binding.sourceInstance.siteId !==
          decisionParams.authorizedSiteFingerprint
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "Authorized ERP site fingerprint does not match the qualified binding.",
        );
      }
      const envelope = await this.#capture(project, run, decisionParams);
      if (
        envelope.capture.sourceInstance.siteId !==
          binding.binding.sourceInstance.siteId ||
        envelope.capture.sourceInstance.siteId !==
          decisionParams.authorizedSiteFingerprint
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "Capture sourceInstance does not match the authorized ERP site binding.",
        );
      }
      const bundle = computeBuyCostCandidate({
        configuration,
        configurationDigest: decisionParams.configurationDigest,
        captures: [envelope],
        authorizedSiteId: binding.binding.sourceInstance.siteId,
        pricingContext: decisionParams.pricing,
        selections: selectBuyCostLines(configuration, [envelope]),
      });
      const bundleDigest = (await sha256Fingerprint(bundle)).digest;
      const capturedAt = requiredStart(run);
      const capture: BuyCandidateCapture = {
        schemaVersion: BUY_CANDIDATE_CAPTURE_SCHEMA,
        kind: "buy.configuration-cost-candidate",
        operation: BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
        trustedRunId: run.id,
        decisionId: decision.id,
        configurationDigest: decisionParams.configurationDigest,
        bundleDigest,
        configuration,
        bundle,
        sourceCaptures: [envelope],
        capturedAt,
      };
      const validated = await validateBuyCandidateCapture(capture);
      const captureText = canonicalBuyCandidateCaptureText(validated);
      const captureFingerprint = await sha256Fingerprint(validated);
      await this.deps.captures.save(captureFingerprint, captureText);
      const readBack = await this.deps.captures.read(captureFingerprint);
      if (readBack !== captureText) {
        throw new Error(
          "Buy candidate capture was not durably readable after save.",
        );
      }
      const successor = buildCandidateSuccessor({
        basisSnapshot,
        basis,
        run,
        capture: validated,
        captureFingerprint,
        captureUri: this.deps.captures.uriFor(captureFingerprint),
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.deps.snapshots.save(successor.snapshot);
      const snapshotReadback = await this.deps.snapshots.getFresh(
        successor.snapshot.id,
      );
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !==
          deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Buy candidate ThreadSnapshot was not durably readable after save.",
        );
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.deps.commands.publishRun(origin, {
          ...command,
          commandId: buyCommandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the Buy configuration-cost candidate.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.deps.commands.completeRun(origin, {
          ...command,
          commandId: buyCommandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            `Captured Buy cost candidate ${validated.bundleDigest} as documentary evidence.`,
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact" as ThreadEntityKind,
            id: successor.artifact.id,
          }],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const complete = await this.#requiredProject(command.projectId);
      assertBuyCompleted(complete, command);
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Buy capture evidence may be durable but project attachment " +
            `did not finish (${BUY_CAPTURE_THREAD_WRITE_OUTCOME_UNKNOWN}). ` +
            `Cause: ${buyErrorMessage(error)}`,
        );
      }
      if (claimed) {
        try {
          await this.deps.commands.failRun(origin, {
            ...command,
            commandId: buyCommandStep(command.commandId, "fail"),
            expectedRevision: (await this.#requiredProject(command.projectId)).revision,
            summary:
              "Buy configuration-cost capture failed before a durable Thread write.",
            code: "buy-capture-configuration-cost-failed",
            message: buyErrorMessage(error),
          });
        } catch {
          // The original error is the one to surface.
        }
      }
      throw error;
    }
  }

  async #capture(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    decisionParams: BuyCaptureDecisionParameters,
  ): Promise<BuySourceCaptureEnvelope> {
    const runtimeParts = [
      this.deps.capabilityRuntime,
      this.deps.capabilityRuntimeSession,
      this.deps.capabilityRuntimeConnection,
      this.deps.erpInstallation,
      this.deps.erpLaunchGroup,
    ];
    const hasRuntimePart = [...runtimeParts, this.deps.capabilityRuntimeSecrets]
      .some((part) => part !== undefined);
    const jit = runtimeParts.every((part) => part !== undefined);
    if ((this.deps.erpnext && hasRuntimePart) || (!this.deps.erpnext && !jit)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Buy capture requires one complete runtime mode; mixed or incomplete JIT dependencies are refused.",
      );
    }
    if (!jit) {
      if (!this.deps.erpnext) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Qualified ERP Buy capture requires the bound capability runtime session.",
        );
      }
      return await this.deps.erpnext.capture(decisionParams.documents);
    }
    const workItem = project.workItems.find((item) => item.id === run.workItemId);
    if (!workItem?.operation) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Buy capture requires the sealed operational capability before dispatch.",
      );
    }
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;
    try {
      const operationalCapability = await requireConfiguredOperationalCapability({
        runtime: this.deps.capabilityRuntime,
        session: this.deps.capabilityRuntimeSession,
        project,
        run,
        workItem,
        unavailableMessage:
          "Buy capture requires the configured JIT capability runtime session before ERP dispatch.",
        missingBindingMessage:
          "Buy capture requires the sealed commerce.read-erpnext-buy-source@1 operational capability before ERP dispatch.",
      });
      const publication = requiredQualifiedPersistentComposePublication(
        operationalCapability,
      );
      if (publication.binding.id !== ERPNEXT_BUY_RUNTIME_BINDING_ID) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Sealed operational capability is not the ERP Buy runtime binding.",
        );
      }
      if (
        !this.deps.erpLaunchGroup ||
        !sameCapabilityRuntimeLaunchGroupReference(
          publication.launchGroup,
          this.deps.erpLaunchGroup,
        )
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Sealed ERP Buy launch group does not match the trusted installed profile.",
        );
      }
      if (
        this.deps.erpInstallation?.sourceInstance.siteId !==
          decisionParams.authorizedSiteFingerprint
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "Authorized ERP site fingerprint does not match the trusted installed site.",
        );
      }
      const secretSnapshot = await this.#mintErpSecretSnapshot(
        publication.launchGroup,
      );
      capabilitySession = await beginConfiguredCapabilityRuntimeSession({
        session: this.deps.capabilityRuntimeSession!,
        project,
        runId: run.id,
        operationalCapability,
        recheck: async () => {
          const fresh = await this.#requiredProject(project.project.id);
          const freshRun = requireRun(fresh, run.id);
          const freshWork = fresh.workItems.find((item) =>
            item.id === freshRun.workItemId
          );
          if (!freshWork?.operation) {
            throw new CapabilityRuntimeSessionUnavailableError(
              "Buy capture operational capability is no longer sealed.",
            );
          }
          return await requireConfiguredOperationalCapability({
            runtime: this.deps.capabilityRuntime,
            session: this.deps.capabilityRuntimeSession,
            project: fresh,
            run: freshRun,
            workItem: freshWork,
            unavailableMessage:
              "Buy capture requires the configured JIT capability runtime session before ERP dispatch.",
            missingBindingMessage:
              "Buy capture requires the sealed commerce.read-erpnext-buy-source@1 operational capability before ERP dispatch.",
          });
        },
        ...(secretSnapshot === undefined ? {} : { secretSnapshot }),
      });
      const handle = await this.deps.capabilityRuntimeConnection!.broker
        .connect({
          lease: capabilitySession.lease,
          binding: publication.binding,
          launchGroup: publication.launchGroup,
        });
      const client = await this.deps.capabilityRuntimeConnection!.openMcpClient(
        handle,
      );
      const envelope = await new ErpnextBuyCaptureClient(client).capture(
        decisionParams.documents,
      );
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "release" },
      });
      capabilitySession = undefined;
      return envelope;
    } catch (error) {
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "retain" },
      });
      if (
        error instanceof CapabilityRuntimeSessionUnavailableError ||
        error instanceof CapabilityRuntimeConnectionError ||
        error instanceof CapabilityRuntimeLaunchGroupSafetyError
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          error.message,
        );
      }
      throw error;
    }
  }

  async #mintErpSecretSnapshot(
    launchGroup: CapabilityRuntimeLaunchGroupReference,
  ) {
    const slots =
      this.deps.erpInstallation?.launchGroup.secretSlots.map((slot) => slot.id) ?? [];
    if (slots.length === 0) return undefined;
    if (!this.deps.capabilityRuntimeSecrets) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "ERP Buy capture requires the exact installed secret snapshot before dispatch.",
      );
    }
    try {
      return await this.deps.capabilityRuntimeSecrets.beginSnapshot({
        group: launchGroup,
        slots,
      });
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        buyErrorMessage(error),
      );
    }
  }

  async #reopenConfiguration(
    decisionParams: BuyCaptureDecisionParameters,
  ): Promise<BuyConfiguration> {
    const text = await this.deps.configurations.read(
      decisionParams.configurationResourceUri,
      decisionParams.configurationResourceDigest,
    );
    if (text === undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The signed Buy configuration agent-resource is not readable.",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The signed Buy configuration is not JSON.",
      );
    }
    const configuration = validateBuyConfiguration(value);
    const digest = (await sha256Fingerprint(configuration)).digest;
    if (digest !== decisionParams.configurationDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Reopened configuration digest does not match the signed configuration digest.",
      );
    }
    if (configuration.projectId !== decisionParams.projectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Configuration projectId does not match the signed project.",
      );
    }
    if (
      configuration.schemaVersion !== decisionParams.schemaVersion ||
      configuration.subjectId !== decisionParams.subjectId ||
      configuration.configurationRevision !== decisionParams.configurationRevision ||
      configuration.basis.snapshotId !== decisionParams.basisSnapshotId ||
      configuration.basis.revision !== decisionParams.basisRevision ||
      configuration.basis.subjectId !== decisionParams.subjectId ||
      deterministicJson(configuration.geometry) !==
        deterministicJson(decisionParams.geometry)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Reopened Buy configuration scope or geometry does not match the signed parameters.",
      );
    }
    return configuration;
  }

  async #requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.deps.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #completedFor(
    command: { readonly projectId: string; readonly runId: string },
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = project.agentRuns.find((item) => item.id === command.runId);
    if (run?.status === "completed") {
      assertBuyCompleted(project, command);
      return project;
    }
    return undefined;
  }
}

function requireMatchingConfigurationBasis(
  basis: EngineeringThreadSnapshotBasis,
  configuration: BuyConfiguration,
): void {
  const recross = recrossBuyConfigurationThreadBasis(configuration, basis);
  if (recross.status !== "current") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      recross.reason,
    );
  }
}

function requireCurrentGeometry(
  snapshot: ThreadSnapshot,
  configuration: BuyConfiguration,
): void {
  const applicability = buyGeometryApplicability(snapshot, configuration);
  if (applicability.status === "refused") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      applicability.reason,
    );
  }
  if (applicability.status === "historical") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      applicability.reason,
    );
  }
}

function buildCandidateSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: BuyCandidateCapture;
  readonly captureFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const capturedAt = requiredStart(input.run);
  const artifactId = `buy-cost-candidate-${input.captureFingerprint.digest}`;
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Buy cost candidate ${input.capture.bundleDigest.slice(0, 12)}`,
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: BUY_CAPTURE_CONFIGURATION_COST_TOOL,
      runId: input.run.id,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    },
  };
  const extension: ThreadSnapshotExtension = {
    id: `buy-capture-configuration-cost-${input.run.id}`,
    name: "Capture the reviewed Buy configuration and dated costs",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This exact Buy cost candidate is already present in the basis snapshot.",
    );
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, artifact };
}
