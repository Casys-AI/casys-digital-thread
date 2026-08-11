/**
 * End-to-end fixture for the recorded Modelica `@2` vertical.
 *
 * It intentionally uses the real project command service, initial baseline,
 * qualified seal, recorded-plan resolver and capture-backed plan sealer. Test
 * cases may only vary the provider behaviour at the final provider boundary.
 */

import {
  type EngineeringProjectCommandOrigin,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanOperationRegistry,
} from "../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../domain/project/project-brief-command-service.ts";
import {
  canonicalSimulationCaseV2Text,
  type SimulationCaseV2,
  validateSimulationCaseV2,
} from "../domain/analysis/simulation-case-v2.ts";
import {
  encodeSimulationCaseV2DecisionParameters,
} from "../domain/analysis/simulation-case-v2-proposal.ts";
import {
  simulationCaseV2CatalogKey,
} from "../domain/analysis/simulation-case-v2-catalog.ts";
import {
  canonicalModelicaResumableProviderJson,
  fingerprintModelicaResumableProviderJson,
  type ModelicaQualifiedManifestDocument,
  type ModelicaResumableCapturedEvidence,
  type ModelicaResumableCapturedResourceTuple,
  type ModelicaResumableCompletedRun,
  type ModelicaResumableRequest,
  type ModelicaResumableSubmission,
} from "../domain/analysis/modelica-resumable-capabilities.ts";
import {
  createProviderResourceRead,
  type ExpectedProviderResource,
  fingerprintResourceBytes,
  type ProviderResourceReader,
} from "../domain/analysis/provider-resource-reader.ts";
import { deterministicJson } from "../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../domain/thread/thread-snapshot.ts";
import { approvedBriefSourceAnalysisFixture } from "./approved-brief-source-analysis-fixture.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../adapters/captures/file-capture-store.ts";
import { FileByteStore } from "../adapters/captures/file-byte-store.ts";
import { ProviderResourceCaptureService } from "../adapters/captures/provider-resource-capture-service.ts";
import { ModelicaQualifiedSourceCaptureService } from "../adapters/captures/modelica-qualified-source-capture.ts";
import { FileEngineeringProjectRevisionStore } from "../adapters/stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../adapters/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../adapters/stores/file-thread-snapshot-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../adapters/validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ExactThreadCompletionEvidenceValidator } from "../adapters/validators/engineering-project-completion-evidence-validator.ts";
import { FileModelicaQualifiedSealAttemptStore } from "../adapters/wal/file-modelica-qualified-seal-attempt-store.ts";
import { FileModelicaRecordedScenarioAttemptStore } from "../adapters/wal/file-modelica-recorded-scenario-attempt-store.ts";
import { CaptureBackedRunPlanSealer } from "../adapters/plans/capture-backed-run-plan-sealer.ts";
import { RecordedOperationPlanResolver } from "../adapters/plans/recorded-operation-plan-resolver.ts";
import {
  lowerSubmission,
  normalizeCapturedModelicaResumableEvidence,
  parseManifestEnvelope,
  parseRequestEnvelope,
  verifyCapturedModelicaResumableEvidence,
} from "../adapters/providers/modelica/mcp-modelica-resumable-adapter.ts";
import { ApprovedBriefBaselineRunExecutor } from "../adapters/executors/approved-brief-baseline-run-executor.ts";
import { SimulateSealSimulationCaseV2RunExecutor } from "../adapters/executors/simulate-seal-simulation-case-v2-run-executor.ts";
import {
  RECORDED_ANALYSIS_OPERATION_DESCRIPTORS,
  SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
} from "../orchestration/operations/recorded-analysis.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";

export const RECORDED_MODELICA_V2_AGENT: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent:recorded-modelica-v2",
};
export const RECORDED_MODELICA_V2_HUMAN: EngineeringProjectCommandOrigin = {
  kind: "human",
  actorId: "human:recorded-modelica-v2",
};

