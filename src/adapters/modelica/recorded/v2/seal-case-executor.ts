/**
 * Qualification seal for `simulate.seal-simulation-case@2`.
 *
 * This operation is planless by design: it freezes the approved simulation
 * case, the qualified Modelica method, and every exact source byte that a
 * later resolved-operation-plan/2.0 may consume. Provider interactions are
 * read-only and occur only before claim. A run-scoped local journal then makes
 * every post-claim retry fully offline and deterministic.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  canonicalSimulationCaseV2Text,
  type SimulationCaseV2,
  validateSimulationCaseV2,
} from "../../../../domain/modelica/recorded/simulation-case-v2.ts";
import { buildSimulationCaseAnalysisGraph } from "../../../../domain/modelica/recorded/simulation-case-analysis-graph.ts";
import {
  parseSimulationCaseV2DecisionParameters,
  simulationCaseV2DecisionParametersToMap,
  verifySimulationCaseV2ParametersMatchCase,
} from "../../../../domain/modelica/recorded/simulation-case-v2-proposal.ts";
import {
  assertCataloguedSimulationCaseV2,
  cataloguedSimulationCaseV2SourcePath,
  type SimulationCaseV2Catalog,
} from "../../../../domain/modelica/recorded/simulation-case-v2-catalog.ts";
import {
  canonicalModelicaQualifiedManifestDocumentText,
  type ModelicaQualifiedManifestDocument,
  type ModelicaResumableManifestReader,
  validateModelicaQualifiedManifestDocument,
} from "../../../../domain/modelica/recorded/resumable-capabilities.ts";
import {
  fingerprintResourceBytes,
} from "../../../../domain/compile/source/provider-resource-reader.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../../shared/cas/file-byte-store.ts";
import {
  canonicalModelicaSimulationCaseQualificationCaptureText,
  decodeExactUtf8,
  SIMULATION_CASE_QUALIFICATION_CAPTURE_SCHEMA,
  validateModelicaSimulationCaseQualificationCapture,
} from "./simulation-case-qualification-capture.ts";
import { ModelicaQualifiedSourceCaptureService } from "./qualified-source-capture.ts";
import {
  FileModelicaQualifiedSealAttemptStore,
  type ModelicaQualifiedSealAttempt,
  type ModelicaQualifiedSealCasReference,
  type ModelicaQualifiedSealCollection,
  type ModelicaQualifiedSealPrepared,
} from "./qualified-seal-attempt-store.ts";
import { threadSnapshotDescendsFrom } from "../../../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../../shared/thread-write-basis-guard.ts";
import type { EngineeringProjectRunLease } from "../../../shared/stores/file-engineering-project-run-lease.ts";
import { SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION } from "../../../../domain/modelica/recorded/simulation-case-v2-proposal.ts";

export { SIMULATION_CASE_QUALIFICATION_CAPTURE_SCHEMA } from "./simulation-case-qualification-capture.ts";

export interface SimulateSealSimulationCaseV2RunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface SimulateSealSimulationCaseV2RunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly attempts: FileModelicaQualifiedSealAttemptStore;
  readonly manifestReader: ModelicaResumableManifestReader;
  readonly providerResources: ModelicaQualifiedSourceCaptureService;
  readonly simulationCases: FileByteStore<"simulation-case-v2">;
  readonly providerManifests: FileByteStore<"modelica-qualified-provider-manifest">;
  readonly qualificationCaptures: FileByteStore<"simulation-case-qualification">;
  /** Test-only alternate sealed catalogue; production uses the code-owned default. */
  readonly simulationCaseCatalog?: SimulationCaseV2Catalog;
  readonly readTextFile?: (path: string) => Promise<string>;
}

export class SimulateSealSimulationCaseV2RunExecutor {
  readonly #read: (path: string) => Promise<string>;

  constructor(private readonly d: SimulateSealSimulationCaseV2RunExecutorDependencies) {
    this.#read = d.readTextFile ?? Deno.readTextFile.bind(Deno);
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateSealSimulationCaseV2RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw error(
        "permission_denied",
        "Only an authenticated agent can execute the qualified simulation-case seal.",
      );
    }
    const project = await requiredProject(this.d.projects, command.projectId);
    const run = requireRun(project, command.runId);
    requireV2Shape(project, run);

    const known = await this.d.attempts.read(command.projectId, command.runId);
    if (run.status === "completed") {
      const complete = completed(project, command);
      if (known && known.status !== "collected" && known.status !== "prepared") {
        await this.d.attempts.markAttached({
          projectId: command.projectId,
          runId: command.runId,
          snapshot: known.snapshot,
        });
      }
      return complete;
    }

