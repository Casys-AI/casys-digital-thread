import { assertEquals } from "@std/assert";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { validateBuyConfiguration } from "../../domain/buy/buy-configuration.ts";
import { computeBuyCostCandidate } from "../../domain/buy/buy-cost-bundle.ts";
import { selectBuyCostLines } from "../../domain/buy/buy-cost-selection.ts";
import {
  BUY_FIXTURE_PARENT,
  BUY_FIXTURE_SITE,
  BUY_FIXTURE_STEP,
  buyConfigurationFixture,
  buyPricingContext,
} from "../../domain/buy/buy-fixtures.ts";
import { validateBuySourceCaptureEnvelope } from "../../domain/buy/buy-source-capture.ts";
import { DESIGN_WRITE_GEOMETRY_TOOL } from "../../domain/cad/canonical/canonical-write-geometry-step.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  BUY_SEAL_CAPTURE_SCHEMA,
  BUY_SEAL_CAPTURE_URI_PREFIX,
  canonicalBuySealCaptureText,
  fingerprintBuySealCapture,
  validateBuySealCapture,
} from "../buy/buy-seal-capture.ts";
import { BUY_SEAL_CONFIGURATION_COST_OPERATION } from "../../domain/buy/buy-operations.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import {
  buildBuyViewerBinding,
  BUY_VIEWER_APP_ID,
  BUY_VIEWER_AUTHORITY_AMBIGUOUS_REASON,
  BUY_VIEWER_AUTHORITY_DIVERGENT_REASON,
  BUY_VIEWER_AUTHORITY_MISSING_REASON,
  BUY_VIEWER_AUTHORITY_WRONG_DECISION_REASON,
  BUY_VIEWER_RESOURCE_URI,
  BUY_VIEWER_SESSION_SCHEMA,
  type BuyCaptureReader,
} from "./buy-viewer-binding.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.buy-seal";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const NEWER_PARENT = "1111111111111111111111111111111111111111111111111111111111111111";
const NEWER_STEP = "2222222222222222222222222222222222222222222222222222222222222222";

Deno.test("Buy viewer binding reopens a current-basis sealed fixture", async () => {
  const fixture = await createBuyViewerFixture();
  const binding = await buildBuyViewerBinding(fixture);
  const payload = binding!.session.payload as {
    readonly kind: string;
    readonly projection: {
      readonly status: string;
      readonly result?: { readonly basis?: { readonly old?: unknown } };
    };
    readonly anchor: { readonly kind: string; readonly id: string };
  };
  assertEquals(binding?.session.schema, BUY_VIEWER_SESSION_SCHEMA);
  assertEquals(payload.kind, "buy.configuration-cost");
  assertEquals(payload.projection.status, "available");
  assertEquals(payload.projection.result?.basis?.old, undefined);
  assertEquals(payload.anchor.kind, "document");
  assertEquals(payload.anchor.id, fixture.artifact.id);
});

Deno.test(
  "Buy viewer binding keeps later current geometry as historical recorded evidence",
  async () => {
    const fixture = await createBuyViewerFixture();
    const later = laterCurrentThread(fixture.thread, fixture.artifact);
    const project = validateEngineeringProjectSnapshot({
      ...fixture.project,
      threadSnapshots: [
        ...fixture.project.threadSnapshots,
        {
          snapshotId: later.id,
          revision: later.revision,
          subjectId: later.subject.id,
        },
      ],
    });
    const binding = await buildBuyViewerBinding({
      ...fixture,
      project,
      thread: later,
    });
    const payload = binding!.session.payload as {
      readonly projection: {
        readonly status: string;
        readonly result?: { readonly basis?: { readonly old?: unknown } };
      };
      readonly anchor: { readonly id: string };
    };
    assertEquals(payload.projection.status, "available");
    assertEquals(payload.projection.result?.basis?.old !== undefined, true);
    assertEquals(payload.anchor.id, fixture.artifact.id);
  },
);

Deno.test(
  "Buy viewer binding keeps a missing human-approved decision as unavailable",
  async () => {
    const fixture = await createBuyViewerFixture();
    const project = validateEngineeringProjectSnapshot({
      ...fixture.project,
      approvals: [],
      decisions: fixture.project.decisions.map((item) => ({
        id: item.id,
        phaseId: item.phaseId,
        title: item.title,
        question: item.question,
        status: "required" as const,
        requestedAt: item.requestedAt,
        inputEvidenceRefs: item.inputEvidenceRefs,
        approvalIds: [],
      })),
    });
    const binding = await buildBuyViewerBinding({ ...fixture, project });
    const projection = binding!.session.payload.projection as {
      readonly status: string;
      readonly reason?: string;
      readonly result?: unknown;
    };
    assertEquals(projection.status, "unavailable");
    assertEquals(projection.reason, BUY_VIEWER_AUTHORITY_MISSING_REASON);
    assertEquals(projection.result, undefined);
  },
);

