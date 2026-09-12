/**
 * Isolated DFM whole-App fixture. Test-only; never a live package or store.
 */
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  DFM_CHECK_CASE_SCHEMA,
  validateDfmCheckCase,
} from "../../domain/make/dfm/dfm-case.ts";
import type {
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  DFM_CASE_CAPTURE_DESCRIPTOR,
  DFM_CHECK_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import {
  DFM_CASE_CAPTURE_SCHEMA,
  DFM_CASE_CAPTURE_URI_PREFIX,
  fingerprintDfmCaseCapture,
  validateDfmCaseCapture,
} from "../make/dfm/dfm-case-capture.ts";
import {
  DFM_CHECK_CAPTURE_SCHEMA,
  DFM_CHECK_CAPTURE_URI_PREFIX,
  evaluateCapturedDfmChecks,
  fingerprintDfmCheckCapture,
  parseDfmEnvelopeResult,
  parseDfmOverhangResult,
  parseDfmThicknessResult,
  persistZMinFilterTrace,
  validateDfmCheckCapture,
} from "../make/dfm/dfm-check-capture.ts";
import qualification from "../make/dfm/dfm-mcp-qualification.json" with {
  type: "json",
};
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";
import {
  DFM_VIEWER_APP_ID,
  DFM_VIEWER_RESOURCE_URI,
  DFM_VIEWER_SESSION_SCHEMA,
  type DfmCaptureReader,
} from "./dfm-viewer-binding.ts";

export const DFM_VIEWER_AT = "2026-08-15T00:00:00.000Z";
export const DFM_VIEWER_PROJECT_ID = "dfm-viewer";
export const DFM_VIEWER_RUN_ID = "run.dfm-checks";
export const DFM_VIEWER_WORK_ID = "work.dfm-checks";
export const DFM_VIEWER_DECISION_ID = "decision.dfm-checks";
export const DFM_VIEWER_APPROVAL_ID = "approval.dfm-checks";
export const DFM_VIEWER_STEP_SHA256 = qualification.expected_step_sha256;
export const DFM_VIEWER_PARENT_DIGEST =
  "b59023102670e06b4e33e534d05008c0fe2440ae91dafbaa9c256c92a4ebe3e8";
export const DFM_VIEWER_STAGED_PATH = `/exports/${DFM_VIEWER_STEP_SHA256}.step`;

const SUBJECT_ID = `project:${DFM_VIEWER_PROJECT_ID}`;
const STEP_ID =
  `cad-asset-${DFM_VIEWER_PARENT_DIGEST}-target-0-${DFM_VIEWER_STEP_SHA256}`;
const PARENT_ID = `geometry-${DFM_VIEWER_PARENT_DIGEST}`;

export interface DfmViewerFixture {
  readonly root: string;
  project: EngineeringProjectSnapshot;
  thread: ThreadSnapshot;
  resultThread: ThreadSnapshot;
  artifactId: string;
  capture: ReturnType<typeof validateDfmCheckCapture>;
  captureText: string;
  captureFingerprint: ContentFingerprint;
  caseText: string;
  caseFingerprint: ContentFingerprint;
  checks: { read: DfmCaptureReader["read"] };
  cases: { read: DfmCaptureReader["read"] };
  packages: InstalledThreadViewerAppPackage[];
}

export function dfmViewerPackages(
  overrides: Partial<InstalledThreadViewerAppPackage> = {},
): InstalledThreadViewerAppPackage[] {
  return [{
    app: { id: DFM_VIEWER_APP_ID, version: "0.3.0-local.viewer.1" },
    manifest: {
      uri: "ui://mcp-dfm/app-manifest",
      path: "/manifest.json",
      fingerprint: "sha256:unused",
    },
    resources: [{
      uri: DFM_VIEWER_RESOURCE_URI,
      path: "/results.html",
      fingerprint: "sha256:unused",
      resultSchemas: [],
      sessionSchemas: [DFM_VIEWER_SESSION_SCHEMA],
      acceptedActions: ["viewer.session.apply"],
    }],
    ...overrides,
  }];
}

export async function createDfmViewerFixture(): Promise<DfmViewerFixture> {
  const root = await Deno.makeTempDir({ prefix: "dfm-viewer-binding-" });
  const dfmCase = validateDfmCheckCase(caseJson());
  const caseDigest = (await sha256Fingerprint(dfmCase)).digest;
  const capture = validateDfmCheckCapture({
    ...validCheckCapture(),
    caseDigest,
  });
  const captureText = deterministicJson(capture);
  const captureFingerprint = await fingerprintDfmCheckCapture(capture);
  const caseCapture = await validateDfmCaseCapture({
    schemaVersion: DFM_CASE_CAPTURE_SCHEMA,
    operation: { id: "industrialize.seal-dfm-case", version: "1" },
    trustedRunId: "run.seal",
    caseDigest,
    canonicalCaseText: deterministicJson(dfmCase),
    dfmCase,
    sealedAt: DFM_VIEWER_AT,
  });
  const caseText = deterministicJson(caseCapture);
  const caseFingerprint = await fingerprintDfmCaseCapture(caseCapture);
  const caseArtifact = artifact({
    id: `dfm-case-${caseDigest}`,
    kind: "document",
    version: caseDigest,
    fingerprint: caseFingerprint,
    uri: `${DFM_CASE_CAPTURE_URI_PREFIX}${caseFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "industrialize.seal-dfm-case@1",
      runId: "run.seal",
    },
  });
  const stepArtifact = artifact({
    id: STEP_ID,
    kind: "step",
    fingerprint: {
      algorithm: "sha256",
      digest: DFM_VIEWER_STEP_SHA256,
    },
    uri: `/api/thread/assets/${DFM_VIEWER_STEP_SHA256}.step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "run.geometry",
    },
  });
  const parentArtifact = artifact({
    id: PARENT_ID,
    kind: "cad-model",
    fingerprint: {
      algorithm: "sha256",
      digest: DFM_VIEWER_PARENT_DIGEST,
    },
    uri: `casys://geometry-capture/sha256/${DFM_VIEWER_PARENT_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: "run.geometry",
    },
  });
  const briefArtifact = artifact({
    id: "artifact.brief",
    kind: "document",
    fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    producer: {
      serverId: "digital-thread",
      tool: "baseline.from-approved-brief@1",
      runId: "run.brief",
    },
  });
  const basis = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${SUBJECT_ID}:r1`,
    revision: 1,
    generatedAt: DFM_VIEWER_AT,
    subject: {
      id: SUBJECT_ID,
      name: "DFM viewer fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: briefArtifact.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.basis",
      name: "Sealed case and canonical STEP",
      status: "applied",
      createdAt: DFM_VIEWER_AT,
      appliedAt: DFM_VIEWER_AT,
      changes: [briefArtifact, caseArtifact, parentArtifact, stepArtifact].map(
        (item) => ({
          id: `created-${item.id}`,
          kind: "created" as const,
          target: { kind: "artifact" as const, id: item.id },
          summary: `Created ${item.id}.`,
          afterFingerprint: item.fingerprint,
        }),
      ),
    },
    artifacts: [briefArtifact, caseArtifact, parentArtifact, stepArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [briefArtifact, caseArtifact, parentArtifact, stepArtifact].map(
      (item) => ({
        id: `changes-${item.id}`,
        relation: "changes" as const,
        from: { kind: "change" as const, id: `created-${item.id}` },
        to: { kind: "artifact" as const, id: item.id },
        rationale: "The applied change introduced the artefact.",
      }),
    ),
    proposedActions: [],
  });
  const checkArtifact: ThreadArtifact = {
    id: `dfm-check-${captureFingerprint.digest}`,
    name: "Measured DFM checks",
    kind: "evidence",
    version: captureFingerprint.digest,
    fingerprint: captureFingerprint,
    uri: `${DFM_CHECK_CAPTURE_URI_PREFIX}${captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "industrialize.run-dfm-checks@1",
      runId: DFM_VIEWER_RUN_ID,
    },
    inputArtifactIds: [caseArtifact.id, stepArtifact.id],
    freshness: fresh(),
  };
  const producer = checkArtifact.producer;
  const result = applyThreadSnapshotExtensionIfNew(basis, {
    id: `industrialize-run-dfm-checks-${DFM_VIEWER_RUN_ID}`,
    name: "Run measured DFM checks",
    subjectId: SUBJECT_ID,
    capturedAt: DFM_VIEWER_AT,
    artifacts: [checkArtifact],
    consumptions: [{
      id: `consume-${caseArtifact.id}-by-${checkArtifact.id}`,
      artifactId: caseArtifact.id,
      consumer: producer,
      observedFingerprint: caseArtifact.fingerprint,
      verifiedAt: DFM_VIEWER_AT,
      status: "verified",
    }, {
      id: `consume-${stepArtifact.id}-by-${checkArtifact.id}`,
      artifactId: stepArtifact.id,
      consumer: producer,
      observedFingerprint: stepArtifact.fingerprint,
      verifiedAt: DFM_VIEWER_AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `derived-from-case-${checkArtifact.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: checkArtifact.id },
      to: { kind: "artifact", id: caseArtifact.id },
      rationale: "The measured DFM run reopens the sealed case.",
    }, {
      id: `derived-from-geometry-${checkArtifact.id}`,
      relation: "derived_from",
      from: { kind: "artifact", id: checkArtifact.id },
      to: { kind: "artifact", id: stepArtifact.id },
      rationale: "The measured DFM run stages the exact canonical STEP.",
    }, {
      id: `uses-case-${checkArtifact.id}`,
      relation: "uses",
      from: {
        kind: "consumption",
        id: `consume-${caseArtifact.id}-by-${checkArtifact.id}`,
      },
      to: { kind: "artifact", id: caseArtifact.id },
      rationale: "The executor re-read the sealed DFM case capture.",
    }, {
      id: `uses-geometry-${checkArtifact.id}`,
      relation: "uses",
      from: {
        kind: "consumption",
        id: `consume-${stepArtifact.id}-by-${checkArtifact.id}`,
      },
      to: { kind: "artifact", id: stepArtifact.id },
      rationale: "The executor staged the exact canonical STEP bytes.",
    }],
    proposedActions: [],
  }).snapshot;
  const laterNote = artifact({
    id: "artifact.later-note",
    kind: "document",
    fingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
    producer: {
      serverId: "digital-thread",
      tool: "project.review-note@1",
      runId: "run.later",
    },
  });
  const display = applyThreadSnapshotExtensionIfNew(result, {
    id: "later-head-note",
    name: "Later Thread head",
    subjectId: SUBJECT_ID,
    capturedAt: DFM_VIEWER_AT,
    artifacts: [laterNote],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }).snapshot;
  const seeded = await seedProject(root, display.id, SUBJECT_ID);
  const threadRef = (
    snapshot: ThreadSnapshot,
  ) => ({
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: SUBJECT_ID,
  });
  const operation = {
    id: "industrialize.run-dfm-checks",
    version: "1",
    bindings: [
      {
        name: "dfmCase",
        source: {
          kind: "thread-entity" as const,
          reference: {
            snapshotId: basis.id,
            snapshotRevision: basis.revision,
            kind: "artifact" as const,
            id: caseArtifact.id,
          },
        },
      },
      {
        name: "geometry",
        source: {
          kind: "thread-entity" as const,
          reference: {
            snapshotId: basis.id,
            snapshotRevision: basis.revision,
            kind: "artifact" as const,
            id: stepArtifact.id,
          },
        },
      },
    ],
  };
  const project = validateEngineeringProjectSnapshot({
    ...seeded,
    threadSnapshots: [threadRef(basis), threadRef(result), threadRef(display)],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Run measured DFM checks.",
      workItemIds: [DFM_VIEWER_WORK_ID],
      requiredDecisionIds: [DFM_VIEWER_DECISION_ID],
      evidenceRefs: [],
    }],
    workItems: [{
      id: DFM_VIEWER_WORK_ID,
      activityId: `activity:${DFM_VIEWER_WORK_ID}`,
      phaseId: "phase.industrialize",
      title: "Run DFM checks",
      description: "Run the sealed case.",
      kind: "industrialize",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [DFM_VIEWER_DECISION_ID],
      blockerIds: [],
    }],
    decisions: [dfmRunDecision(threadRef(basis), caseDigest)],
    approvals: [dfmRunApproval(threadRef(basis), caseDigest)],
    agentRuns: [{
      id: DFM_VIEWER_RUN_ID,
      workItemId: DFM_VIEWER_WORK_ID,
      status: "completed",
      summary: "Published measured DFM checks.",
      queuedAt: DFM_VIEWER_AT,
      startedAt: DFM_VIEWER_AT,
      completedAt: DFM_VIEWER_AT,
      basis: { kind: "thread-snapshot", ...threadRef(basis) },
      inputFingerprint: {
        algorithm: "sha256",
        digest: "a".repeat(64),
      },
      evidenceRefs: [{
        snapshotId: result.id,
        snapshotRevision: result.revision,
        kind: "artifact",
        id: checkArtifact.id,
      }],
      resultSnapshot: threadRef(result),
    }],
  });
  return {
    root,
    project,
    thread: display,
    resultThread: result,
    artifactId: checkArtifact.id,
    capture,
    captureText,
    captureFingerprint,
    caseText,
    caseFingerprint,
    checks: {
      read: (fingerprint) =>
        Promise.resolve(
          fingerprint.digest === captureFingerprint.digest ? captureText : undefined,
        ),
    },
    cases: {
      read: (fingerprint) =>
        Promise.resolve(
          fingerprint.digest === caseFingerprint.digest ? caseText : undefined,
        ),
    },
    packages: dfmViewerPackages(),
  };
}