export interface RecordedModelicaV2Fixture {
  readonly directory: string;
  readonly projectId: string;
  readonly subjectId: string;
  readonly runId: string;
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly snapshots: FileThreadSnapshotStore;
  readonly commands: EngineeringProjectCommandService;
  readonly plans: CaptureBackedRunPlanSealer;
  readonly attempts: FileModelicaRecordedScenarioAttemptStore;
  readonly lease: FileEngineeringProjectRunLease;
  readonly sealedSnapshot: ThreadSnapshot;
  readonly simulationCase: SimulationCaseV2;
  readonly manifest: ModelicaQualifiedManifestDocument;
  readonly wireManifest: Record<string, unknown>;
  readonly sourceBytes: ReadonlyMap<string, Uint8Array>;
  readonly sources: {
    read(expected: ExpectedProviderResource): Promise<Uint8Array | undefined>;
  };
  readonly capturedResources: FileByteStore<"modelica-recorded-resource">;
  readonly captureLedgers: FileByteStore<"modelica-recorded-resource-ledger">;
  readonly captureManifests: FileByteStore<"modelica-recorded-resource-manifest">;
  readonly createCaptureService: (
    reader: ProviderResourceReader,
  ) => ProviderResourceCaptureService<
    "modelica-recorded-resource",
    "modelica-recorded-resource-ledger",
    "modelica-recorded-resource-manifest"
  >;
  command(expectedRevision: number): {
    commandId: string;
    projectId: string;
    expectedRevision: number;
    issuedAt: string;
    runId: string;
  };
}

/**
 * Builds a completed real seal and queues its successor through the actual
 * plan-sealing command path. No test constructs a queued run or plan itself.
 */