    // An existing journal is an authority boundary: never consult the mutable
    // provider on a post-claim recovery path, even if it is now offline.
    if (known) return await this.#resume(origin, command, known);

    const approval = await exactHumanApproval(project, run);
    const simulationCase = await loadCase(
      this.#read,
      approval.decision,
      this.d.simulationCaseCatalog,
    );
    verifySimulationCaseV2ParametersMatchCase(
      parseSimulationCaseV2DecisionParameters(
        simulationCaseV2DecisionParametersToMap(approval.decision.proposal!.parameters),
      ),
      simulationCase.case,
    );
    const basis = requireBasis(run);
    assertCaseProject(simulationCase.case, command.projectId, basis);

    // These are read-only provider interactions. Collection is persisted before
    // claim, so any subsequent retry has no route back to manifest_get or
    // resources/read.
    const manifest = await this.d.manifestReader.getManifest({
      modelId: simulationCase.case.kit.modelId,
      modelVersion: simulationCase.case.kit.modelVersion,
      scenarioId: simulationCase.case.scenario.id,
    });
    const canonicalManifest = await validateModelicaQualifiedManifestDocument(manifest);
    assertQualifiedModelicaManifestMatchesSimulationCase(
      canonicalManifest,
      simulationCase.case,
    );
    const collected = await this.#collect(simulationCase, canonicalManifest);
    const attempt = await this.d.attempts.recordCollected({
      projectId: command.projectId,
      runId: command.runId,
      collection: collected,
    });
    return await this.#resume(origin, command, attempt);
  }

  async #collect(
    simulationCase: LoadedCase,
    manifest: ModelicaQualifiedManifestDocument,
  ): Promise<ModelicaQualifiedSealCollection> {
    const caseBytes = new TextEncoder().encode(simulationCase.text);
    const caseDigest = await fingerprintResourceBytes(caseBytes);
    if (caseDigest !== simulationCase.digest) {
      throw new Error(
        "Canonical simulation case bytes do not match their exact digest.",
      );
    }
    const caseReceipt = await saveExact(this.d.simulationCases, caseBytes, caseDigest);
    const manifestText = await canonicalModelicaQualifiedManifestDocumentText(manifest);
    const manifestBytes = new TextEncoder().encode(manifestText);
    const manifestReceipt = await saveExact(
      this.d.providerManifests,
      manifestBytes,
      await fingerprintResourceBytes(manifestBytes),
    );
    const captured = await this.d.providerResources.capture({
      selection: manifest.selection,
      manifestFingerprint: manifest.fingerprint,
      resources: providerResources(manifest),
    });
    // The capture service itself did the first full exact reread. Retain its
    // canonical document in the collection so offline recovery can repeat it.
    if (
      captured.document.manifestFingerprint !== manifest.fingerprint ||
      deterministicJson(captured.document.selection) !==
        deterministicJson(manifest.selection)
    ) {
      throw new Error(
        "Qualified source capture is not bound to the exact Modelica manifest selection.",
      );
    }
    return {
      caseDigest,
      simulationCase: casRef(caseReceipt),
      manifest: casRef(manifestReceipt),
      sourceCapture: casRef(captured.capture),
      sources: captured.artifacts.map((entry) => ({
        role: entry.role,
        mediaType: entry.resource.mediaType,
        resourceUri: entry.resource.uri,
        cas: casRef(entry.stored),
      })),
    };
  }

  async #resume(
    origin: EngineeringProjectCommandOrigin,
    command: SimulateSealSimulationCaseV2RunExecutorCommand,
    initial: ModelicaQualifiedSealAttempt,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await requiredProject(this.d.projects, command.projectId);
    const run = requireRun(project, command.runId);
    return await this.d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      async () => {
        let currentProject = await requiredProject(this.d.projects, command.projectId);
        let currentRun = requireRun(currentProject, command.runId);
        requireV2Shape(currentProject, currentRun);
        if (currentRun.status === "completed") {
          return completed(currentProject, command);
        }
        await assertThreadWriteBasisAvailable(currentProject, currentRun);

        let attempt = await this.d.attempts.read(command.projectId, command.runId) ??
          initial;
        if (attempt.status === "collected" && currentRun.status === "queued") {
          await this.d.commands.claimRun(origin, {
            ...command,
            commandId: step(command.commandId, "claim"),
            summary: "Started qualified simulation-case seal.",
          });
          currentProject = await requiredProject(this.d.projects, command.projectId);
          currentRun = requireRun(currentProject, command.runId);
        }
        if (currentRun.status !== "running" && currentRun.status !== "publishing") {
          throw unexpectedStatus(currentRun, "running");
        }
        assertOwnedBy(currentRun, origin);

        if (attempt.status === "collected") {
          const approval = await exactHumanApproval(currentProject, currentRun);
          const hydrated = await this.#rehydrateCollection(attempt.collection);
          const basis = requireBasis(currentRun);
          await assertCaseReviewLineage(
            hydrated.simulationCase,
            basis,
            this.d.snapshots,
          );
          const capturedAt = requiredStart(currentRun);
          const authorityText = canonicalModelicaSimulationCaseQualificationCaptureText(
            {
              schemaVersion: SIMULATION_CASE_QUALIFICATION_CAPTURE_SCHEMA,
              operation: SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
              trustedRunId: currentRun.id,
              sealBasis: basisRef(basis),
              mrtr: {
                decisionId: approval.decision.id,
                inputFingerprint: approval.decision.inputFingerprint!.digest,
                approvalId: approval.approval.id,
                approvalFingerprint:
                  (await sha256Fingerprint(approval.approval)).digest,
                workItemId: currentRun.workItemId,
              },
              caseDigest: attempt.collection.caseDigest,
              simulationCase: attempt.collection.simulationCase,
              manifest: attempt.collection.manifest,
              sourceCapture: attempt.collection.sourceCapture,
              sources: attempt.collection.sources,
              sealedAt: capturedAt,
            },
          );
          const authorityBytes = new TextEncoder().encode(authorityText);
          const authority = await saveExact(
            this.d.qualificationCaptures,
            authorityBytes,
            await fingerprintResourceBytes(authorityBytes),
          );
          attempt = await this.d.attempts.prepare({
            projectId: command.projectId,
            runId: command.runId,
            prepared: {
              ...attempt.collection,
              capturedAt,
              sealBasis: basisRef(basis),
              mrtr: {
                decisionId: approval.decision.id,
                inputFingerprint: approval.decision.inputFingerprint!.digest,
                approvalId: approval.approval.id,
                approvalFingerprint:
                  (await sha256Fingerprint(approval.approval)).digest,
                workItemId: currentRun.workItemId,
              },
              authority: casRef(authority),
            },
          });
        }

        if (attempt.status === "prepared") {
          const hydrated = await this.#rehydratePrepared(
            attempt.prepared,
            currentProject,
            currentRun,
          );
          const base = await exactBasis(this.d.snapshots, requireBasis(currentRun));
          const materialized = materializeSnapshot({
            base,
            run: currentRun,
            prepared: attempt.prepared,
            simulationCase: hydrated.simulationCase,
          });
          await this.d.snapshots.save(materialized.snapshot);
          await exactSnapshotReadback(this.d.snapshots, materialized.snapshot);
          attempt = await this.d.attempts.markSnapshotPersisted({
            projectId: command.projectId,
            runId: command.runId,
            snapshot: snapshotRef(materialized.snapshot),
          });
        }

        if (attempt.status === "snapshot-persisted" || attempt.status === "attached") {
          const materialized = await exactSnapshotFromAttempt(
            this.d.snapshots,
            attempt,
          );
          const artifacts = materialized.artifacts.filter((artifact) =>
            artifact.producer.runId === currentRun.id
          );
          currentProject = await requiredProject(this.d.projects, command.projectId);
          currentRun = requireRun(currentProject, command.runId);
          if (currentRun.status === "running") {
            await this.d.commands.publishRun(origin, {
              ...command,
              commandId: step(command.commandId, "publish"),
              expectedRevision: currentProject.revision,
              summary: "Publishing qualified simulation-case evidence.",
            });
          }
          currentProject = await requiredProject(this.d.projects, command.projectId);
          currentRun = requireRun(currentProject, command.runId);
          if (currentRun.status === "publishing") {
            await this.d.commands.completeRun(origin, {
              ...command,
              commandId: step(command.commandId, "complete"),
              expectedRevision: currentProject.revision,
              summary:
                "Published the qualified Modelica method and exact simulation case.",
              resultSnapshot: snapshotRef(materialized),
              evidenceRefs: artifacts.map((artifact) => ({
                snapshotId: materialized.id,
                snapshotRevision: materialized.revision,
                kind: "artifact" as ThreadEntityKind,
                id: artifact.id,
              })),
            });
          }
          const complete = completed(
            await requiredProject(this.d.projects, command.projectId),
            command,
          );
          await this.d.attempts.markAttached({
            projectId: command.projectId,
            runId: command.runId,
            snapshot: snapshotRef(materialized),
          });
          return complete;
        }
        throw new Error(
          "Modelica qualified seal journal reached an unsupported state.",
        );
      },
    );
  }

  async #rehydrateCollection(collection: ModelicaQualifiedSealCollection): Promise<{
    simulationCase: SimulationCaseV2;
    manifest: ModelicaQualifiedManifestDocument;
  }> {
    const caseText = await readExactText(
      this.d.simulationCases,
      collection.simulationCase,
    );
    const simulationCase = validateSimulationCaseV2(JSON.parse(caseText));
    if (
      canonicalSimulationCaseV2Text(simulationCase) !== caseText ||
      await fingerprintResourceBytes(new TextEncoder().encode(caseText)) !==
        collection.caseDigest
    ) {
      throw new Error(
        "Persisted simulation case is not its exact canonical reviewed declaration.",
      );
    }
    const manifestText = await readExactText(
      this.d.providerManifests,
      collection.manifest,
    );
    const manifest = await validateModelicaQualifiedManifestDocument(
      JSON.parse(manifestText),
    );
    if (
      await canonicalModelicaQualifiedManifestDocumentText(manifest) !== manifestText
    ) {
      throw new Error("Persisted Modelica manifest is not canonical.");
    }
    const capture = await this.d.providerResources.reopenCapture(
      collection.sourceCapture,
    );
    if (
      capture.manifestFingerprint !== manifest.fingerprint ||
      deterministicJson(capture.selection) !== deterministicJson(manifest.selection)
    ) {
      throw new Error(
        "Persisted Modelica source capture diverges from the qualified manifest.",
      );
    }
    if (
      deterministicJson(collection.sources.map((source) => ({
        role: source.role,
        resourceUri: source.resourceUri,
        mediaType: source.mediaType,
        cas: source.cas,
      }))) !== deterministicJson(capture.artifacts.map((entry) => ({
        role: entry.role,
        resourceUri: entry.resource.uri,
        mediaType: entry.resource.mediaType,
        cas: {
          uri: entry.cas.uri,
          byteCount: entry.cas.byteCount,
          sha256: entry.cas.sha256,
        },
      })))
    ) {
      throw new Error(
        "Persisted Modelica source records diverge from their source capture.",
      );
    }
    return { simulationCase, manifest };
  }

  async #rehydratePrepared(
    prepared: ModelicaQualifiedSealPrepared,
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<
    { simulationCase: SimulationCaseV2; manifest: ModelicaQualifiedManifestDocument }
  > {
    const hydrated = await this.#rehydrateCollection(prepared);
    const basis = requireBasis(run);
    if (
      deterministicJson(prepared.sealBasis) !== deterministicJson(basisRef(basis)) ||
      prepared.mrtr.workItemId !== run.workItemId
    ) {
      throw error(
        "invalid_transition",
        "Qualified Modelica seal journal is not bound to this exact run basis.",
      );
    }
    const approval = await exactHumanApproval(project, run);
    const approvalFingerprint = (await sha256Fingerprint(approval.approval)).digest;
    if (
      approval.decision.id !== prepared.mrtr.decisionId ||
      approval.decision.inputFingerprint?.digest !== prepared.mrtr.inputFingerprint ||
      approval.approval.id !== prepared.mrtr.approvalId ||
      approvalFingerprint !== prepared.mrtr.approvalFingerprint
    ) {
      throw error(
        "invalid_transition",
        "Qualified Modelica seal journal MRTR binding no longer matches this run.",
      );
    }
    const authorityText = await readExactText(
      this.d.qualificationCaptures,
      prepared.authority,
    );
    let authority: ReturnType<
      typeof validateModelicaSimulationCaseQualificationCapture
    >;
    try {
      authority = validateModelicaSimulationCaseQualificationCapture(
        JSON.parse(authorityText),
      );
    } catch (cause) {
      throw error(
        "invalid_transition",
        `Qualified Modelica authority capture is invalid: ${String(cause)}`,
      );
    }
    if (
      canonicalModelicaSimulationCaseQualificationCaptureText(authority) !==
        authorityText ||
      authority.trustedRunId !== run.id ||
      deterministicJson(authority.sealBasis) !==
        deterministicJson(prepared.sealBasis) ||
      deterministicJson(authority.mrtr) !== deterministicJson({
          decisionId: prepared.mrtr.decisionId,
          inputFingerprint: prepared.mrtr.inputFingerprint,
          approvalId: prepared.mrtr.approvalId,
          approvalFingerprint: prepared.mrtr.approvalFingerprint,
          workItemId: prepared.mrtr.workItemId,
        }) ||
      authority.caseDigest !== prepared.caseDigest ||
      deterministicJson(authority.simulationCase) !==
        deterministicJson(prepared.simulationCase) ||
      deterministicJson(authority.manifest) !== deterministicJson(prepared.manifest) ||
      deterministicJson(authority.sourceCapture) !==
        deterministicJson(prepared.sourceCapture) ||
      deterministicJson(authority.sources) !== deterministicJson(prepared.sources) ||
      authority.sealedAt !== prepared.capturedAt
    ) {
      throw error(
        "invalid_transition",
        "Qualified Modelica authority capture does not bind this exact run and MRTR.",
      );
    }
    await assertCaseReviewLineage(hydrated.simulationCase, basis, this.d.snapshots);
    return hydrated;
  }
}