export async function persistDfmViewerRegistrarState(
  root: string,
  fixture: DfmViewerFixture,
): Promise<void> {
  const briefs = new ProjectBriefCommandService(
    new FileEngineeringProjectRevisionStore(
      `${root}/state/local/engineering-projects`,
    ),
    () => DFM_VIEWER_AT,
  );
  const seeded = await startApprovedBrief(briefs, DFM_VIEWER_PROJECT_ID);
  const overlayed = validateEngineeringProjectSnapshot({
    ...seeded,
    threadSnapshots: fixture.project.threadSnapshots,
    phases: fixture.project.phases,
    workItems: fixture.project.workItems,
    agentRuns: fixture.project.agentRuns,
    decisions: fixture.project.decisions,
    approvals: fixture.project.approvals,
  });
  const projectDirectory = `${root}/state/local/engineering-projects/${
    encodeURIComponent(seeded.project.id)
  }`;
  await Deno.writeTextFile(
    `${projectDirectory}/${String(overlayed.revision).padStart(10, "0")}.json`,
    `${deterministicJson(overlayed)}\n`,
  );
  await new FileThreadSnapshotStore(`${root}/state/local/thread-snapshots`)
    .save(fixture.thread);
  const checks = new FileCaptureStore({
    ...DFM_CHECK_CAPTURE_DESCRIPTOR,
    directory: `${root}/${DFM_CHECK_CAPTURE_DESCRIPTOR.directory}`,
  });
  const cases = new FileCaptureStore({
    ...DFM_CASE_CAPTURE_DESCRIPTOR,
    directory: `${root}/${DFM_CASE_CAPTURE_DESCRIPTOR.directory}`,
  });
  await checks.save(fixture.captureFingerprint, fixture.captureText);
  await cases.save(fixture.caseFingerprint, fixture.caseText);
}