export async function createRecordedModelicaV2Fixture(
  directory: string,
): Promise<RecordedModelicaV2Fixture> {
  const projectId = "recorded-modelica-v2-project";
  const subjectId = `project:${projectId}`;
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-12T00:00:00.000Z") + ++tick * 1_000)
      .toISOString();
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const initialValidator = new ExactInitialBaselineEvidenceValidator(
    snapshots,
    baselineCaptures,
    approvedBriefSourceAnalysisFixture(directory),
  );
  const completionValidator = new ExactThreadCompletionEvidenceValidator(snapshots);
  const registry = recordedModelicaV2TestRegistry();
  const initialCommands = new EngineeringProjectCommandService(
    projects,
    completionValidator,
    now,
    { operations: registry },
    initialValidator,
  );

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(RECORDED_MODELICA_V2_AGENT, {
    commandId: "start",
    projectId,
    projectName: "Recorded Modelica v2 fixture",
    issuedAt: "2026-08-12T00:00:00.000Z",
    intent: "Exercise the complete recorded Modelica execution boundary.",
    intentSource: { kind: "human", reference: "conversation:fixture" },
  });
  project = await briefs.proposeBrief(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "brief-propose", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Capture a qualified Modelica observation.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Use the approved thermal kit.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Publish exact provider resources only.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(RECORDED_MODELICA_V2_HUMAN, {
    ...context(projectId, "brief-approve", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Fixture brief approved.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  project = await initialCommands.publishPlan(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "plan-baseline", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{ id: "baseline", name: "Baseline", description: "Record brief." }],
    workItems: [{
      id: "brief-baseline",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  project = await initialCommands.queueRun(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "queue-baseline", project.revision),
    runId: "run:baseline",
    workItemId: "brief-baseline",
    summary: "Record brief baseline.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands: initialCommands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-12T00:01:00.000Z",
  }).execute(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "run-baseline", project.revision),
    runId: "run:baseline",
  });
  const baseline = baselined.threadSnapshots[0]!;
  const modelText = "model ThermalKit\n  Real power;\nend ThermalKit;\n";
  const scenarioText = deterministicJson({
    id: "heat-up",
    qualification_note: "fixture native scenario",
  });
  const parameterSchemaText = deterministicJson({
    schemaVersion: "modelica-parameter-schema/1.0",
    type: "object",
    properties: {
      power: { type: "number", unit: "W", minimum: 0, maximum: 1_000 },
    },
    required: ["power"],
  });
  const qualified = await qualifiedManifest(
    modelText,
    scenarioText,
    parameterSchemaText,
  );
  const simulationCase = await fixtureCase({
    projectId,
    subjectId,
    basisSnapshotId: baseline.snapshotId,
    manifest: qualified.manifest,
  });
  const caseDigest = await fingerprintResourceBytes(
    new TextEncoder().encode(canonicalSimulationCaseV2Text(simulationCase)),
  );
  project = await initialCommands.appendChange(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "append-seal", baselined.revision),
    baseSnapshot: baseline,
    phases: [{
      id: "seal",
      name: "Qualified seal",
      description: "Freeze exact Modelica inputs.",
    }],
    workItems: [{
      id: "qualified-seal",
      phaseId: "seal",
      owner: "agent",
      dependsOnWorkItemIds: ["brief-baseline"],
      decisionIds: ["qualified-seal-decision"],
      operation: {
        id: SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.id,
        version: SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.version,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "qualified-seal-decision",
      phaseId: "seal",
      title: "Seal Modelica inputs",
      question: "Seal this exact Modelica case?",
    }],
  });
  project = await initialCommands.proposeDecision(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "propose-seal", project.revision),
    decisionId: "qualified-seal-decision",
    baseSnapshot: baseline,
    proposal: {
      summary: "Seal qualified Modelica input evidence.",
      parameters: encodeSimulationCaseV2DecisionParameters(caseDigest, simulationCase),
    },
  });
  const sealDecision = project.decisions.find((entry) =>
    entry.id === "qualified-seal-decision"
  )!;
  project = await initialCommands.approveDecision(RECORDED_MODELICA_V2_HUMAN, {
    ...context(projectId, "approve-seal", project.revision),
    decisionId: sealDecision.id,
    rationale: "Exact fixture case approved.",
    inputFingerprint: sealDecision.inputFingerprint!,
  });
  const sealRunId = "run:qualified-seal";
  project = await initialCommands.queueRun(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "queue-seal", project.revision),
    runId: sealRunId,
    workItemId: "qualified-seal",
    summary: "Seal qualified Modelica case.",
    basis: { kind: "thread-snapshot", ...baseline },
  });
  const sourceBytes = new Map<string, Uint8Array>([
    [qualified.manifest.model.uri, new TextEncoder().encode(modelText)],
    [qualified.manifest.scenario.uri, new TextEncoder().encode(scenarioText)],
    [
      qualified.manifest.parameterSchema!.uri,
      new TextEncoder().encode(parameterSchemaText),
    ],
  ]);
  const sealProviderReader: ProviderResourceReader = {
    async read(expected) {
      const bytes = sourceBytes.get(expected.uri);
      if (!bytes) throw new Error(`Unexpected qualified source ${expected.uri}.`);
      return await createProviderResourceRead(expected, bytes);
    },
  };
  const sourceStore = byteStore(
    "modelica-qualified-source",
    `${directory}/qualified-source-bytes`,
    "modelica-qualified-source",
  );
  const sourceCaptureStore = byteStore(
    "modelica-qualified-source-capture",
    `${directory}/qualified-source-captures`,
    "modelica-qualified-source-capture",
  );
  const seal = new SimulateSealSimulationCaseV2RunExecutor({
    projects,
    commands: initialCommands,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/seal-leases`),
    attempts: new FileModelicaQualifiedSealAttemptStore(`${directory}/seal-attempts`),
    manifestReader: { getManifest: () => Promise.resolve(qualified.manifest) },
    providerResources: new ModelicaQualifiedSourceCaptureService({
      reader: sealProviderReader,
      artifacts: sourceStore,
      captures: sourceCaptureStore,
    }),
    simulationCases: byteStore(
      "simulation-case-v2",
      `${directory}/simulation-cases`,
      "simulation-case-v2",
    ),
    providerManifests: byteStore(
      "modelica-qualified-provider-manifest",
      `${directory}/provider-manifests`,
      "modelica-qualified-provider-manifest",
    ),
    qualificationCaptures: byteStore(
      "simulation-case-qualification",
      `${directory}/qualification-captures`,
      "simulation-case-qualification",
    ),
    simulationCaseCatalog: new Map([[
      simulationCaseV2CatalogKey(simulationCase),
      { sourcePath: "fixture-case.json", canonicalDigest: caseDigest },
    ]]),
    readTextFile: () => Promise.resolve(canonicalSimulationCaseV2Text(simulationCase)),
  });
  const sealed = await seal.execute(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "run-seal", project.revision),
    runId: sealRunId,
  });
  const sealedSnapshotRef = sealed.threadSnapshots.at(-1)!;
  const sealedSnapshot = await snapshots.get(sealedSnapshotRef.snapshotId);
  if (!sealedSnapshot) throw new Error("Fixture seal did not persist its snapshot.");

  const simulationCases = byteStore(
    "simulation-case-v2",
    `${directory}/simulation-cases`,
    "simulation-case-v2",
  );
  const providerManifests = byteStore(
    "modelica-qualified-provider-manifest",
    `${directory}/provider-manifests`,
    "modelica-qualified-provider-manifest",
  );
  const qualificationCaptures = byteStore(
    "simulation-case-qualification",
    `${directory}/qualification-captures`,
    "simulation-case-qualification",
  );
  const artifactStores = new Map<string, FileByteStore<string>>([
    ["simulation-case-v2", simulationCases],
    ["modelica-qualified-provider-manifest", providerManifests],
    ["modelica-qualified-source", sourceStore],
    ["modelica-qualified-source-capture", sourceCaptureStore],
    ["simulation-case-qualification", qualificationCaptures],
  ]);
  const sources = {
    async read(expected: ExpectedProviderResource): Promise<Uint8Array | undefined> {
      const namespace = expected.uri.match(/^casys:\/\/([^/]+)\/sha256\//)?.[1];
      const store = namespace ? artifactStores.get(namespace) : undefined;
      if (!store) return undefined;
      const fingerprint = { algorithm: "sha256" as const, digest: expected.sha256 };
      if (store.uriFor(fingerprint) !== expected.uri) return undefined;
      const bytes = await store.read(fingerprint);
      return bytes?.copy();
    },
  };
  const resolver = new RecordedOperationPlanResolver({
    snapshots,
    artifacts: {
      read: (artifact) =>
        artifact.uri && artifact.mediaType
          ? sources.read({
            uri: artifact.uri,
            mediaType: artifact.mediaType,
            byteCount: 0,
            sha256: artifact.fingerprint.digest,
          })
          : Promise.resolve(undefined),
    },
    stepAssets: {
      read: () => Promise.reject(new Error("Modelica fixture has no STEP.")),
    },
  });
  const plans = new CaptureBackedRunPlanSealer({
    store: byteStore(
      "resolved-operation-plan",
      `${directory}/resolved-operation-plans`,
      "resolved-operation-plan",
    ),
    resolver,
  });
  const commands = new EngineeringProjectCommandService(
    projects,
    completionValidator,
    now,
    { operations: registry, runPlanSealer: plans },
    initialValidator,
  );
  const caseArtifact = exactArtifact(sealedSnapshot, "simulation-case-v2-");
  const manifestArtifact = exactArtifact(sealedSnapshot, "modelica-provider-manifest-");
  project = await commands.appendChange(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "append-recorded-run", sealed.revision),
    baseSnapshot: sealedSnapshotRef,
    phases: [{
      id: "recorded-run",
      name: "Recorded Modelica run",
      description: "Run only the exact sealed Modelica plan.",
    }],
    workItems: [{
      id: "recorded-modelica-run",
      phaseId: "recorded-run",
      owner: "agent",
      dependsOnWorkItemIds: ["qualified-seal"],
      decisionIds: ["recorded-modelica-decision"],
      operation: {
        id: SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION.id,
        version: SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION.version,
        bindings: [{
          name: "simulationCase",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: sealedSnapshot.id,
              snapshotRevision: sealedSnapshot.revision,
              kind: "artifact",
              id: caseArtifact.id,
            },
          },
        }, {
          name: "methodManifest",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: sealedSnapshot.id,
              snapshotRevision: sealedSnapshot.revision,
              kind: "artifact",
              id: manifestArtifact.id,
            },
          },
        }],
      },
    }],
    requiredDecisions: [{
      id: "recorded-modelica-decision",
      phaseId: "recorded-run",
      title: "Run recorded Modelica plan",
      question: "Run this exact sealed Modelica plan?",
    }],
  });
  project = await commands.proposeDecision(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "propose-recorded-run", project.revision),
    decisionId: "recorded-modelica-decision",
    baseSnapshot: sealedSnapshotRef,
    proposal: {
      summary: "Run the exact recorded Modelica plan.",
      parameters: [{
        key: "executionScope",
        label: "Execution scope",
        value: "exact sealed Modelica plan",
      }],
    },
  });
  const runDecision = project.decisions.find((entry) =>
    entry.id === "recorded-modelica-decision"
  )!;
  project = await commands.approveDecision(RECORDED_MODELICA_V2_HUMAN, {
    ...context(projectId, "approve-recorded-run", project.revision),
    decisionId: runDecision.id,
    rationale: "Exact recorded plan approved.",
    inputFingerprint: runDecision.inputFingerprint!,
  });
  const runId = "run:recorded-modelica";
  await commands.queueRun(RECORDED_MODELICA_V2_AGENT, {
    ...context(projectId, "queue-recorded-run", project.revision),
    runId,
    workItemId: "recorded-modelica-run",
    summary: "Run exact recorded Modelica plan.",
    basis: { kind: "thread-snapshot", ...sealedSnapshotRef },
  });
  const capturedResources = byteStore(
    "modelica-recorded-resource",
    `${directory}/recorded-provider-resources`,
    "modelica-recorded-resource",
  );
  const captureLedgers = byteStore(
    "modelica-recorded-resource-ledger",
    `${directory}/recorded-provider-ledgers`,
    "modelica-recorded-resource-ledger",
  );
  const captureManifests = byteStore(
    "modelica-recorded-resource-manifest",
    `${directory}/recorded-provider-manifests`,
    "modelica-recorded-resource-manifest",
  );
  return {
    directory,
    projectId,
    subjectId,
    runId,
    projects,
    snapshots,
    commands,
    plans,
    attempts: new FileModelicaRecordedScenarioAttemptStore(`${directory}/run-attempts`),
    lease: new FileEngineeringProjectRunLease(`${directory}/run-leases`),
    sealedSnapshot,
    simulationCase,
    manifest: qualified.manifest,
    wireManifest: qualified.wireManifest,
    sourceBytes,
    sources,
    capturedResources,
    captureLedgers,
    captureManifests,
    createCaptureService: (reader) =>
      new ProviderResourceCaptureService({
        reader,
        artifactStore: capturedResources,
        ledgerStore: captureLedgers,
        manifestStore: captureManifests,
      }),
    command: (expectedRevision) => ({
      commandId: "execute-recorded-modelica",
      projectId,
      expectedRevision,
      issuedAt: "2026-08-12T00:10:00.000Z",
      runId,
    }),
  };
}

/** A strict, instrumented provider using the real wire parser and verifier. */
export class InstrumentedRecordedModelicaProvider {
  submitCalls = 0;
  requestGetCalls = 0;
  verifyCalls = 0;
  resourceReads = 0;
  submitMode: "success" | "lost-ack" = "success";
  failNextRequestGet = false;
  readonly resourceReader: ProviderResourceReader;
  #request: ModelicaResumableRequest | undefined;
  #resources = new Map<string, Uint8Array>();

  constructor(private readonly fixture: RecordedModelicaV2Fixture) {
    this.resourceReader = {
      read: async (expected) => {
        this.resourceReads += 1;
        const bytes = this.#resources.get(expected.uri);
        if (!bytes) {
          throw new Error(`Provider resource ${expected.uri} was not selected.`);
        }
        return await createProviderResourceRead(expected, bytes);
      },
    };
  }

  async submit(
    submission: ModelicaResumableSubmission,
  ): Promise<ModelicaResumableRequest> {
    this.submitCalls += 1;
    const request = await this.#prepare(submission);
    if (this.submitMode === "lost-ack") {
      throw new Error("transport lost acknowledgement after provider acceptance");
    }
    return request;
  }

  async getRequest(
    submission: ModelicaResumableSubmission,
  ): Promise<ModelicaResumableRequest> {
    this.requestGetCalls += 1;
    if (this.failNextRequestGet) {
      this.failNextRequestGet = false;
      throw new Error("simulated provider readback interruption");
    }
    const request = await this.#prepare(submission);
    return request;
  }

  async verifyCapturedEvidence(
    submission: ModelicaResumableSubmission,
    completed: ModelicaResumableCompletedRun,
    resources: readonly { readonly role: string; readonly bytes: Uint8Array }[],
  ): Promise<ModelicaResumableCapturedEvidence> {
    this.verifyCalls += 1;
    return await verifyCapturedModelicaResumableEvidence(
      submission,
      completed,
      resources,
    );
  }

  async normalizeCapturedEvidence(
    submission: ModelicaResumableSubmission,
    resources: readonly ModelicaResumableCapturedResourceTuple[],
  ): Promise<ModelicaResumableCapturedEvidence> {
    return await normalizeCapturedModelicaResumableEvidence(
      submission,
      resources,
    );
  }

  async #prepare(
    submission: ModelicaResumableSubmission,
  ): Promise<ModelicaResumableRequest> {
    if (this.#request) {
      if (this.#request.requestId !== submission.requestId) {
        throw new Error("Provider request identity changed after acceptance.");
      }
      return this.#request;
    }
    const requestText = canonicalModelicaResumableProviderJson(
      lowerSubmission(submission),
    );
    const requestSha256 = await fingerprintResourceBytes(
      new TextEncoder().encode(requestText),
    );
    const runId = "run_12345678-1234-4234-8234-123456789abc";
    const resolvedParameters = structuredClone(submission.parameters);
    const metrics = { temperature: { value: 91, unit: "degC" } };
    const warnings: string[] = [];
    const script = omcScript(submission);
    const contents: Record<string, string> = {
      request: requestText,
      resolved_parameters: canonicalModelicaResumableProviderJson(
        resolvedParameters,
      ),
      model: decode(this.fixture.sourceBytes.get(submission.manifest.model.uri)!),
      scenario: decode(this.fixture.sourceBytes.get(submission.manifest.scenario.uri)!),
      parameter_schema: decode(
        this.fixture.sourceBytes.get(submission.manifest.parameterSchema!.uri)!,
      ),
      script,
      diagnostics: "OpenModelica fixture diagnostics\n",
      result: "time,temperature\n0,20\n10,91\n",
      evidence: canonicalModelicaResumableProviderJson({
        producer: "mcp-modelica",
        status: "succeeded",
        request_id: submission.requestId,
        manifest_sha256: submission.manifest.fingerprint,
        metrics,
        warnings,
        note:
          "This is computed evidence only. Requirement pass/fail belongs to mcp-syson and @casys/constraint-solver.",
      }),
    };
    const profile = [
      ["request", "request.json", "application/json"],
      ["resolved_parameters", "resolved-parameters.json", "application/json"],
      ["model", `${submission.manifest.modelName}.mo`, "text/x-modelica"],
      ["scenario", "scenario.json", "application/json"],
      ["parameter_schema", "parameter-schema.json", "application/json"],
      ["script", "run.mos", "text/plain"],
      ["diagnostics", "omc.log", "text/plain"],
      ["result", "result.csv", "text/csv"],
      ["evidence", "evidence.json", "application/json"],
    ] as const;
    const artifacts = await Promise.all(
      profile.map(async ([role, fileName, mediaType]) => {
        const bytes = new TextEncoder().encode(contents[role]);
        const base = {
          kind: role,
          file_name: fileName,
          ...(role === "request" ? {} : { run_id: runId }),
          uri: role === "request"
            ? `casys://modelica/requests/${submission.requestId}/request.json`
            : `casys://modelica/requests/${submission.requestId}/artifacts/${fileName}`,
          mediaType,
          sha256: await fingerprintResourceBytes(bytes),
          bytes: bytes.byteLength,
        };
        const source = role === "model"
          ? submission.manifest.model
          : role === "scenario"
          ? submission.manifest.scenario
          : role === "parameter_schema"
          ? submission.manifest.parameterSchema
          : undefined;
        return source
          ? {
            ...base,
            qualification: source.qualification,
            source_resource: {
              uri: source.uri,
              mediaType: source.mediaType,
              bytes: source.byteCount,
              sha256: source.sha256,
              qualification: source.qualification,
            },
          }
          : base;
      }),
    );
    const run = {
      schemaVersion: "2.1",
      kind: "simulation-run",
      request_id: submission.requestId,
      request_sha256: requestSha256,
      manifest: this.fixture.wireManifest,
      run_id: runId,
      status: "succeeded",
      started_at: "2026-08-12T00:30:00.000Z",
      completed_at: "2026-08-12T00:30:01.000Z",
      resolved_parameters: resolvedParameters,
      metrics,
      artifacts,
      warnings,
    };
    const runBytes = new TextEncoder().encode(
      canonicalModelicaResumableProviderJson(run),
    );
    const runJson = {
      uri: `casys://modelica/requests/${submission.requestId}/run.json`,
      mediaType: "application/json",
      sha256: await fingerprintResourceBytes(runBytes),
      bytes: runBytes.byteLength,
    };
    for (const [role, fileName] of profile) {
      const uri = role === "request"
        ? `casys://modelica/requests/${submission.requestId}/request.json`
        : `casys://modelica/requests/${submission.requestId}/artifacts/${fileName}`;
      this.#resources.set(uri, new TextEncoder().encode(contents[role]));
    }
    this.#resources.set(runJson.uri, runBytes);
    this.#request = await parseRequestEnvelope({
      schemaVersion: "2.1",
      kind: "simulation-request",
      request: {
        request_id: submission.requestId,
        request_sha256: requestSha256,
        manifest_sha256: submission.manifest.fingerprint,
        status: "completed",
        run: { ...run, run_json: runJson },
      },
    }, submission);
    return this.#request;
  }
}

