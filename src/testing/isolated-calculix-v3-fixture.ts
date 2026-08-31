/**
 * Causal fixture for the recorded CalculiX ROP2 executor.
 *
 * It deliberately uses the real file-backed project, snapshot and plan CAS
 * stores.  Only the pre-existing sealed proof branch is assembled locally:
 * subsequent admission, queueing and lifecycle transitions use the regular
 * command service just like a deployed recorded run.
 */

import {
  canonicalProofText,
  encodeFeaProofDecisionParameters,
} from "../domain/fea/seal-case/fea-proof-proposal.ts";
import { validateMechanicalProofCase } from "../domain/fea/seal-case/mechanical-proof-case.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../domain/architecture/requirements/requirements-proposal.ts";
import { fingerprintResourceBytes } from "../domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../domain/kernel/deterministic-json.ts";
import {
  EngineeringProjectCommandService,
} from "../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../application/use-cases/project/project-brief-command-service.ts";
import type { ContentFingerprint } from "../domain/kernel/primitives.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadProvenanceLink,
  ThreadSnapshot,
  TracedRequirement,
} from "../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../domain/thread/thread-snapshot-extension.ts";
import { REQUIREMENTS_CAPTURE_URI_PREFIX } from "../domain/thread/requirements-tip.ts";
import {
  parseExactRequirementsCapture,
  REQUIREMENTS_CAPTURE_SCHEMA,
} from "../adapters/architecture/requirements/requirements-capture.ts";
import { FileByteStore } from "../adapters/shared/cas/file-byte-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../adapters/shared/cas/file-capture-store.ts";
import { ApprovedBriefBaselineRunExecutor } from "../adapters/project/approved-brief-baseline-run-executor.ts";
import {
  CaptureBackedRunPlanSealer,
} from "../adapters/compile/plans/capture-backed-run-plan-sealer.ts";
import { ResolvedOperationPlanResolver } from "../adapters/compile/plans/resolved-operation-plan-resolver.ts";
import { FileEngineeringProjectRevisionStore } from "../adapters/shared/stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../adapters/shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../adapters/shared/stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../adapters/validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../adapters/project/engineering-project-initial-baseline-evidence-validator.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";
import { FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS } from "../orchestration/operations/fea-isolated-static-proof.ts";
import { approvedBriefSourceAnalysisFixture } from "./approved-brief-source-analysis-fixture.ts";
import type { CalculixIsolatedExecutionProfile } from "../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../domain/capability/runtime/capability-runtime-supervision.ts";

export const ISOLATED_CALCULIX_FIXTURE_AGENT = {
  kind: "agent" as const,
  actorId: "agent:recorded-calculix-v2-fixture",
};
export const ISOLATED_CALCULIX_FIXTURE_HUMAN = {
  kind: "human" as const,
  actorId: "human:recorded-calculix-v2-fixture",
};
export const ISOLATED_CALCULIX_FIXTURE_PROJECT = "project:recorded-calculix-v2";
export const ISOLATED_CALCULIX_FIXTURE_RUN = "run:recorded-calculix-v2";

