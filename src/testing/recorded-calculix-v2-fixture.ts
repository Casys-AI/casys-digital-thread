/**
 * Causal fixture for the recorded CalculiX ROP2 executor.
 *
 * It deliberately uses the real file-backed project, snapshot and plan CAS
 * stores.  Only the pre-existing sealed proof branch is assembled locally:
 * subsequent admission, queueing and lifecycle transitions use the regular
 * command service just like a deployed recorded run.
 */

import type { ResolvedOperationPlanV2 } from "../domain/analysis/resolved-operation-plan-v2.ts";
import { canonicalProofText } from "../domain/analysis/fea-proof-proposal.ts";
import { validateMechanicalProofCase } from "../domain/analysis/mechanical-proof-case.ts";
import { fingerprintResourceBytes } from "../domain/analysis/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../domain/kernel/deterministic-json.ts";
import {
  EngineeringProjectCommandService,
} from "../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../domain/project/project-brief-command-service.ts";
import type { RegisteredRunPlanSealInput } from "../domain/project/resolved-run-plan-sealer.ts";
import type { ContentFingerprint } from "../domain/kernel/types.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadProvenanceLink,
  ThreadSnapshot,
  TracedRequirement,
} from "../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../domain/thread/thread-snapshot-extension.ts";
import { FileByteStore } from "../adapters/captures/file-byte-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../adapters/captures/file-capture-store.ts";
import { ApprovedBriefBaselineRunExecutor } from "../adapters/executors/approved-brief-baseline-run-executor.ts";
import {
  CaptureBackedRunPlanSealer,
} from "../adapters/plans/capture-backed-run-plan-sealer.ts";
import { FileEngineeringProjectRevisionStore } from "../adapters/stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../adapters/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../adapters/stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../adapters/validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../adapters/validators/engineering-project-initial-baseline-evidence-validator.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";
import { RECORDED_ANALYSIS_OPERATION_DESCRIPTORS } from "../orchestration/operations/recorded-analysis.ts";
import { approvedBriefSourceAnalysisFixture } from "./approved-brief-source-analysis-fixture.ts";

export const RECORDED_CALCULIX_V2_FIXTURE_AGENT = {
  kind: "agent" as const,
  actorId: "agent:recorded-calculix-v2-fixture",
};
export const RECORDED_CALCULIX_V2_FIXTURE_HUMAN = {
  kind: "human" as const,
  actorId: "human:recorded-calculix-v2-fixture",
};
export const RECORDED_CALCULIX_V2_FIXTURE_PROJECT = "project:recorded-calculix-v2";
export const RECORDED_CALCULIX_V2_FIXTURE_RUN = "run:recorded-calculix-v2";

export interface RecordedCalculixV2Fixture {
  readonly projectId: string;
  readonly runId: string;
  readonly command: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
    readonly runId: string;
  };
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly snapshots: FileThreadSnapshotStore;
  readonly commands: EngineeringProjectCommandService;
  readonly plans: CaptureBackedRunPlanSealer;
  readonly planStore: FileByteStore<"resolved-operation-plan">;
  readonly basis: ThreadSnapshot;
  readonly proofArtifact: ThreadArtifact;
  readonly geometryArtifact: ThreadArtifact;
  readonly requirementsArtifact: ThreadArtifact;
  readonly stepBytes: Uint8Array;
  readonly proofBytes: Uint8Array;
  readonly requirementsBytes: Uint8Array;
  readonly artifactBytes: ReadonlyMap<string, Uint8Array>;
  readonly proofCase: ReturnType<typeof validateMechanicalProofCase>;
}

/**
 * Build a queued, fully sealed ROP2 CalculiX run.  The fixture plan is
 * intentionally code-owned by the plan sealer, never supplied by a caller.
 */