function recordedModelicaV2TestRegistry(): EngineeringProjectPlanOperationRegistry {
  return {
    validate(input) {
      const descriptor = RECORDED_ANALYSIS_OPERATION_DESCRIPTORS.find((item) =>
        item.id === input.operation.id && item.version === input.operation.version
      );
      if (!descriptor) return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
      if (
        input.stage === "queue" &&
        !(descriptor.allowedBasisKinds as readonly string[]).includes(input.basisKind)
      ) throw new TypeError("Recorded Modelica fixture has an unsupported basis.");
      if (
        input.operation.bindings.length !== descriptor.bindings.length ||
        descriptor.bindings.some((declared) => {
          const supplied = input.operation.bindings.filter((binding) =>
            binding.name === declared.name
          );
          return supplied.length !== 1 ||
            !(declared.allowedSourceKinds as readonly string[]).includes(
              supplied[0]!.source.kind,
            ) ||
            ("allowedThreadEntityKinds" in declared &&
              declared.allowedThreadEntityKinds !== undefined &&
              supplied[0]!.source.kind === "thread-entity" &&
              !(declared.allowedThreadEntityKinds as readonly string[]).includes(
                supplied[0]!.source.reference.kind,
              ));
        })
      ) {
        throw new TypeError(
          "Recorded Modelica fixture bindings diverge from descriptor.",
        );
      }
      return {
        operation: descriptor,
        bindings: structuredClone(input.operation.bindings),
      };
    },
  };
}

