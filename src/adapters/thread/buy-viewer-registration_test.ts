import { assert, assertEquals } from "@std/assert";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import {
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
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
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  BUY_SEAL_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import {
  BUY_SEAL_CAPTURE_SCHEMA,
  BUY_SEAL_CAPTURE_URI_PREFIX,
  canonicalBuySealCaptureText,
  fingerprintBuySealCapture,
  validateBuySealCapture,
} from "../buy/buy-seal-capture.ts";
import { BUY_SEAL_CONFIGURATION_COST_OPERATION } from "../../domain/buy/buy-operations.ts";
import {
  BUY_VIEWER_APP_ID,
  BUY_VIEWER_RESOURCE_URI,
  BUY_VIEWER_SESSION_SCHEMA,
} from "./buy-viewer-binding.ts";
import { FileThreadViewerAppRegistrar } from "./thread-viewer-app-registrar.ts";
import { FileThreadViewerAppRegistry } from "./file-thread-viewer-app-registry.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const RUN_ID = "run.buy-seal";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

Deno.test("automatic registrar materializes one Buy whole-App binding from a sealed fixture", async () => {
  const root = await Deno.makeTempDir({ prefix: "buy-viewer-registrar-" });
  try {
    const fixture = await createSealedBuyFixture();
    await persistBuyRegistrarState(root, fixture);
    await writeBuyViewerPackageCatalog(root);
    const registrar = new FileThreadViewerAppRegistrar({ root });
    const first = await registrar.reconcile();
    assertEquals(first.status, "updated");
    assertEquals(first.bindingCount, 1);
    const registry = new FileThreadViewerAppRegistry({
      registryPath: `${root}/state/local/thread-viewer-apps/registry.json`,
      objectDirectory: `${root}/state/local/thread-viewer-apps/objects`,
    });
    const document = (await registry.read())!;
    assertEquals(document.bindings.length, 1);
    assertEquals(document.bindings[0]?.session.schema, BUY_VIEWER_SESSION_SCHEMA);
    assertEquals(document.bindings[0]?.anchor.id, fixture.artifact.id);
    const payload = document.bindings[0]?.session.payload as {
      readonly anchor?: {
        readonly kind?: string;
        readonly uri?: string;
        readonly fingerprint?: string;
      };
      readonly provenance?: {
        readonly bundleRef?: { readonly uri?: string; readonly fingerprint?: string };
      };
    };
    assertEquals(payload.anchor?.kind, "document");
    assertEquals(payload.anchor?.uri, payload.provenance?.bundleRef?.uri);
    assertEquals(
      payload.anchor?.fingerprint,
      payload.provenance?.bundleRef?.fingerprint,
    );
    assertEquals(
      payload.anchor?.uri?.startsWith(BUY_SEAL_CAPTURE_URI_PREFIX),
      true,
    );
    assertEquals((await registrar.reconcile()).status, "unchanged");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("automatic registrar leaves Buy unavailable without a compatible package", async () => {
  const root = await Deno.makeTempDir({ prefix: "buy-viewer-registrar-pkg-" });
  try {
    const fixture = await createSealedBuyFixture();
    await persistBuyRegistrarState(root, fixture);
    await writeBuyViewerPackageCatalog(root, { omit: true });
    const result = await new FileThreadViewerAppRegistrar({ root }).reconcile();
    assertEquals(result.bindingCount, 0);
    assert(
      result.diagnostics.some((item) => item.code === "app-unavailable"),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function createSealedBuyFixture() {
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
  const capture = {
    schemaVersion: BUY_SEAL_CAPTURE_SCHEMA,
    kind: "buy.configuration-cost-sealed" as const,
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
      ? "complete" as const
      : bundle.coverage.status === "partial"
      ? "partial" as const
      : "documentary" as const,
    sealedAt: AT,
  };
  const validated = await validateBuySealCapture(capture);
  const captureText = canonicalBuySealCaptureText(validated);
  const captureFingerprint = await fingerprintBuySealCapture(validated);
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
  const thread = buyThread([
    briefArtifact(),
    writeGeometryPrimary(),
    cadAssetStep(),
    artifact,
  ]);
  return { capture: validated, captureText, captureFingerprint, artifact, thread };
}

async function persistBuyRegistrarState(
  root: string,
  fixture: Awaited<ReturnType<typeof createSealedBuyFixture>>,
): Promise<void> {
  const briefs = new ProjectBriefCommandService(
    new FileEngineeringProjectRevisionStore(
      `${root}/state/local/engineering-projects`,
    ),
    () => AT,
  );
  const seeded = await startApprovedBrief(briefs);
  const threadRef = {
    snapshotId: fixture.thread.id,
    revision: fixture.thread.revision,
    subjectId: SUBJECT_ID,
  };
  const overlayed = validateEngineeringProjectSnapshot({
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
        id: "buy.seal-configuration-cost",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [{
        snapshotId: fixture.thread.id,
        snapshotRevision: fixture.thread.revision,
        kind: "artifact",
        id: fixture.artifact.id,
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
          value: fixture.capture.bundleDigest,
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
        snapshotId: fixture.thread.id,
        snapshotRevision: fixture.thread.revision,
        kind: "artifact",
        id: fixture.artifact.id,
      }],
      resultSnapshot: threadRef,
    }],
  });
  const projectDirectory = `${root}/state/local/engineering-projects/${
    encodeURIComponent(seeded.project.id)
  }`;
  await Deno.writeTextFile(
    `${projectDirectory}/${String(overlayed.revision).padStart(10, "0")}.json`,
    `${JSON.stringify(overlayed)}\n`,
  );
  await new FileThreadSnapshotStore(`${root}/state/local/thread-snapshots`)
    .save(fixture.thread);
  const seals = new FileCaptureStore({
    ...BUY_SEAL_CAPTURE_DESCRIPTOR,
    directory: `${root}/${BUY_SEAL_CAPTURE_DESCRIPTOR.directory}`,
  });
  await seals.save(fixture.captureFingerprint, fixture.captureText);
}

async function writeBuyViewerPackageCatalog(
  root: string,
  options: { readonly omit?: boolean } = {},
): Promise<void> {
  const directory = `${root}/state/local/thread-viewer-apps`;
  const objects = `${directory}/objects`;
  await Deno.mkdir(objects, { recursive: true });
  if (options.omit) {
    await Deno.writeTextFile(
      `${directory}/packages.json`,
      JSON.stringify({
        schemaVersion: "thread-viewer-app-packages/1.0",
        packages: [],
      }),
    );
    return;
  }
  const store = new FileByteStore({
    kind: "thread-viewer-app-object",
    directory: objects,
    uriNamespace: "thread-viewer-apps",
    label: "test viewer bytes",
  });
  const manifestText = await Deno.readTextFile(
    new URL("../buy/fixtures/buy-view-app-manifest.json", import.meta.url),
  );
  const manifest = new TextEncoder().encode(
    manifestText.endsWith("\n") ? manifestText.slice(0, -1) : manifestText,
  );
  const html = new TextEncoder().encode(
    "<!doctype html><html><head></head><body></body></html>",
  );
  const manifestDigest = await sha256Hex(manifest);
  const htmlDigest = await sha256Hex(html);
  await store.save({ algorithm: "sha256", digest: manifestDigest }, manifest);
  await store.save({ algorithm: "sha256", digest: htmlDigest }, html);
  await Deno.writeTextFile(
    `${directory}/packages.json`,
    JSON.stringify({
      schemaVersion: "thread-viewer-app-packages/1.0",
      packages: [{
        app: { id: BUY_VIEWER_APP_ID, version: "3.1.0-local.buy-evidence.1" },
        manifest: {
          uri: "ui://mcp-erpnext/buy-evidence-manifest",
          fingerprint: `sha256:${manifestDigest}`,
        },
        resources: [{
          uri: BUY_VIEWER_RESOURCE_URI,
          fingerprint: `sha256:${htmlDigest}`,
        }],
      }],
    }),
  );
}

async function startApprovedBrief(briefs: ProjectBriefCommandService) {
  let project = await briefs.startProject(AGENT, {
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Buy registrar fixture",
    issuedAt: AT,
    intent: "Exercise Buy registrar.",
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
      statement: "Exercise Buy registrar.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "scenario",
      kind: "mission-scenario",
      statement: "Reopen sealed Buy evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Bind the provider whole-view.",
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

function buyThread(artifacts: ThreadArtifact[]): ThreadSnapshot {
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.buy.seal",
    revision: 1,
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
      id: "change-set.buy",
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