export function assertQualifiedModelicaManifestMatchesSimulationCase(
  manifest: ModelicaQualifiedManifestDocument,
  simulationCase: SimulationCaseV2,
): void {
  if (
    manifest.selection.modelId !== simulationCase.kit.modelId ||
    manifest.selection.modelVersion !== simulationCase.kit.modelVersion ||
    manifest.selection.scenarioId !== simulationCase.scenario.id ||
    manifest.model.sha256 !== simulationCase.kit.modelSha256 ||
    manifest.scenario.sha256 !== simulationCase.scenario.sourceSha256 ||
    manifest.scenarioProjectionSha256 !== simulationCase.scenario.projectionSha256
  ) {
    throw error(
      "invalid_input",
      "Qualified Modelica manifest model or scenario identity does not match the approved case.",
    );
  }
  const parameters = new Map(
    manifest.parameters.map((parameter) => [parameter.id, parameter]),
  );
  if (
    parameters.size !== simulationCase.parameters.length ||
    simulationCase.parameters.some((parameter) => {
      const qualified = parameters.get(parameter.id);
      return !qualified || qualified.unit !== parameter.unit ||
        parameter.value < qualified.minimum ||
        parameter.value > qualified.maximum;
    })
  ) {
    throw error(
      "invalid_input",
      "Approved parameters do not exactly fit the qualified Modelica manifest.",
    );
  }
  const metrics = new Map(
    manifest.producedMetrics.map((metric) => [metric.id, metric]),
  );
  if (
    metrics.size !== simulationCase.expectedMetrics.length ||
    simulationCase.expectedMetrics.some((metric) =>
      metrics.get(metric.id)?.unit !== metric.unit
    )
  ) {
    throw error(
      "invalid_input",
      "Approved expected metrics do not exactly match the qualified Modelica manifest.",
    );
  }
  if (
    !manifest.lowering.id || !manifest.lowering.version ||
    !manifest.resultNormalizer.id ||
    !manifest.resultNormalizer.version
  ) {
    throw error(
      "invalid_input",
      "Qualified Modelica manifest has no explicit lowering or result normalizer identity.",
    );
  }
}