export async function writeDfmViewerPackageCatalog(
  root: string,
  options: { readonly omit?: boolean; readonly duplicate?: boolean } = {},
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
  const manifest = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "io.casys.mcp.view-app-manifest/1.0",
    app: {
      id: DFM_VIEWER_APP_ID,
      title: "DFM Measured Checks",
      version: "0.3.0-local.viewer.1",
    },
    resources: [{
      uri: DFM_VIEWER_RESOURCE_URI,
      ownership: "whole-view",
      resultSchemas: ["io.casys.mcp-dfm.recorded-checks/1.0"],
      acceptedActions: ["viewer.session.apply"],
      sessionSchemas: [DFM_VIEWER_SESSION_SCHEMA],
    }],
  }));
  const html = new TextEncoder().encode(
    "<!doctype html><html><head></head><body></body></html>",
  );
  const manifestDigest = await sha256Hex(manifest);
  const htmlDigest = await sha256Hex(html);
  await store.save({ algorithm: "sha256", digest: manifestDigest }, manifest);
  await store.save({ algorithm: "sha256", digest: htmlDigest }, html);
  const declared = {
    app: { id: DFM_VIEWER_APP_ID, version: "0.3.0-local.viewer.1" },
    manifest: {
      uri: "ui://mcp-dfm/app-manifest",
      fingerprint: `sha256:${manifestDigest}`,
    },
    resources: [{
      uri: DFM_VIEWER_RESOURCE_URI,
      fingerprint: `sha256:${htmlDigest}`,
    }],
  };
  await Deno.writeTextFile(
    `${directory}/packages.json`,
    JSON.stringify({
      schemaVersion: "thread-viewer-app-packages/1.0",
      packages: options.duplicate ? [declared, declared] : [declared],
    }),
  );
}