Deno.test(
  "Buy viewer binding refuses a capture.decisionId that is not the authorized decision",
  async () => {
    const fixture = await createBuyViewerFixture();
    const threadRef = fixture.project.threadSnapshots[0]!;
    const project = validateEngineeringProjectSnapshot({
      ...fixture.project,
      phases: fixture.project.phases.map((phase) => ({
        ...phase,
        requiredDecisionIds: ["decision.other"],
      })),
      workItems: fixture.project.workItems.map((item) =>
        item.id === "work.buy-seal"
          ? { ...item, decisionIds: ["decision.other"] }
          : item
      ),
      decisions: [
        ...fixture.project.decisions,
        {
          ...fixture.project.decisions[0]!,
          id: "decision.other",
          approvalIds: ["approval.other"],
        },
      ],
      approvals: [
        ...fixture.project.approvals,
        {
          ...fixture.project.approvals[0]!,
          id: "approval.other",
          decisionId: "decision.other",
        },
      ],
    });
    assertEquals(threadRef.subjectId, SUBJECT_ID);
    const binding = await buildBuyViewerBinding({ ...fixture, project });
    const projection = binding!.session.payload.projection as {
      readonly status: string;
      readonly reason?: string;
    };
    assertEquals(projection.status, "unavailable");
    assertEquals(projection.reason, BUY_VIEWER_AUTHORITY_WRONG_DECISION_REASON);
  },
);

Deno.test(
  "Buy viewer binding keeps a same-subject different-basis approval as unavailable",
  async () => {
    const fixture = await createBuyViewerFixture();
    const prior = priorThread();
    const priorRef = {
      snapshotId: prior.id,
      revision: prior.revision,
      subjectId: prior.subject.id,
    };
    const project = validateEngineeringProjectSnapshot({
      ...fixture.project,
      threadSnapshots: [priorRef, ...fixture.project.threadSnapshots],
      decisions: fixture.project.decisions.map((item) => ({
        ...item,
        baseSnapshot: priorRef,
      })),
      approvals: fixture.project.approvals.map((item) => ({
        ...item,
        baseSnapshot: priorRef,
      })),
    });
    const binding = await buildBuyViewerBinding({ ...fixture, project });
    const projection = binding!.session.payload.projection as {
      readonly status: string;
      readonly reason?: string;
    };
    assertEquals(projection.status, "unavailable");
    assertEquals(projection.reason, BUY_VIEWER_AUTHORITY_DIVERGENT_REASON);
  },
);

Deno.test("Buy viewer binding keeps ambiguous human approvals as unavailable", async () => {
  const fixture = await createBuyViewerFixture();
  const project = validateEngineeringProjectSnapshot({
    ...fixture.project,
    approvals: [
      ...fixture.project.approvals,
      {
        ...fixture.project.approvals[0]!,
        id: "approval.buy-seal-2",
      },
    ],
    decisions: fixture.project.decisions.map((item) =>
      item.id === "decision.buy-seal"
        ? { ...item, approvalIds: [...item.approvalIds, "approval.buy-seal-2"] }
        : item
    ),
  });
  const binding = await buildBuyViewerBinding({ ...fixture, project });
  const projection = binding!.session.payload.projection as {
    readonly status: string;
    readonly reason?: string;
  };
  assertEquals(projection.status, "unavailable");
  assertEquals(projection.reason, BUY_VIEWER_AUTHORITY_AMBIGUOUS_REASON);
});