export async function createRecordedCalculixV2Fixture(
  directory: string,
): Promise<RecordedCalculixV2Fixture> {
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-12T03:00:00.000Z") + ++tick * 1_000)
      .toISOString();
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const planStore = new FileByteStore({
    kind: "resolved-operation-plan",
    directory: `${directory}/plans`,
    uriNamespace: "resolved-operation-plan",
    label: "Fixture resolved operation plan",
  });
  const preparedBox: {
    current?: Awaited<ReturnType<typeof sealedProofBranch>>;
  } = {};
  const plans = new CaptureBackedRunPlanSealer({
    store: planStore,
    resolver: {
      resolve: (input) => {
        if (!preparedBox.current) {
          throw new Error("Fixture proof branch is not yet sealed.");
        }
        return resolveFixturePlan(input, preparedBox.current);
      },
    },
  });
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const sourceAnalysis = approvedBriefSourceAnalysisFixture(directory);
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: fixtureOperationRegistry, runPlanSealer: plans },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      sourceAnalysis,
    ),
  );

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    commandId: "fixture:start",
    projectId: RECORDED_CALCULIX_V2_FIXTURE_PROJECT,
    projectName: "Recorded CalculiX ROP2 fixture",
    issuedAt: now(),
    intent: "Exercise the exact recorded CalculiX executor path.",
    intentSource: { kind: "human", reference: "conversation:recorded-calculix-v2" },
  });
  project = await briefs.proposeBrief(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:propose-brief", project.revision, now()),
    items: briefItems(),
  });
  project = await briefs.approveBrief(RECORDED_CALCULIX_V2_FIXTURE_HUMAN, {
    ...context("fixture:approve-brief", project.revision, now()),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approve the bounded recorded CalculiX fixture.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  project = await commands.publishPlan(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:publish-bootstrap", project.revision, now()),
    startingPoint: "idea-or-spec",
    phases: [{ id: "bootstrap", name: "Bootstrap", description: "Fixture basis." }],
    workItems: [{
      id: "baseline-item",
      phaseId: "bootstrap",
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

  project = await commands.queueRun(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:queue-baseline", project.revision, now()),
    runId: "run:fixture-baseline",
    workItemId: "baseline-item",
    summary: "Record the approved brief baseline.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...sourceAnalysis,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now,
  }).execute(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:execute-baseline", project.revision, now()),
    runId: "run:fixture-baseline",
  });
  const baselineReference = baselined.threadSnapshots[0]!;
  const baselineSnapshot = await snapshots.get(baselineReference.snapshotId);
  if (!baselineSnapshot) throw new Error("Fixture baseline ThreadSnapshot is absent.");
  preparedBox.current = await sealedProofBranch(baselineSnapshot);
  const prepared = preparedBox.current;
  if (!prepared) throw new Error("Fixture proof branch failed to seal.");
  await snapshots.save(prepared.basis);

  // The proof branch reaches the Project head through a real command-service
  // completion.  This avoids a test-only project-store mutation that would
  // bypass immutable receipts and completion-evidence validation.
  project = await commands.appendChange(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:append-proof-branch", baselined.revision, now()),
    baseSnapshot: baselineReference,
    phases: [{
      id: "fixture-proof-branch",
      name: "Fixture proof branch",
      description: "Register the exact locally sealed proof branch.",
    }],
    workItems: [{
      id: "fixture-proof-branch-item",
      phaseId: "fixture-proof-branch",
      owner: "agent",
      dependsOnWorkItemIds: ["baseline-item"],
      decisionIds: [],
      operation: { id: "fixture.artifacts-stub", version: "1", bindings: [] },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:queue-proof-branch", project.revision, now()),
    runId: "run:fixture-proof-branch",
    workItemId: "fixture-proof-branch-item",
    summary: "Register the exact sealed proof branch.",
    basis: { kind: "thread-snapshot", ...baselineReference },
  });
  project = await commands.claimRun(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:claim-proof-branch", project.revision, now()),
    runId: "run:fixture-proof-branch",
    summary: "Claim proof branch registration.",
  });
  project = await commands.publishRun(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:publish-proof-branch", project.revision, now()),
    runId: "run:fixture-proof-branch",
    summary: "Publish proof branch registration.",
  });
  project = await commands.completeRun(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:complete-proof-branch", project.revision, now()),
    runId: "run:fixture-proof-branch",
    summary: "Complete proof branch registration.",
    resultSnapshot: {
      snapshotId: prepared.basis.id,
      revision: prepared.basis.revision,
      subjectId: prepared.basis.subject.id,
    },
    evidenceRefs: [{
      snapshotId: prepared.basis.id,
      snapshotRevision: prepared.basis.revision,
      kind: "artifact",
      id: prepared.proofArtifact.id,
    }],
  });

  const basisReference = {
    snapshotId: prepared.basis.id,
    revision: prepared.basis.revision,
    subjectId: prepared.basis.subject.id,
  };
  project = await commands.appendChange(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:append-recorded", project.revision, now()),
    baseSnapshot: basisReference,
    phases: [{
      id: "recorded-fea",
      name: "Recorded FEA",
      description: "Run the sealed static proof exactly once.",
    }],
    workItems: [{
      id: "recorded-fea-item",
      phaseId: "recorded-fea",
      owner: "agent",
      dependsOnWorkItemIds: ["baseline-item"],
      decisionIds: ["recorded-fea-decision"],
      operation: {
        id: "verify.run-fea-static-proof",
        version: "2",
        bindings: [
          threadBinding("proofCase", prepared.proofArtifact, prepared.basis),
          threadBinding("geometry", prepared.stepArtifact, prepared.basis),
        ],
      },
    }],
    requiredDecisions: [{
      id: "recorded-fea-decision",
      phaseId: "recorded-fea",
      title: "Approve recorded static proof",
      question: "Approve the exact sealed proof and STEP for this recorded run?",
    }],
  });
  project = await commands.proposeDecision(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:propose-recorded", project.revision, now()),
    decisionId: "recorded-fea-decision",
    baseSnapshot: basisReference,
    proposal: {
      summary: "Execute exactly the persisted proof capture and STEP.",
      parameters: [{ key: "request", label: "Recorded request", value: "calculix" }],
    },
  });
  const decision = project.decisions.find((item) =>
    item.id === "recorded-fea-decision"
  )!;
  project = await commands.approveDecision(RECORDED_CALCULIX_V2_FIXTURE_HUMAN, {
    ...context("fixture:approve-recorded", project.revision, now()),
    decisionId: decision.id,
    rationale: "The exact ROP inputs and method are approved.",
    inputFingerprint: decision.inputFingerprint!,
  });
  project = await commands.queueRun(RECORDED_CALCULIX_V2_FIXTURE_AGENT, {
    ...context("fixture:queue-recorded", project.revision, now()),
    runId: RECORDED_CALCULIX_V2_FIXTURE_RUN,
    workItemId: "recorded-fea-item",
    summary: "Execute the sealed CalculiX static proof.",
    basis: { kind: "thread-snapshot", ...basisReference },
  });

  return {
    projectId: RECORDED_CALCULIX_V2_FIXTURE_PROJECT,
    runId: RECORDED_CALCULIX_V2_FIXTURE_RUN,
    command: {
      commandId: "fixture:execute-recorded",
      projectId: RECORDED_CALCULIX_V2_FIXTURE_PROJECT,
      expectedRevision: project.revision,
      issuedAt: now(),
      runId: RECORDED_CALCULIX_V2_FIXTURE_RUN,
    },
    projects,
    snapshots,
    commands,
    plans,
    planStore,
    basis: prepared.basis,
    proofArtifact: prepared.proofArtifact,
    geometryArtifact: prepared.geometryArtifact,
    requirementsArtifact: prepared.requirementsArtifact,
    stepBytes: prepared.stepBytes,
    proofBytes: prepared.proofBytes,
    requirementsBytes: prepared.requirementsBytes,
    artifactBytes: new Map([
      [prepared.proofArtifact.uri!, prepared.proofBytes],
      [prepared.requirementsArtifact.uri!, prepared.requirementsBytes],
    ]),
    proofCase: prepared.proofCase,
  };
}