interface LoadedCase {
  readonly case: SimulationCaseV2;
  readonly text: string;
  readonly digest: string;
}

async function loadCase(
  read: (path: string) => Promise<string>,
  decision: EngineeringDecision,
  catalog?: SimulationCaseV2Catalog,
): Promise<LoadedCase> {
  if (!decision.proposal || !decision.inputFingerprint) {
    throw error("invalid_transition", "Approved Modelica MRTR has no exact proposal.");
  }
  const parsed = parseSimulationCaseV2DecisionParameters(
    simulationCaseV2DecisionParametersToMap(decision.proposal.parameters),
  );
  const path = cataloguedSimulationCaseV2SourcePath(parsed, catalog);
  if (!path) {
    throw error(
      "invalid_input",
      `Simulation case ${parsed.id} is not in the server-side catalog.`,
    );
  }
  let source: unknown;
  try {
    source = JSON.parse(await read(path));
  } catch (cause) {
    throw error(
      "invalid_input",
      `Simulation case is not readable valid JSON: ${String(cause)}`,
    );
  }
  const simulationCase = validateSimulationCaseV2(source);
  const text = canonicalSimulationCaseV2Text(simulationCase);
  const digest = await fingerprintResourceBytes(new TextEncoder().encode(text));
  assertCataloguedSimulationCaseV2(simulationCase, digest, catalog);
  if (digest !== parsed.caseDigest) {
    throw error(
      "invalid_input",
      "The MRTR case digest does not match the canonical simulation case.",
    );
  }
  return { case: simulationCase, text, digest };
}