export interface IsolatedCalculixFixture {
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

export type IsolatedCalculixV3Fixture = IsolatedCalculixFixture;

/**
 * Build a queued, fully sealed ROP2 CalculiX run.  The fixture plan is
 * intentionally code-owned by the plan sealer, never supplied by a caller.
 */
export async function createHistoricalFeaStaticProofV2Fixture(
  directory: string,
): Promise<IsolatedCalculixFixture> {
  return await createIsolatedCalculixFixture(directory, { operationVersion: "2" });
}

export async function createIsolatedCalculixV3Fixture(
  directory: string,
  localProfile: CalculixIsolatedExecutionProfile,
): Promise<IsolatedCalculixV3Fixture> {
  return await createIsolatedCalculixFixture(directory, {
    operationVersion: "3",
    localProfile,
  });
}

async function createIsolatedCalculixFixture(
  directory: string,
  options:
    | { readonly operationVersion: "2" }
    | {
      readonly operationVersion: "3";
      readonly localProfile: CalculixIsolatedExecutionProfile;
    },
): Promise<IsolatedCalculixFixture> {
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
  const resolverBox: { current?: ResolvedOperationPlanResolver } = {};
  const plans = new CaptureBackedRunPlanSealer({
    store: planStore,
    resolver: {
      resolve: (input) => {
        if (!resolverBox.current) {
          throw new Error("Fixture recorded CalculiX resolver is not ready.");
        }
        return resolverBox.current.resolve(input);
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
    {
      operations: fixtureOperationRegistry,
      runPlanSealer: plans,
      queueEligibility: {
        validate: ({ project, operation }) =>
          Promise.resolve(
            operation.id === "verify.run-fea-static-proof"
              ? operationalCapabilityFor(project.project.id, operation)
              : undefined,
          ),
      },
    },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      sourceAnalysis,
    ),
  );

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    commandId: "fixture:start",
    projectId: ISOLATED_CALCULIX_FIXTURE_PROJECT,
    projectName: "Recorded CalculiX ROP2 fixture",
    issuedAt: now(),
    intent: "Exercise the exact recorded CalculiX executor path.",
    intentSource: { kind: "human", reference: "conversation:recorded-calculix-v2" },
  });
  project = await briefs.proposeBrief(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:propose-brief", project.revision, now()),
    items: briefItems(),
  });
  project = await briefs.approveBrief(ISOLATED_CALCULIX_FIXTURE_HUMAN, {
    ...context("fixture:approve-brief", project.revision, now()),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approve the bounded recorded CalculiX fixture.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  project = await commands.publishPlan(ISOLATED_CALCULIX_FIXTURE_AGENT, {
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

  project = await commands.queueRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
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
  }).execute(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:execute-baseline", project.revision, now()),
    runId: "run:fixture-baseline",
  });
  const baselineReference = baselined.threadSnapshots[0]!;
  const baselineSnapshot = await snapshots.get(baselineReference.snapshotId);
  if (!baselineSnapshot) throw new Error("Fixture baseline ThreadSnapshot is absent.");
  // Assemble candidate source identities only to form the seal MRTR. The real
  // capture is constructed after the distinct seal run is claimed, so its
  // sealedAt field is the durable lifecycle timestamp rather than a fixture
  // invention.
  const candidate = await sealedProofBranch(baselineSnapshot, "pending");
  const candidateDigest = await fingerprintResourceBytes(
    new TextEncoder().encode(canonicalProofText(candidate.proofCase)),
  );

  // The proof branch reaches the Project head through an actual, distinct
  // verify.seal-proof-case@1 work item, human MRTR and completed run. It is
  // intentionally not the later recorded CalculiX execution authority.
  project = await commands.appendChange(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:append-proof-seal", baselined.revision, now()),
    baseSnapshot: baselineReference,
    phases: [{
      id: "fixture-proof-seal",
      name: "Fixture proof seal",
      description: "Seal the reviewed proof before the distinct recorded run.",
    }],
    workItems: [{
      id: "fixture-proof-seal-item",
      phaseId: "fixture-proof-seal",
      owner: "agent",
      dependsOnWorkItemIds: ["baseline-item"],
      decisionIds: ["fixture-proof-seal-decision"],
      operation: {
        id: "verify.seal-proof-case",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "fixture-proof-seal-decision",
      phaseId: "fixture-proof-seal",
      title: "Approve fixture proof seal",
      question: "Approve the exact mechanical proof case for sealing?",
    }],
  });
  project = await commands.proposeDecision(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:propose-proof-seal", project.revision, now()),
    decisionId: "fixture-proof-seal-decision",
    baseSnapshot: baselineReference,
    proposal: {
      summary: "Seal the exact reviewed proof case and its exact source artifacts.",
      parameters: encodeFeaProofDecisionParameters(
        candidateDigest,
        candidate.proofCase,
        {
          id: candidate.geometryArtifact.id,
          fingerprint: candidate.geometryArtifact.fingerprint,
        },
        {
          id: candidate.requirementsArtifact.id,
          fingerprint: candidate.requirementsArtifact.fingerprint,
        },
        "1".repeat(64),
      ),
    },
  });
  const sealDecision = project.decisions.find((item) =>
    item.id === "fixture-proof-seal-decision"
  )!;
  project = await commands.approveDecision(ISOLATED_CALCULIX_FIXTURE_HUMAN, {
    ...context("fixture:approve-proof-seal", project.revision, now()),
    decisionId: sealDecision.id,
    rationale: "The exact fixture proof seal is approved.",
    inputFingerprint: sealDecision.inputFingerprint!,
  });
  project = await commands.queueRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:queue-proof-seal", project.revision, now()),
    runId: "run:fixture-seal-proof",
    workItemId: "fixture-proof-seal-item",
    summary: "Seal the exact reviewed fixture proof.",
    basis: { kind: "thread-snapshot", ...baselineReference },
  });
  project = await commands.claimRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:claim-proof-seal", project.revision, now()),
    runId: "run:fixture-seal-proof",
    summary: "Claim fixture proof seal.",
  });
  const sealRun = project.agentRuns.find((item) =>
    item.id === "run:fixture-seal-proof"
  )!;
  if (!sealRun.startedAt) {
    throw new Error("Fixture proof seal claim did not stamp startedAt.");
  }
  const prepared = await sealedProofBranch(baselineSnapshot, sealRun.startedAt);
  await snapshots.save(prepared.basis);
  project = await commands.publishRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:publish-proof-seal", project.revision, now()),
    runId: "run:fixture-seal-proof",
    summary: "Publish fixture proof seal.",
  });
  project = await commands.completeRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:complete-proof-seal", project.revision, now()),
    runId: "run:fixture-seal-proof",
    summary: "Complete fixture proof seal.",
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
  resolverBox.current = new ResolvedOperationPlanResolver({
    snapshots,
    artifacts: {
      read: (artifact) =>
        Promise.resolve(
          artifact.uri ? artifactBytesFor(prepared, artifact.uri) : undefined,
        ),
    },
    stepAssets: { read: () => Promise.resolve(Uint8Array.from(prepared.stepBytes)) },
    calculix: {
      elementOrder: 1,
      timeoutMs: 60_000,
      ...(options.operationVersion === "3"
        ? { localProfile: options.localProfile }
        : {}),
    },
  });
  project = await commands.appendChange(ISOLATED_CALCULIX_FIXTURE_AGENT, {
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
        version: options.operationVersion,
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
  project = await commands.proposeDecision(ISOLATED_CALCULIX_FIXTURE_AGENT, {
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
  project = await commands.approveDecision(ISOLATED_CALCULIX_FIXTURE_HUMAN, {
    ...context("fixture:approve-recorded", project.revision, now()),
    decisionId: decision.id,
    rationale: "The exact ROP inputs and method are approved.",
    inputFingerprint: decision.inputFingerprint!,
  });
  project = await commands.queueRun(ISOLATED_CALCULIX_FIXTURE_AGENT, {
    ...context("fixture:queue-recorded", project.revision, now()),
    runId: ISOLATED_CALCULIX_FIXTURE_RUN,
    workItemId: "recorded-fea-item",
    summary: "Execute the sealed CalculiX static proof.",
    basis: { kind: "thread-snapshot", ...basisReference },
  });

  return {
    projectId: ISOLATED_CALCULIX_FIXTURE_PROJECT,
    runId: ISOLATED_CALCULIX_FIXTURE_RUN,
    command: {
      commandId: "fixture:execute-recorded",
      projectId: ISOLATED_CALCULIX_FIXTURE_PROJECT,
      expectedRevision: project.revision,
      issuedAt: now(),
      runId: ISOLATED_CALCULIX_FIXTURE_RUN,
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

async function sealedProofBranch(ancestor: ThreadSnapshot, sealedAt: string) {
  const artifactChangedAt = Number.isNaN(Date.parse(sealedAt))
    ? fresh().changedAt
    : sealedAt;
  const subjectId = ancestor.subject.id;
  const stepBytes = new TextEncoder().encode(
    "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
  );
  const stepFingerprint = await fingerprint(stepBytes);
  const geometryFingerprint = await fingerprint("fixture geometry capture");
  const requirementsComponent = "FixtureComponent";
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
  const stepArtifact = artifact(
    "fixture-exact-step",
    "step",
    stepFingerprint,
    `/api/thread/assets/${stepFingerprint.digest}.step`,
    "model/step",
    [],
    geometryProducer,
  );
  const rawProof = JSON.parse(
    await Deno.readTextFile(
      "src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl01-articulated-arm-cantilever.json",
    ),
  );
  rawProof.project = {
    id: ISOLATED_CALCULIX_FIXTURE_PROJECT,
    subjectId,
    baseThreadSnapshot: {
      id: ancestor.id,
      revision: ancestor.revision,
      subjectId: ancestor.subject.id,
    },
  };
  rawProof.authorization = {
    workItemId: "fixture-proof-seal-item",
    decisionId: "fixture-proof-seal-decision",
  };
  rawProof.expectedCadArtifact = {
    format: "step",
    sha256: stepFingerprint.digest,
    bytes: stepBytes.byteLength,
  };
  const proofCase = validateMechanicalProofCase(rawProof);
  const seedFingerprint = await fingerprint("fixture requirements seed");
  const architectureFingerprint = await fingerprint(
    "fixture architecture capture",
  );
  // Current isolated CalculiX only reopens these bytes by Thread CAS identity.
  // The shared fixture still has to be exact requirements-capture/3.0 so it
  // cannot pretend a retired 2.0 envelope remains admitted.
  const requirementsCapture = exactFixtureRequirementsCapture({
    ancestor,
    containerComponent: requirementsComponent,
    proofCase,
    seedFingerprint,
    architectureFingerprint,
    insertedAt: fresh().changedAt,
  });
  const requirementsBytes = new TextEncoder().encode(
    deterministicJson(requirementsCapture),
  );
  const requirementsFingerprint = await fingerprint(requirementsBytes);
  const requirementsArtifact = artifact(
    "fixture-requirements-capture",
    "document",
    requirementsFingerprint,
    `${REQUIREMENTS_CAPTURE_URI_PREFIX}${requirementsComponent}/sha256/${requirementsFingerprint.digest}`,
    "application/json",
    [],
    requirementsProducer,
  );
  const proofText = canonicalProofText(proofCase);
  const proofDigest = await fingerprintResourceBytes(
    new TextEncoder().encode(proofText),
  );
  const proofCaptureText = JSON.stringify({
    canonicalProofText: proofText,
    geometryArtifact: {
      id: geometryArtifact.id,
      fingerprint: geometryArtifact.fingerprint,
      producerRunId: geometryArtifact.producer.runId,
    },
    operation: { id: "verify.seal-proof-case", version: "1" },
    proofDigest,
    requirementsArtifact: {
      id: requirementsArtifact.id,
      fingerprint: requirementsArtifact.fingerprint,
      producerRunId: requirementsArtifact.producer.runId,
    },
    requirementsElementId: "fixture-requirements",
    schemaVersion: "fea-proof-case-capture/1.0",
    sealedAt,
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
  const proofArtifact = {
    ...artifact(
      `fea-proof-${proofFingerprint.digest}`,
      "document",
      proofFingerprint,
      `casys://fea-proof-case-capture/sha256/${proofFingerprint.digest}`,
      "application/json",
      [geometryArtifact.id, requirementsArtifact.id, stepArtifact.id],
      {
        serverId: "digital-thread",
        tool: "verify.seal-proof-case@1",
        runId: "run:fixture-seal-proof",
      },
    ),
    version: proofDigest,
    freshness: { ...fresh(), changedAt: artifactChangedAt },
  };
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

function exactFixtureRequirementsCapture(input: {
  readonly ancestor: ThreadSnapshot;
  readonly containerComponent: string;
  readonly proofCase: ReturnType<typeof validateMechanicalProofCase>;
  readonly seedFingerprint: ContentFingerprint;
  readonly architectureFingerprint: ContentFingerprint;
  readonly insertedAt: string;
}) {
  const requirements = input.proofCase.requirements.map((requirement) => ({
    id: requirement.id,
    name: requirement.name,
    // Capture metric is the SysON feature the FEA reader joins, not the
    // proof-case metric kind.
    metric: requirement.feature,
    operator: requirement.operator,
    limit: requirement.limit,
  }));
  const constraintUsages = [...requirements]
    .map((requirement) => ({
      requirementId: requirement.id,
      id: `fixture-constraint-${requirement.id}`,
      kind: "ConstraintUsage" as const,
      sourceId: `fixture-constraint-${requirement.id}`,
    }))
    .sort((left, right) =>
      left.requirementId < right.requirementId
        ? -1
        : left.requirementId > right.requirementId
        ? 1
        : 0
    );
  return parseExactRequirementsCapture({
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
    trustedRunId: "run:fixture-requirements",
    containerComponent: input.containerComponent,
    partDefName: `${input.containerComponent}Requirements`,
    target: {
      kind: "part-definition",
      label: input.containerComponent,
      elementId: input.proofCase.target.modelElementId,
    },
    architectureBasis: {
      snapshotId: input.ancestor.id,
      revision: input.ancestor.revision,
      fingerprint: input.architectureFingerprint.digest,
    },
    requirements,
    seed: {
      artifactId: "fixture-requirements-seed",
      fingerprint: input.seedFingerprint,
      producerRunId: "run:fixture-seed",
    },
    architecture: {
      artifactId: "fixture-architecture-capture",
      fingerprint: input.architectureFingerprint,
      producerRunId: "run:fixture-architecture",
    },
    requirementsElementId: "fixture-requirements",
    insertedAt: input.insertedAt,
    requirementUsage: {
      id: "fixture-requirements",
      kind: "RequirementUsage",
    },
    constraintUsages,
  });
}

function artifactBytesFor(
  prepared: Awaited<ReturnType<typeof sealedProofBranch>>,
  uri: string,
): Uint8Array | undefined {
  if (uri === prepared.proofArtifact.uri) return Uint8Array.from(prepared.proofBytes);
  if (uri === prepared.requirementsArtifact.uri) {
    return Uint8Array.from(prepared.requirementsBytes);
  }
  return undefined;
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

function operationalCapabilityFor(
  projectId: string,
  operation: { readonly id: string; readonly version: string },
): ResolvedCapabilityRuntimeOperation {
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId,
    operation: { id: operation.id, version: operation.version },
    authorizationFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    demandFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    registryFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    bindings: [{
      capability: {
        id: "mechanics.solve-static-structural",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "calculix-static-structural", version: "1" },
      effectiveQualification: "qualified",
      adapter: { id: "casys.calculix-worker", version: "1", source: "fixture" },
      profile: {
        id: "calculix-static",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      },
      materials: [{
        unitId: "casys.calculix-worker",
        materialId: "calculix-worker",
        imageDigest: "e".repeat(64),
      }],
      runtimeModes: [{
        material: {
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker",
          imageDigest: "e".repeat(64),
        },
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material: {
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker",
          imageDigest: "e".repeat(64),
        },
        kind: "ephemeral-microsandbox",
        launchGroup: null,
      }],
    }],
  };
}

function context(commandId: string, expectedRevision: number, issuedAt: string) {
  return {
    commandId,
    projectId: ISOLATED_CALCULIX_FIXTURE_PROJECT,
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
 * Test-only historical MCP `@2` identity so the isolated `@3` executor can
 * refuse a sealed `@2` ROP. Not registered in the product catalogue.
 */
const HISTORICAL_FEA_STATIC_PROOF_V2_DESCRIPTOR = {
  ...FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS[0],
  version: "2",
} as const;

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
    const descriptor = [
      ...FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS,
      HISTORICAL_FEA_STATIC_PROOF_V2_DESCRIPTOR,
    ].find((candidate) =>
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