async function sealedProofBranch(ancestor: ThreadSnapshot) {
  const subjectId = ancestor.subject.id;
  const stepBytes = new TextEncoder().encode(
    "ISO-10303-21; recorded-calculix-fixture-step",
  );
  const stepFingerprint = await fingerprint(stepBytes);
  const geometryFingerprint = await fingerprint("fixture geometry capture");
  const requirementsComponent = "FixtureComponent";
  const requirementsBytes = new TextEncoder().encode(deterministicJson({
    schemaVersion: "requirements-capture/2.0",
    containerComponent: requirementsComponent,
    requirements: [],
  }));
  const requirementsFingerprint = await fingerprint(requirementsBytes);
  const geometryProducer = {
    serverId: "digital-thread",
    tool: "design.write-geometry@1",
    runId: "run:fixture-geometry",
  };
  const requirementsProducer = {
    serverId: "digital-thread",
    tool: "model.write-requirements@1",
    runId: "run:fixture-requirements",
  };
  const geometryArtifact = artifact(
    "fixture-geometry-capture",
    "cad-model",
    geometryFingerprint,
    `casys://fixture-geometry-capture/sha256/${geometryFingerprint.digest}`,
    "application/json",
    [],
    geometryProducer,
  );
  const requirementsArtifact = artifact(
    "fixture-requirements-capture",
    "document",
    requirementsFingerprint,
    `casys://requirements-capture/${requirementsComponent}/sha256/${requirementsFingerprint.digest}`,
    "application/json",
    [],
    requirementsProducer,
  );
  const stepArtifact = artifact(
    "fixture-exact-step",
    "step",
    stepFingerprint,
    `casys://fixture-step/sha256/${stepFingerprint.digest}`,
    "model/step",
    [],
    geometryProducer,
  );
  const rawProof = JSON.parse(
    await Deno.readTextFile(
      "config/mechanical-proof-cases/desk-lamp-dl01-articulated-arm-cantilever.json",
    ),
  );
  rawProof.project = {
    id: RECORDED_CALCULIX_V2_FIXTURE_PROJECT,
    subjectId,
    baseThreadSnapshot: {
      id: ancestor.id,
      revision: ancestor.revision,
      subjectId: ancestor.subject.id,
    },
  };
  rawProof.authorization = {
    workItemId: "recorded-fea-item",
    decisionId: "recorded-fea-decision",
  };
  rawProof.expectedCadArtifact = {
    format: "step",
    sha256: stepFingerprint.digest,
    bytes: stepBytes.byteLength,
  };
  const proofCase = validateMechanicalProofCase(rawProof);
  const proofText = canonicalProofText(proofCase);
  const proofCaptureText = JSON.stringify({
    canonicalProofText: proofText,
    geometryArtifact: {
      id: geometryArtifact.id,
      fingerprint: geometryArtifact.fingerprint,
      producerRunId: geometryArtifact.producer.runId,
    },
    operation: { id: "verify.seal-proof-case", version: "1" },
    proofDigest: await fingerprintResourceBytes(new TextEncoder().encode(proofText)),
    requirementsArtifact: {
      id: requirementsArtifact.id,
      fingerprint: requirementsArtifact.fingerprint,
      producerRunId: requirementsArtifact.producer.runId,
    },
    requirementsElementId: "fixture-requirements",
    schemaVersion: "fea-proof-case-capture/1.0",
    sealedAt: "2026-08-12T03:00:00.000Z",
    seedIdentity: {
      editingContextId: "fixture-editing-context",
      elementId: "fixture-requirements",
    },
    stepArtifact: {
      id: stepArtifact.id,
      fingerprint: stepArtifact.fingerprint,
      producerRunId: stepArtifact.producer.runId,
      bytes: stepBytes.byteLength,
    },
    trustedRunId: "run:fixture-seal-proof",
  });
  // The capture schema is itself canonical deterministic JSON.  Its order is
  // intentionally checked by the executor, so retain the canonical serializer
  // rather than a hand-maintained key order.
  const canonicalCaptureText = deterministicJson(JSON.parse(proofCaptureText));
  const proofBytes = new TextEncoder().encode(canonicalCaptureText);
  const proofFingerprint = await fingerprint(proofBytes);
  const proofArtifact = artifact(
    "fixture-proof-capture",
    "document",
    proofFingerprint,
    `casys://fixture-fea-proof-capture/sha256/${proofFingerprint.digest}`,
    "application/json",
    [geometryArtifact.id, requirementsArtifact.id, stepArtifact.id],
    {
      serverId: "digital-thread",
      tool: "verify.seal-proof-case@1",
      runId: "run:fixture-seal-proof",
    },
  );
  const requirements: TracedRequirement[] = proofCase.requirements.map((
    requirement,
  ) => ({
    id: `thread-${requirement.id}`,
    name: requirement.name,
    statement: `Recorded requirement ${requirement.name}.`,
    version: "1",
    criterion: {
      metric: requirement.feature,
      operator: requirement.operator,
      limit: requirement.limit,
    },
    trace: {
      sourceArtifactId: requirementsArtifact.id,
      elementId: requirement.feature,
      targetArtifactIds: [stepArtifact.id],
    },
    freshness: fresh(),
  }));
  const proofConsumptions = proofArtifact.inputArtifactIds.map((artifactId) => {
    const input = [geometryArtifact, requirementsArtifact, stepArtifact].find((item) =>
      item.id === artifactId
    )!;
    return consumption(
      `fixture-proof-consume-${artifactId}`,
      artifactId,
      proofArtifact.producer,
      input.fingerprint,
    );
  });
  const proofProvenance = proofArtifact.inputArtifactIds.flatMap((artifactId) => [
    derived(`fixture-proof-derived-${artifactId}`, proofArtifact.id, artifactId),
    uses(
      `fixture-proof-uses-${artifactId}`,
      `fixture-proof-consume-${artifactId}`,
      artifactId,
    ),
  ]).concat(
    requirements.map((requirement) =>
      traceRequirement(requirement.id, stepArtifact.id)
    ),
  );
  const basis = applyThreadSnapshotExtensionIfNew(ancestor, {
    id: "fixture-sealed-proof-branch",
    name: "Fixture sealed proof branch",
    subjectId,
    capturedAt: "2026-08-12T03:00:00.000Z",
    artifacts: [geometryArtifact, requirementsArtifact, stepArtifact, proofArtifact],
    consumptions: proofConsumptions,
    observations: [],
    requirements,
    evaluations: [],
    violations: [],
    provenance: proofProvenance,
    proposedActions: [],
  }, { appliedAt: "2026-08-12T03:00:01.000Z" }).snapshot;
  return {
    ancestor,
    basis,
    proofArtifact,
    geometryArtifact,
    requirementsArtifact,
    stepArtifact,
    stepBytes,
    proofBytes,
    requirementsBytes,
    proofCase,
  };
}