function providerResources(manifest: ModelicaQualifiedManifestDocument) {
  return [
    { role: "model" as const, ...manifest.model },
    { role: "scenario" as const, ...manifest.scenario },
    ...(manifest.parameterSchema === undefined
      ? []
      : [{ role: "parameter_schema" as const, ...manifest.parameterSchema }]),
  ];
}

function materializeSnapshot(input: {
  readonly base: ThreadSnapshot;
  readonly run: EngineeringAgentRun;
  readonly prepared: ModelicaQualifiedSealPrepared;
  readonly simulationCase: SimulationCaseV2;
}): { readonly snapshot: ThreadSnapshot } {
  const artifacts = artifactsFor(input.run, input.prepared, input.simulationCase);
  const lineage = provenanceFor(artifacts, input.run, input.prepared.capturedAt);
  const caseArtifact = artifacts.find((artifact) =>
    artifact.id.startsWith("simulation-case-v2-")
  );
  if (!caseArtifact) throw new Error("Qualified simulation case artifact is missing.");
  const extension: ThreadSnapshotExtension = {
    id: `simulate-seal-v2-${input.run.id}`,
    name:
      `Qualified simulation case: ${input.simulationCase.id} r${input.simulationCase.revision}`,
    subjectId: input.base.subject.id,
    capturedAt: input.prepared.capturedAt,
    artifacts,
    consumptions: lineage.consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: lineage.provenance,
    proposedActions: [],
    analysisGraph: buildSimulationCaseAnalysisGraph({
      simulationCase: input.simulationCase,
      caseFingerprint: { algorithm: "sha256", digest: input.prepared.caseDigest },
      evidence: { id: caseArtifact.id, fingerprint: caseArtifact.fingerprint },
    }),
  };
  const applied = applyThreadSnapshotExtensionIfNew(input.base, extension, {
    appliedAt: input.prepared.capturedAt,
  });
  return { snapshot: validateThreadSnapshot(applied.snapshot) };
}