async function createBuyViewerFixture() {
  const sealed = await createSealedBuyArtifact();
  const briefs = new ProjectBriefCommandService(
    new FileEngineeringProjectRevisionStore(
      await Deno.makeTempDir({ prefix: "buy-viewer-binding-" }),
    ),
    () => AT,
  );
  const seeded = await startApprovedBrief(briefs);
  const threadRef = {
    snapshotId: sealed.thread.id,
    revision: sealed.thread.revision,
    subjectId: SUBJECT_ID,
  };
  const project = validateEngineeringProjectSnapshot({
    ...seeded,
    threadSnapshots: [threadRef],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Buy evidence.",
      workItemIds: ["work.buy-seal"],
      requiredDecisionIds: ["decision.buy-seal"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.buy-seal",
      activityId: "activity:work.buy-seal",
      phaseId: "phase.industrialize",
      title: "Seal Buy costs",
      description: "Seal Buy costs.",
      kind: "industrialize",
      operation: {
        id: BUY_SEAL_CONFIGURATION_COST_OPERATION.id,
        version: BUY_SEAL_CONFIGURATION_COST_OPERATION.version,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [{
        snapshotId: sealed.thread.id,
        snapshotRevision: sealed.thread.revision,
        kind: "artifact",
        id: sealed.artifact.id,
      }],
      decisionIds: ["decision.buy-seal"],
      blockerIds: [],
    }],
    decisions: [{
      id: "decision.buy-seal",
      phaseId: "phase.industrialize",
      title: "Seal Buy costs",
      question: "Seal?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: threadRef,
      inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      inputEvidenceRefs: [],
      approvalIds: ["approval.buy-seal"],
      proposal: {
        summary: "Seal Buy costs.",
        parameters: [{
          key: "buy.seal.bundle.digest",
          label: "Bundle",
          value: sealed.capture.bundleDigest,
        }],
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: "approval.buy-seal",
      decisionId: "decision.buy-seal",
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "fixture",
      baseSnapshot: threadRef,
      inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      inputEvidenceRefs: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: "work.buy-seal",
      status: "completed",
      summary: "Sealed Buy costs.",
      queuedAt: AT,
      startedAt: AT,
      completedAt: AT,
      basis: { kind: "thread-snapshot", ...threadRef },
      inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      evidenceRefs: [{
        snapshotId: sealed.thread.id,
        snapshotRevision: sealed.thread.revision,
        kind: "artifact",
        id: sealed.artifact.id,
      }],
      resultSnapshot: threadRef,
    }],
  });
  const seals: BuyCaptureReader = {
    read: (fingerprint) =>
      Promise.resolve(
        fingerprint.digest === sealed.captureFingerprint.digest
          ? sealed.captureText
          : undefined,
      ),
  };
  return {
    project,
    thread: sealed.thread,
    artifactId: sealed.artifact.id,
    artifact: sealed.artifact,
    capture: sealed.capture,
    packages: [installedBuyPackage()],
    seals,
  };
}

async function createSealedBuyArtifact() {
  const wrapperText = await Deno.readTextFile(
    new URL("../buy/fixtures/buy-source-capture.wrapper.json", import.meta.url),
  );
  const envelope = validateBuySourceCaptureEnvelope(
    JSON.parse(wrapperText.endsWith("\n") ? wrapperText.slice(0, -1) : wrapperText),
  );
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const configurationDigest = (await sha256Fingerprint(configuration)).digest;
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest,
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: selectBuyCostLines(configuration, [envelope]),
  });
  const bundleDigest = (await sha256Fingerprint(bundle)).digest;
  const capture = await validateBuySealCapture({
    schemaVersion: BUY_SEAL_CAPTURE_SCHEMA,
    kind: "buy.configuration-cost-sealed",
    operation: BUY_SEAL_CONFIGURATION_COST_OPERATION,
    trustedRunId: RUN_ID,
    decisionId: "decision.buy-seal",
    candidateDigest: "2".repeat(64),
    bundleDigest,
    configurationDigest,
    configuration,
    bundle,
    sourceCaptures: [envelope],
    coverageStatus: bundle.coverage.status,
    reviewStatus: bundle.coverage.status === "complete"
      ? "complete"
      : bundle.coverage.status === "partial"
      ? "partial"
      : "documentary",
    sealedAt: AT,
  });
  const captureText = canonicalBuySealCaptureText(capture);
  const captureFingerprint = await fingerprintBuySealCapture(capture);
  const artifact: ThreadArtifact = {
    id: `buy-cost-bundle-${bundleDigest}`,
    name: "Buy cost bundle",
    kind: "document",
    version: bundleDigest,
    fingerprint: captureFingerprint,
    uri: `${BUY_SEAL_CAPTURE_URI_PREFIX}${captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "buy.seal-configuration-cost@1",
      runId: RUN_ID,
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
  const thread = buyThread("snapshot.buy.seal", 2, [
    briefArtifact(),
    writeGeometryPrimary(),
    cadAssetStep(),
    artifact,
  ]);
  return { capture, captureText, captureFingerprint, artifact, thread };
}

function laterCurrentThread(
  base: ThreadSnapshot,
  artifact: ThreadArtifact,
): ThreadSnapshot {
  const result = applyThreadSnapshotExtensionIfNew(base, {
    id: "fixture-later-geometry",
    name: "Later canonical STEP",
    subjectId: base.subject.id,
    capturedAt: AT,
    artifacts: [
      {
        id: `geometry-${NEWER_PARENT}`,
        name: "Later geometry",
        kind: "cad-model",
        version: NEWER_PARENT,
        fingerprint: { algorithm: "sha256", digest: NEWER_PARENT },
        uri: `casys://geometry-capture/sha256/${NEWER_PARENT}`,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: DESIGN_WRITE_GEOMETRY_TOOL,
          runId: "run.geometry-later",
        },
        inputArtifactIds: [],
        freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
      },
      {
        id: `cad-asset-${NEWER_PARENT}-target-0-${NEWER_STEP}`,
        name: "Later STEP",
        kind: "step",
        version: NEWER_STEP,
        fingerprint: { algorithm: "sha256", digest: NEWER_STEP },
        uri: `/api/thread/assets/${NEWER_STEP}.step`,
        mediaType: "model/step",
        producer: {
          serverId: "build123d-sandbox",
          tool: "build123d_export",
          runId: "run.geometry-later",
        },
        inputArtifactIds: [],
        freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
      },
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: AT });
  if (!result.applied) throw new Error("Later geometry extension was already present.");
  if (!result.snapshot.artifacts.some((item) => item.id === artifact.id)) {
    throw new Error("Later Thread head dropped the sealed Buy artifact.");
  }
  return result.snapshot;
}