async function resolveFixturePlan(
  input: RegisteredRunPlanSealInput,
  prepared: Awaited<ReturnType<typeof sealedProofBranch>>,
): Promise<ResolvedOperationPlanV2> {
  const basis = input.run.basis;
  const decision = input.project.decisions.find((item) =>
    item.id === "recorded-fea-decision"
  )!;
  const approval = input.project.approvals.find((item) =>
    item.id === decision.approvalIds.at(-1)
  )!;
  if (!basis || basis.kind !== "thread-snapshot" || !input.run.inputFingerprint) {
    throw new Error("Fixture ROP requires an exact queued ThreadSnapshot run.");
  }
  const source = (
    bindingName: string,
    role: string,
    artifact: ThreadArtifact,
    byteCount: number,
  ) => ({
    bindingName,
    role,
    threadRef: {
      snapshotId: prepared.basis.id,
      snapshotRevision: prepared.basis.revision,
      kind: "artifact" as const,
      id: artifact.id,
    },
    artifact: {
      fingerprint: artifact.fingerprint,
      byteCount,
      mediaType: artifact.mediaType!,
      casUri: artifact.uri!,
    },
  });
  const proof = source(
    "proofCase",
    "proof-case",
    prepared.proofArtifact,
    prepared.proofBytes.byteLength,
  );
  const geometry = source(
    "geometry",
    "geometry-source",
    prepared.stepArtifact,
    prepared.stepBytes.byteLength,
  );
  return {
    schemaVersion: "resolved-operation-plan/2.0",
    id: input.run.id,
    run: {
      projectId: input.project.project.id,
      runId: input.run.id,
      workItemId: input.workItem.id,
      inputFingerprint: input.run.inputFingerprint,
      queueBasisProject: input.queueBasisProject,
    },
    workItem: {
      id: input.workItem.id,
      operation: { id: "verify.run-fea-static-proof", version: "2" },
      operationFingerprint: await sha256Fingerprint(input.workItem.operation!),
    },
    authorization: {
      kind: "human-mrtr-and-qualified-method",
      mrtr: {
        decisionId: decision.id,
        decisionInputFingerprint: decision.inputFingerprint!,
        approvalId: approval.id,
        approvalFingerprint: await sha256Fingerprint(approval),
      },
      methodQualification: {
        id: "qualified-static-structural-proof-case",
        version: "1.0",
        fingerprint: prepared.proofArtifact.fingerprint,
      },
    },
    basis: {
      kind: "thread-snapshot",
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
      fingerprint: await sha256Fingerprint(prepared.basis),
    },
    sources: [proof, geometry],
    action: {
      kind: "static-structural-analysis",
      provider: {
        id: "mcp-calculix",
        contract: { id: "calculix_solve_static_recorded", version: "1.0" },
        executionIdentitySchema: "1.0",
        runSchema: "2.0",
        resultSchema: "2.0",
      },
      lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
      requestId: "recorded-calculix-v2-request",
      input: {
        proofCase: {
          id: prepared.proofCase.id,
          fingerprint: prepared.proofArtifact.fingerprint,
          sourceBinding: "proofCase",
        },
        geometrySourceBinding: "geometry",
        effectiveElementOrder: 1,
        effectiveTimeoutMs: 60_000,
      },
    },
    expectedProviderResources: {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: { id: "mcp-calculix.recorded-static-artifacts", version: "1.0" },
    },
    recovery: {
      policy: "mcp-calculix.recorded-static-recovery@1.0",
      requestId: "recorded-calculix-v2-request",
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
}

function threadBinding(
  name: string,
  artifact: ThreadArtifact,
  snapshot: ThreadSnapshot,
) {
  return {
    name,
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: snapshot.id,
        snapshotRevision: snapshot.revision,
        kind: "artifact" as const,
        id: artifact.id,
      },
    },
  };
}