function artifactsFor(
  run: EngineeringAgentRun,
  prepared: ModelicaQualifiedSealPrepared,
  simulationCase: SimulationCaseV2,
): ThreadArtifact[] {
  const producer = {
    serverId: "digital-thread",
    tool:
      `${SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.id}@${SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.version}`,
    runId: run.id,
  };
  const fresh = {
    status: "fresh" as const,
    changedAt: prepared.capturedAt,
    invalidatedByChangeIds: [],
  };
  const sources: ThreadArtifact[] = prepared.sources.map((source) => ({
    id: `modelica-source-${source.role}-${source.cas.sha256}`,
    name: `Qualified Modelica ${source.role}`,
    kind: source.role === "model" ? "simulation-model" : "document",
    version: source.cas.sha256.slice(0, 12),
    fingerprint: { algorithm: "sha256", digest: source.cas.sha256 },
    uri: source.cas.uri,
    mediaType: source.mediaType,
    producer,
    inputArtifactIds: [],
    freshness: fresh,
  }));
  const sourceIds = sources.map((source) => source.id);
  const caseId = `simulation-case-v2-${prepared.simulationCase.sha256}`;
  const manifestId = `modelica-provider-manifest-${prepared.manifest.sha256}`;
  const captureId =
    `modelica-qualified-source-capture-${prepared.sourceCapture.sha256}`;
  return [
    {
      id: caseId,
      name: `Qualified simulation case: ${simulationCase.id}`,
      kind: "document",
      version: prepared.caseDigest,
      fingerprint: { algorithm: "sha256", digest: prepared.simulationCase.sha256 },
      uri: prepared.simulationCase.uri,
      mediaType: "application/json",
      producer,
      inputArtifactIds: [],
      freshness: fresh,
    },
    ...sources,
    {
      id: manifestId,
      name: "Qualified Modelica provider manifest",
      kind: "document",
      version: prepared.manifest.sha256.slice(0, 12),
      fingerprint: { algorithm: "sha256", digest: prepared.manifest.sha256 },
      uri: prepared.manifest.uri,
      mediaType: "application/json",
      producer,
      inputArtifactIds: sourceIds,
      freshness: fresh,
    },
    {
      id: captureId,
      name: "Modelica qualified source capture",
      kind: "evidence",
      version: prepared.sourceCapture.sha256.slice(0, 12),
      fingerprint: { algorithm: "sha256", digest: prepared.sourceCapture.sha256 },
      uri: prepared.sourceCapture.uri,
      mediaType: "application/json",
      producer,
      inputArtifactIds: sourceIds,
      freshness: fresh,
    },
    {
      id: `simulation-case-qualification-${prepared.authority.sha256}`,
      name: "Modelica simulation-case qualification authority",
      kind: "evidence",
      version: prepared.authority.sha256.slice(0, 12),
      fingerprint: { algorithm: "sha256", digest: prepared.authority.sha256 },
      uri: prepared.authority.uri,
      mediaType: "application/json",
      producer,
      inputArtifactIds: [caseId, manifestId, captureId, ...sourceIds],
      freshness: fresh,
    },
  ];
}