async function qualifiedManifest(
  modelText: string,
  scenarioText: string,
  parameterSchemaText: string,
) {
  const selection = {
    modelId: "thermal-kit",
    modelVersion: "1.0.0",
    scenarioId: "heat-up",
  };
  const modelBytes = new TextEncoder().encode(modelText);
  const scenarioBytes = new TextEncoder().encode(scenarioText);
  const parameterSchemaBytes = new TextEncoder().encode(parameterSchemaText);
  const scenarioPublic = {
    id: selection.scenarioId,
    description: "Heat up",
    start_time_s: 0,
    stop_time_s: 10,
    number_of_intervals: 10,
    solver: "dassl",
    target_temperature: { value: 90, unit: "degC" },
  };
  const unsigned = {
    schemaVersion: "2.1",
    model: {
      id: selection.modelId,
      version: selection.modelVersion,
      name: "ThermalKit",
      source: {
        uri:
          `casys://modelica/kits/${selection.modelId}/${selection.modelVersion}/model.mo`,
        mediaType: "text/x-modelica",
        bytes: modelBytes.byteLength,
        sha256: await fingerprintResourceBytes(modelBytes),
        qualification: "qualified-kit" as const,
      },
    },
    scenario: {
      id: selection.scenarioId,
      source: {
        uri:
          `casys://modelica/kits/${selection.modelId}/${selection.modelVersion}/scenarios/${selection.scenarioId}.json`,
        mediaType: "application/json",
        bytes: scenarioBytes.byteLength,
        sha256: await fingerprintResourceBytes(scenarioBytes),
        qualification: "qualified-kit" as const,
      },
      public: scenarioPublic,
      projection_sha256: await fingerprintModelicaResumableProviderJson(
        scenarioPublic,
      ),
    },
    parameter_schema: {
      uri:
        `casys://modelica/kits/${selection.modelId}/${selection.modelVersion}/parameter-schema.json`,
      mediaType: "application/json",
      bytes: parameterSchemaBytes.byteLength,
      sha256: await fingerprintResourceBytes(parameterSchemaBytes),
      qualification: "compiler-derived-verified" as const,
    },
    parameters: [{
      id: "power",
      modelica_name: "power",
      modelica_type: "Real",
      description: "Heater power",
      unit: "W",
      minimum: 0,
      maximum: 1_000,
      conversion: { from: "W", to: "W", factor: 1, offset: 0 },
    }],
    produced_metrics: [{
      id: "temperature",
      unit: "degC",
      description: "Maximum temperature",
      required: true,
    }],
    result_normalizer: { id: "csv", version: "1.0" },
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    engine: { name: "OpenModelica", version: "1.23", msl_version: "4.0" },
  };
  const fingerprint = await fingerprintModelicaResumableProviderJson(unsigned);
  const wireManifest = { ...unsigned, fingerprint, manifest_sha256: fingerprint };
  const manifest = await parseManifestEnvelope({
    schemaVersion: "2.1",
    kind: "simulation-manifest",
    manifest: wireManifest,
  }, selection);
  return { manifest, wireManifest };
}