export function archiveArtifact(
  thread: ThreadSnapshot,
  artifactId: string,
): ThreadSnapshot {
  return {
    ...thread,
    changeSet: {
      ...thread.changeSet,
      changes: [...thread.changeSet.changes, {
        id: `archive-${artifactId}`,
        kind: "archived",
        target: { kind: "artifact", id: artifactId },
        summary: "Fixture archives dependent viewer evidence.",
      }],
    },
  };
}

export function staleArtifact(
  thread: ThreadSnapshot,
  artifactId: string,
): ThreadSnapshot {
  return {
    ...thread,
    freshness: {
      status: "stale",
      reason: "fixture-stale",
      changedAt: thread.freshness.changedAt,
      invalidatedByChangeIds: [],
    },
    artifacts: thread.artifacts.map((item) =>
      item.id === artifactId
        ? {
          ...item,
          freshness: {
            status: "stale" as const,
            reason: "fixture-stale",
            changedAt: item.freshness.changedAt,
            invalidatedByChangeIds: [],
          },
        }
        : item
    ),
  };
}

function validCheckCapture() {
  const envelope = parseDfmEnvelopeResult(
    qualification.dfm_check_envelope,
    DFM_VIEWER_STEP_SHA256,
    { x: 250, y: 210, z: 200 },
  );
  const thickness = parseDfmThicknessResult(
    qualification.dfm_check_min_thickness,
    DFM_VIEWER_STEP_SHA256,
    2,
  );
  const overhang = parseDfmOverhangResult(
    qualification.dfm_check_overhangs,
    DFM_VIEWER_STEP_SHA256,
    45,
    [0, 0, 1],
  );
  const zMinFilter = {
    enabled: true,
    planeZMm: { value: -3, unit: "mm" as const },
    toleranceMm: { value: 0.1, unit: "mm" as const },
  };
  const recomputed = evaluateCapturedDfmChecks({
    zMinFilter,
    buildVolumeMm: { x: 250, y: 210, z: 200 },
    minThicknessMm: 2,
    envelope,
    thickness,
    overhang,
  });
  return {
    schemaVersion: DFM_CHECK_CAPTURE_SCHEMA,
    operation: { id: "industrialize.run-dfm-checks", version: "1" },
    trustedRunId: DFM_VIEWER_RUN_ID,
    dispatchedAt: DFM_VIEWER_AT,
    capturedAt: DFM_VIEWER_AT,
    caseDigest: "",
    geometry: {
      artifactId: STEP_ID,
      sha256: DFM_VIEWER_STEP_SHA256,
      byteCount: 86130,
      mediaType: "model/step",
      stagedPath: DFM_VIEWER_STAGED_PATH,
    },
    providerCallParams: {
      expectedStepSha256: DFM_VIEWER_STEP_SHA256,
      buildVolumeMm: { x: 250, y: 210, z: 200 },
      minThicknessMm: 2,
      maxOverhangDeg: 45,
      meshSizeMm: 2,
      buildDirection: [0, 0, 1] as const,
    },
    zMinFilter: persistZMinFilterTrace(recomputed.zMinTrace),
    envelope: {
      tool: "dfm_check_envelope",
      measured: envelope.measured,
      violations: envelope.violations,
      notChecked: envelope.notChecked,
      inputArtifactSha256: envelope.inputArtifactSha256,
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: thickness.measured,
      violations: thickness.violations,
      notChecked: thickness.notChecked,
      inputArtifactSha256: thickness.inputArtifactSha256,
    },
    overhang: {
      tool: "dfm_check_overhangs",
      measured: overhang.measured,
      violations: overhang.violations,
      notChecked: overhang.notChecked,
      inputArtifactSha256: overhang.inputArtifactSha256,
    },
    evaluations: recomputed.evaluations,
    limitations: ["The live mcp-dfm tools analyse STEP, not STL."],
  };
}