function artifact(
  id: string,
  kind: ThreadArtifact["kind"],
  fingerprint: ContentFingerprint,
  uri: string,
  mediaType: string,
  inputArtifactIds: string[],
  producer: ThreadArtifact["producer"],
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType,
    producer,
    inputArtifactIds,
    freshness: fresh(),
  };
}

function consumption(
  id: string,
  artifactId: string,
  consumer: ThreadArtifact["producer"],
  observedFingerprint: ContentFingerprint,
): ThreadArtifactConsumption {
  return {
    id,
    artifactId,
    consumer,
    observedFingerprint,
    verifiedAt: "2026-08-12T03:00:00.000Z",
    status: "verified",
  };
}

function derived(id: string, from: string, to: string): ThreadProvenanceLink {
  return {
    id,
    relation: "derived_from",
    from: { kind: "artifact", id: from },
    to: { kind: "artifact", id: to },
    rationale: "Fixture seal derives the exact proof artifact from its sealed input.",
  };
}

function uses(id: string, from: string, to: string): ThreadProvenanceLink {
  return {
    id,
    relation: "uses",
    from: { kind: "consumption", id: from },
    to: { kind: "artifact", id: to },
    rationale: "Fixture seal consumed and verified the exact sealed input.",
  };
}

function traceRequirement(
  requirementId: string,
  artifactId: string,
): ThreadProvenanceLink {
  return {
    id: `fixture-requirement-trace-${requirementId}-${artifactId}`,
    relation: "traces_to",
    from: { kind: "requirement", id: requirementId },
    to: { kind: "artifact", id: artifactId },
    rationale: "Fixture requirement constrains the exact staged STEP artifact.",
  };
}