function fixtureCase(input: {
  projectId: string;
  subjectId: string;
  basisSnapshotId: string;
  manifest: ModelicaQualifiedManifestDocument;
}): SimulationCaseV2 {
  return validateSimulationCaseV2({
    schemaVersion: "simulation-case/2.0",
    id: "fixture-modelica-case-v2",
    revision: 1,
    scope: "qualification-test",
    evidenceBoundary: "test",
    project: {
      id: input.projectId,
      subjectId: input.subjectId,
      baseThreadSnapshot: {
        id: input.basisSnapshotId,
        revision: 1,
        subjectId: input.subjectId,
      },
    },
    kit: {
      modelId: input.manifest.selection.modelId,
      modelVersion: input.manifest.selection.modelVersion,
      modelSha256: input.manifest.model.sha256,
    },
    scenario: {
      id: input.manifest.selection.scenarioId,
      sourceSha256: input.manifest.scenario.sha256,
      projectionSha256: input.manifest.scenarioProjectionSha256,
    },
    parameters: [{ id: "power", value: 250, unit: "W" }],
    expectedMetrics: [{ id: "temperature", unit: "degC" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 30_000,
  });
}

function byteStore<K extends string>(kind: K, directory: string, uriNamespace: string) {
  return new FileByteStore({ kind, directory, uriNamespace, label: kind });
}

function context(projectId: string, commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId,
    expectedRevision,
    issuedAt: "2026-08-12T00:00:00.000Z",
  };
}

function exactArtifact(snapshot: ThreadSnapshot, prefix: string) {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id.startsWith(prefix)
  );
  if (matches.length !== 1) throw new Error(`Expected one fixture artifact ${prefix}.`);
  return matches[0]!;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function omcScript(submission: ModelicaResumableSubmission): string {
  const overrides = submission.manifest.parameters.map((parameter) => {
    const quantity = submission.parameters[parameter.id]!;
    return [
      parameter.modelicaName,
      quantity.value * parameter.conversion.factor + parameter.conversion.offset,
    ] as const;
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}=${Object.is(value, -0) ? 0 : value}`).join(",");
  const scenario = submission.manifest.scenarioPublic;
  return [
    "// Generated by mcp-modelica 2.1. Do not edit: the server owns this script.",
    "loadModel(Modelica);",
    `loadFile("${submission.manifest.modelName}.mo");`,
    `simulate(${submission.manifest.modelName}, startTime=${scenario.startTimeS}, stopTime=${scenario.stopTimeS}, numberOfIntervals=${scenario.numberOfIntervals}, method="${scenario.solver}", outputFormat="csv", fileNamePrefix="result", simflags="-override=${overrides}");`,
    "getErrorString();",
    "",
  ].join("\n");
}