function caseJson() {
  return {
    schemaVersion: DFM_CHECK_CASE_SCHEMA,
    id: "reviewed-dfm-v1",
    revision: 1,
    scope: "Measured DFM checks for the isolated component.",
    evidenceBoundary: "Measured verdicts against the sealed case.",
    project: { id: DFM_VIEWER_PROJECT_ID, subjectId: SUBJECT_ID },
    target: {
      componentKey: "support-bracket",
      artifactUri: `thread-artifact://${DFM_VIEWER_PROJECT_ID}/${STEP_ID}`,
      sha256: DFM_VIEWER_STEP_SHA256,
      mediaType: "model/step",
    },
    buildVolumeMm: {
      x: { value: 250, unit: "mm" },
      y: { value: 210, unit: "mm" },
      z: { value: 200, unit: "mm" },
    },
    minThicknessMm: { value: 2, unit: "mm" },
    maxOverhangAngleDeg: { value: 45, unit: "deg" },
    meshSizeMm: { value: 2, unit: "mm" },
    buildDirection: [0, 0, 1],
    zMinFilter: {
      enabled: true,
      planeZMm: { value: -3, unit: "mm" },
      toleranceMm: { value: 0.1, unit: "mm" },
    },
    provider: {
      envelopeTool: "dfm_check_envelope",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: ["The live mcp-dfm tools analyse STEP, not STL."],
    provenance: {
      status: "provisional",
      note: "Limits copied from the archived mcp-dfm qualification call.",
    },
  };
}

export function dfmRunDecision(
  baseSnapshot: EngineeringThreadSnapshotRef,
  caseDigest: string,
  ids: { readonly decisionId?: string; readonly approvalId?: string } = {},
): EngineeringDecision {
  const decisionId = ids.decisionId ?? DFM_VIEWER_DECISION_ID;
  const approvalId = ids.approvalId ?? DFM_VIEWER_APPROVAL_ID;
  return {
    id: decisionId,
    phaseId: "phase.industrialize",
    title: "Approve DFM run",
    question: "Run the sealed DFM case?",
    status: "approved",
    requestedAt: DFM_VIEWER_AT,
    baseSnapshot,
    inputFingerprint: {
      algorithm: "sha256",
      digest: "b".repeat(64),
    },
    inputEvidenceRefs: [],
    approvalIds: [approvalId],
    proposal: {
      summary: "Run measured DFM checks",
      parameters: [{
        key: "dfm.run.caseDigest",
        label: "Case digest",
        value: caseDigest,
      }],
      proposedAt: DFM_VIEWER_AT,
      proposedBy: { id: "agent:test", origin: "agent" },
    },
  };
}

export function dfmRunApproval(
  baseSnapshot: EngineeringThreadSnapshotRef,
  _caseDigest: string,
  ids: { readonly decisionId?: string; readonly approvalId?: string } = {},
): EngineeringApproval {
  return {
    id: ids.approvalId ?? DFM_VIEWER_APPROVAL_ID,
    decisionId: ids.decisionId ?? DFM_VIEWER_DECISION_ID,
    status: "approved",
    requestedAt: DFM_VIEWER_AT,
    decidedAt: DFM_VIEWER_AT,
    decidedBy: "human:test",
    decidedByOrigin: "human",
    rationale: "Reviewed the bindings.",
    baseSnapshot,
    inputFingerprint: {
      algorithm: "sha256",
      digest: "b".repeat(64),
    },
    inputEvidenceRefs: [],
  };
}

async function seedProject(
  root: string,
  snapshotId: string,
  subjectId: string,
): Promise<EngineeringProjectSnapshot> {
  const briefs = new ProjectBriefCommandService(
    new FileEngineeringProjectRevisionStore(root),
    () => DFM_VIEWER_AT,
  );
  return await startApprovedBrief(briefs, DFM_VIEWER_PROJECT_ID, snapshotId, subjectId);
}

async function startApprovedBrief(
  briefs: ProjectBriefCommandService,
  projectId: string,
  snapshotId?: string,
  subjectId?: string,
): Promise<EngineeringProjectSnapshot> {
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await briefs.startProject(agent, {
    commandId: "start",
    projectId,
    projectName: "DFM viewer fixture",
    issuedAt: DFM_VIEWER_AT,
    intent: "Exercise recorded DFM evidence.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(agent, {
    commandId: "brief",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: DFM_VIEWER_AT,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Exercise viewer.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "scenario",
      kind: "mission-scenario",
      statement: "Reopen recorded DFM evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Preserve the exact measured checks.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(human, {
    commandId: "approve",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: DFM_VIEWER_AT,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "fixture",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  if (!snapshotId || !subjectId) return project;
  return { ...project, threadSnapshots: [{ snapshotId, revision: 1, subjectId }] };
}

function artifact(
  value:
    & Omit<ThreadArtifact, "name" | "version" | "inputArtifactIds" | "freshness">
    & Partial<
      Pick<ThreadArtifact, "inputArtifactIds" | "uri" | "mediaType" | "version">
    >,
): ThreadArtifact {
  return {
    name: String(value.id),
    version: value.fingerprint.digest,
    inputArtifactIds: [],
    freshness: fresh(),
    ...value,
  };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: DFM_VIEWER_AT,
    invalidatedByChangeIds: [],
  };
}