function fresh(): ThreadFreshness {
  return {
    status: "fresh",
    changedAt: "2026-08-12T03:00:00.000Z",
    invalidatedByChangeIds: [],
  };
}

async function fingerprint(value: string | Uint8Array): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(
      typeof value === "string" ? new TextEncoder().encode(value) : value,
    ),
  };
}

function context(commandId: string, expectedRevision: number, issuedAt: string) {
  return {
    commandId,
    projectId: RECORDED_CALCULIX_V2_FIXTURE_PROJECT,
    expectedRevision,
    issuedAt,
  };
}

function briefItems() {
  return [{
    id: "objective",
    kind: "objective" as const,
    statement: "Execute a recorded static structural proof from sealed evidence.",
    sourceRefs: [{
      kind: "intent" as const,
      reference: "conversation:recorded-calculix-v2",
    }],
  }, {
    id: "mission",
    kind: "mission-scenario" as const,
    statement: "Verify a reviewed mechanical limit without duplicate dispatch.",
    sourceRefs: [{
      kind: "intent" as const,
      reference: "conversation:recorded-calculix-v2",
    }],
  }, {
    id: "success",
    kind: "success-criterion" as const,
    statement: "A captured CalculiX result is traceable to its exact proof and STEP.",
    sourceRefs: [{
      kind: "intent" as const,
      reference: "conversation:recorded-calculix-v2",
    }],
    dependsOnItemIds: [],
  }];
}