function provenanceFor(
  artifacts: readonly ThreadArtifact[],
  run: EngineeringAgentRun,
  verifiedAt: string,
): {
  readonly consumptions: ThreadArtifactConsumption[];
  readonly provenance: ThreadProvenanceLink[];
} {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const consumer = {
    serverId: "digital-thread",
    tool:
      `${SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.id}@${SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.version}`,
    runId: run.id,
  };
  const consumptions: ThreadArtifactConsumption[] = [];
  const provenance: ThreadProvenanceLink[] = [];
  for (const artifact of artifacts) {
    for (const inputId of artifact.inputArtifactIds) {
      const input = byId.get(inputId);
      if (!input) {
        throw new Error(
          `Qualified seal artifact ${artifact.id} has an absent input ${inputId}.`,
        );
      }
      const consumptionId = `consume-${input.id}-by-${artifact.id}`;
      consumptions.push({
        id: consumptionId,
        artifactId: input.id,
        consumer,
        observedFingerprint: input.fingerprint,
        verifiedAt,
        status: "verified",
      });
      provenance.push({
        id: `derived-from-${artifact.id}-${input.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifact.id },
        to: { kind: "artifact", id: input.id },
        rationale:
          "The qualified seal derives this exact persisted evidence from the named content-addressed input.",
      }, {
        id: `uses-${consumptionId}`,
        relation: "uses",
        from: { kind: "consumption", id: consumptionId },
        to: { kind: "artifact", id: input.id },
        rationale:
          "The qualified seal re-read and verified the exact content-addressed input before publishing evidence.",
      });
    }
  }
  return { consumptions, provenance };
}

async function exactSnapshotFromAttempt(
  snapshots: ThreadSnapshotStore,
  attempt: Extract<
    ModelicaQualifiedSealAttempt,
    { status: "snapshot-persisted" | "attached" }
  >,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(attempt.snapshot.snapshotId);
  if (
    !snapshot || snapshot.id !== attempt.snapshot.snapshotId ||
    snapshot.revision !== attempt.snapshot.revision ||
    snapshot.subject.id !== attempt.snapshot.subjectId
  ) {
    throw error(
      "invalid_transition",
      "Qualified Modelica seal snapshot is not durably available for attachment.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

async function assertCaseReviewLineage(
  simulationCase: SimulationCaseV2,
  basis: EngineeringThreadSnapshotBasis,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  const current = await exactBasis(snapshots, basis);
  const reviewed = await snapshots.get(simulationCase.project.baseThreadSnapshot.id);
  if (
    !reviewed ||
    reviewed.revision !== simulationCase.project.baseThreadSnapshot.revision ||
    reviewed.subject.id !== simulationCase.project.baseThreadSnapshot.subjectId ||
    !await threadSnapshotDescendsFrom(
      current,
      validateThreadSnapshot(reviewed),
      snapshots,
    )
  ) {
    throw error(
      "invalid_transition",
      "Simulation case review basis is not an ancestor of the sealed run basis.",
    );
  }
}

function assertCaseProject(
  simulationCase: SimulationCaseV2,
  projectId: string,
  basis: EngineeringThreadSnapshotBasis,
): void {
  if (
    simulationCase.project.id !== projectId ||
    simulationCase.project.subjectId !== basis.subjectId
  ) {
    throw error(
      "invalid_input",
      "The approved simulation case is not for this exact project subject.",
    );
  }
}

async function exactHumanApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<
  { readonly decision: EngineeringDecision; readonly approval: EngineeringApproval }
> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const basis = requireBasis(run);
  const candidates = (work?.decisionIds ?? []).flatMap((id) => {
    const decision = project.decisions.find((item) => item.id === id);
    if (
      !decision || decision.status !== "approved" || !decision.proposal ||
      !decision.inputFingerprint ||
      !sameBasis(decision.baseSnapshot, basis)
    ) return [];
    const approvals = project.approvals.filter((approval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" && approval.decidedByOrigin === "human" &&
      sameBasis(approval.baseSnapshot, basis) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    );
    return approvals.length === 1 ? [{ decision, approval: approvals[0]! }] : [];
  });
  if (candidates.length !== 1) {
    throw error(
      "invalid_transition",
      "Exactly one human-approved simulation-case MRTR is required for this run basis.",
    );
  }
  const candidate = candidates[0]!;
  const expected = await sha256Fingerprint({
    baseSnapshot: candidate.decision.baseSnapshot,
    inputEvidenceRefs: candidate.decision.inputEvidenceRefs,
    proposal: {
      summary: candidate.decision.proposal!.summary,
      parameters: candidate.decision.proposal!.parameters,
    },
  });
  if (!fingerprintsEqual(expected, candidate.decision.inputFingerprint)) {
    throw error(
      "invalid_input",
      "Simulation-case MRTR fingerprint no longer seals its exact proposal.",
    );
  }
  return candidate;
}

function requireV2Shape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const operation = project.workItems.find((item) => item.id === run.workItemId)
    ?.operation;
  if (
    project.schemaVersion !== "3.0" || run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.id ||
    operation.version !== SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw error(
      "invalid_transition",
      "Run is not bound to simulate.seal-simulation-case@2 with its sole approvedBrief binding.",
    );
  }
}

function assertOwnedBy(
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw error(
      "invalid_transition",
      "This executor may resume only the exact qualified seal run it claimed.",
    );
  }
}

async function requiredProject(
  store: EngineeringProjectRevisionStore,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const project = await store.get(projectId);
  if (!project) {
    throw error(
      "project_not_found",
      `Engineering project ${projectId} does not exist.`,
    );
  }
  return project;
}

async function exactBasis(
  store: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw error("invalid_transition", "Exact thread basis is unavailable.");
  }
  return validateThreadSnapshot(snapshot);
}

async function exactSnapshotReadback(
  store: ThreadSnapshotStore,
  snapshot: ThreadSnapshot,
): Promise<void> {
  const reread = await store.get(snapshot.id);
  if (!reread || deterministicJson(reread) !== deterministicJson(snapshot)) {
    throw new Error("Qualified simulation-case snapshot was not durably reread.");
  }
}

async function saveExact<K extends string>(
  store: FileByteStore<K>,
  bytes: Uint8Array,
  digest: string,
): Promise<VerifiedStoredBytes<K>> {
  const receipt = await store.save({ algorithm: "sha256", digest }, bytes);
  const reread = await store.read(receipt.fingerprint);
  if (
    !reread || reread.byteLength !== bytes.byteLength ||
    await fingerprintResourceBytes(reread.copy()) !== digest
  ) {
    throw new Error("Content-addressed qualification bytes were not durably reread.");
  }
  return receipt;
}

async function readExactText<K extends string>(
  store: FileByteStore<K>,
  reference: ModelicaQualifiedSealCasReference,
): Promise<string> {
  const fingerprint = { algorithm: "sha256" as const, digest: reference.sha256 };
  if (store.uriFor(fingerprint) !== reference.uri) {
    throw new Error("Qualification journal has a foreign content-addressed URI.");
  }
  const bytes = await store.read(fingerprint);
  if (
    !bytes || bytes.byteLength !== reference.byteCount ||
    await fingerprintResourceBytes(bytes.copy()) !== reference.sha256
  ) {
    throw new Error(
      "Qualification bytes are absent or divergent during offline recovery.",
    );
  }
  return decodeExactUtf8(bytes.copy(), "Qualification bytes");
}

function casRef(
  receipt: VerifiedStoredBytes<string>,
): ModelicaQualifiedSealCasReference {
  return {
    uri: receipt.uri,
    byteCount: receipt.byteCount,
    sha256: receipt.fingerprint.digest,
  };
}

function basisRef(basis: EngineeringThreadSnapshotBasis) {
  return {
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  };
}

function sameBasis(
  value:
    | EngineeringApproval["baseSnapshot"]
    | EngineeringDecision["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return !!value && "snapshotId" in value && value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision && value.subjectId === basis.subjectId;
}

function completed(
  project: EngineeringProjectSnapshot,
  command: SimulateSealSimulationCaseV2RunExecutorCommand,
): EngineeringProjectSnapshot {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === step(command.commandId, "complete")
    )
  ) {
    throw error(
      "invalid_transition",
      "Qualified simulation-case run did not complete through this exact command.",
    );
  }
  return project;
}

function step(commandId: string, action: string): string {
  return `${commandId}:simulate-seal-simulation-case-v2:${action}`;
}

function error(
  code: ConstructorParameters<typeof EngineeringProjectCommandError>[0],
  message: string,
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(code, message);
}