function priorThread(): ThreadSnapshot {
  return buyThread("snapshot.buy.prior", 1, [briefArtifact()]);
}

function buyThread(
  id: string,
  revision: number,
  artifacts: ThreadArtifact[],
): ThreadSnapshot {
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id,
    revision,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Buy",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: `change-set.${id}`,
      name: "Buy",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });
}

function installedBuyPackage() {
  return {
    app: { id: BUY_VIEWER_APP_ID, version: "0.0.0-fixture" },
    manifest: {
      uri: "casys://thread-viewer-apps/sha256/1",
      path: "/tmp/buy-manifest.json",
      fingerprint: "1".repeat(64),
    },
    resources: [{
      uri: BUY_VIEWER_RESOURCE_URI,
      path: "/tmp/buy-viewer.html",
      fingerprint: "2".repeat(64),
      sessionSchemas: [BUY_VIEWER_SESSION_SCHEMA],
      resultSchemas: ["io.casys.mcp-erpnext.buy-recorded-result/1.0"],
      acceptedActions: ["viewer.session.apply"],
    }],
  };
}

async function startApprovedBrief(briefs: ProjectBriefCommandService) {
  let project = await briefs.startProject(AGENT, {
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Buy viewer fixture",
    issuedAt: AT,
    intent: "Exercise Buy viewer binding.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(AGENT, {
    commandId: "brief",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Exercise Buy viewer binding.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "scenario",
      kind: "mission-scenario",
      statement: "Reopen sealed Buy evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Preserve the exact dated costs.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      dependsOnItemIds: [],
    }],
  });
  return await briefs.approveBrief(HUMAN, {
    commandId: "approve",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "fixture",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
}

function briefArtifact(): ThreadArtifact {
  return {
    id: "artifact.brief",
    name: "Brief",
    kind: "document",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    producer: {
      serverId: "digital-thread",
      tool: "baseline.from-approved-brief@1",
      runId: "run.brief",
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function writeGeometryPrimary(): ThreadArtifact {
  return {
    id: `geometry-${BUY_FIXTURE_PARENT}`,
    name: "Geometry",
    kind: "cad-model",
    version: BUY_FIXTURE_PARENT,
    fingerprint: { algorithm: "sha256", digest: BUY_FIXTURE_PARENT },
    uri: `casys://geometry-capture/sha256/${BUY_FIXTURE_PARENT}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: DESIGN_WRITE_GEOMETRY_TOOL,
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function cadAssetStep(): ThreadArtifact {
  return {
    id: `cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
    name: "STEP",
    kind: "step",
    version: BUY_FIXTURE_STEP,
    fingerprint: { algorithm: "sha256", digest: BUY_FIXTURE_STEP },
    uri: `/api/thread/assets/${BUY_FIXTURE_STEP}.step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}