/**
 * Production's root registry remains inert until server wiring is deliberately
 * changed.  The fixture admits only the already-reviewed local descriptor and
 * delegates every other operation (notably the bootstrap baseline) unchanged.
 */
const fixtureOperationRegistry = {
  validate(
    input: Parameters<typeof REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate>[0],
  ) {
    if (
      input.operation.id === "fixture.artifacts-stub" &&
      input.operation.version === "1"
    ) {
      if (input.stage === "queue" && input.basisKind !== "thread-snapshot") {
        throw new TypeError(
          "Fixture snapshot registration requires a ThreadSnapshot basis.",
        );
      }
      return {
        operation: {
          id: "fixture.artifacts-stub",
          version: "1",
          startingPoint: "idea-or-spec" as const,
          title: "Fixture snapshot registration",
          description: "Test-only registration of a persisted proof branch.",
          workItemKind: "design" as const,
          riskClass: "low" as const,
          execution: "trusted" as const,
          bindings: [],
        },
        bindings: input.operation.bindings,
      };
    }
    const descriptor = RECORDED_ANALYSIS_OPERATION_DESCRIPTORS.find((candidate) =>
      candidate.id === input.operation.id &&
      candidate.version === input.operation.version
    );
    if (!descriptor) return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
    if (input.stage === "queue" && input.basisKind !== "thread-snapshot") {
      throw new TypeError(
        `${descriptor.id}@${descriptor.version} requires a ThreadSnapshot basis.`,
      );
    }
    return { operation: descriptor, bindings: input.operation.bindings };
  },
};
