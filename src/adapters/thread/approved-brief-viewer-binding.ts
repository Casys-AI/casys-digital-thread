import { parseViewAppManifestJson } from "@casys/mcp-view-contracts";
import {
  PROJECT_RECORDS_APP_ID,
  PROJECT_RECORDS_APP_VERSION,
  PROJECT_RECORDS_DOCUMENT_KIND,
  PROJECT_RECORDS_DOCUMENT_SCOPE,
  PROJECT_RECORDS_MANIFEST_URI,
  PROJECT_RECORDS_SESSION_KIND,
  PROJECT_RECORDS_SESSION_SCHEMA,
  PROJECT_RECORDS_WHOLE_VIEW_URI,
  VIEWER_SESSION_APPLY_ACTION,
} from "../../apps/project-records/identity.ts";
import { exactRecord } from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { APPROVED_BRIEF_BASELINE_OPERATION } from "../../domain/compile/brief/approved-brief-baseline.ts";
import { APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA } from "../../orchestration/operations/approved-brief-baseline.ts";
import type {
  EngineeringAgentRun,
  EngineeringApprovedBriefBasis,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";

export const APPROVED_BRIEF_VIEWER_PRODUCER_SERVER = "casys-digital-thread";
export const APPROVED_BRIEF_VIEWER_PRODUCER_TOOL = "baseline_from_approved_brief";

export interface ApprovedBriefCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface ApprovedBriefViewerAppSources {
  readonly manifestPath: string;
  readonly htmlPath: string;
  readonly capturePath: string;
}

export interface ApprovedBriefViewerBindingRequest {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly artifactId: string;
  readonly captures: ApprovedBriefCaptureReader;
  readonly sources: ApprovedBriefViewerAppSources;
}

export interface ApprovedBriefViewerSessionPayload {
  readonly schemaVersion: typeof PROJECT_RECORDS_SESSION_SCHEMA;
  readonly kind: typeof PROJECT_RECORDS_SESSION_KIND;
  readonly fingerprint: `sha256:${string}`;
  readonly artifactId: string;
  readonly runId: string;
  readonly workItemId: string;
  readonly projectId: string;
  readonly subjectId: string;
  readonly briefId: string;
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
}

/**
 * Catalogue entry shape consumed by
 * `scripts/runners/materialize-thread-viewer-apps.ts`. It has no `launchUri`.
 */
export interface ThreadViewerAppMaterializationCatalogBinding {
  readonly basis: {
    readonly projectId: string;
    readonly projectRevision: number;
    readonly subjectId: string;
    readonly thread: {
      readonly id: string;
      readonly revision: number;
    };
  };
  readonly anchor: {
    readonly kind: "artifact";
    readonly id: string;
  };
  readonly app: {
    readonly id: typeof PROJECT_RECORDS_APP_ID;
    readonly version: typeof PROJECT_RECORDS_APP_VERSION;
  };
  readonly manifest: {
    readonly uri: typeof PROJECT_RECORDS_MANIFEST_URI;
    readonly path: string;
  };
  readonly resource: {
    readonly uri: typeof PROJECT_RECORDS_WHOLE_VIEW_URI;
    readonly path: string;
  };
  readonly readResources: readonly [{
    readonly path: string;
    readonly mimeType: "application/json";
  }];
  readonly session: {
    readonly schema: typeof PROJECT_RECORDS_SESSION_SCHEMA;
    readonly payload: ApprovedBriefViewerSessionPayload;
  };
}

export class ApprovedBriefViewerBindingError extends Error {
  constructor(
    readonly code:
      | "absent_capture"
      | "corrupt_capture"
      | "schema_mismatch"
      | "provenance_mismatch"
      | "absent_anchor"
      | "invalid_input",
    message: string,
  ) {
    super(message);
    this.name = "ApprovedBriefViewerBindingError";
  }
}

export async function buildApprovedBriefViewerBinding(
  request: ApprovedBriefViewerBindingRequest,
): Promise<ThreadViewerAppMaterializationCatalogBinding> {
  const project = validatedProject(request.project);
  const thread = validatedThread(request.thread);
  const artifactId = requiredId(request.artifactId, "artifactId");
  assertCurrentAnchor(project, thread, artifactId);
  const artifact = thread.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) {
    fail(
      "absent_anchor",
      "Current Thread does not include the named artifact.",
    );
  }
  assertDocumentaryArtifact(artifact, artifactId);
  const run = uniqueCompletedBaselineRun(project, artifactId);
  const workItem = uniqueBaselineWorkItem(project, run);
  const captureText = await request.captures.read(artifact.fingerprint);
  if (captureText === undefined) {
    fail(
      "absent_capture",
      `Approved-brief documentary capture ${artifact.fingerprint.digest} is not readable.`,
    );
  }
  const capture = await parseCanonicalCapture(
    captureText,
    artifact.fingerprint,
  );
  assertCaptureMatchesCurrent(
    capture,
    project,
    thread,
    artifact,
    run,
    workItem,
  );
  await assertAppSources(request.sources);
  const resourceText = await readExistingFile(
    request.sources.capturePath,
    "documentary capture",
  );
  if (resourceText !== captureText) {
    fail(
      "corrupt_capture",
      "Viewer source does not contain the exact canonical capture bytes.",
    );
  }
  const digest = artifact.fingerprint.digest;
  const brief = record(capture.approvedBrief, "capture.approvedBrief");
  return {
    basis: {
      projectId: project.project.id,
      projectRevision: project.revision,
      subjectId: project.project.subjectId,
      thread: { id: thread.id, revision: thread.revision },
    },
    anchor: { kind: "artifact", id: artifactId },
    app: {
      id: PROJECT_RECORDS_APP_ID,
      version: PROJECT_RECORDS_APP_VERSION,
    },
    manifest: {
      uri: PROJECT_RECORDS_MANIFEST_URI,
      path: request.sources.manifestPath,
    },
    resource: {
      uri: PROJECT_RECORDS_WHOLE_VIEW_URI,
      path: request.sources.htmlPath,
    },
    readResources: [{
      path: request.sources.capturePath,
      mimeType: "application/json",
    }],
    session: {
      schema: PROJECT_RECORDS_SESSION_SCHEMA,
      payload: {
        schemaVersion: PROJECT_RECORDS_SESSION_SCHEMA,
        kind: PROJECT_RECORDS_SESSION_KIND,
        fingerprint: `sha256:${digest}`,
        artifactId,
        runId: run.id,
        workItemId: workItem.id,
        projectId: project.project.id,
        subjectId: project.project.subjectId,
        briefId: stringField(brief, "briefId", "approvedBrief"),
        briefSnapshotId: stringField(brief, "id", "approvedBrief"),
        briefRevision: integerField(brief, "revision", "approvedBrief"),
      },
    },
  };
}

function validatedProject(
  value: EngineeringProjectSnapshot,
): EngineeringProjectSnapshot {
  try {
    return validateEngineeringProjectSnapshot(value);
  } catch (error) {
    fail(
      "invalid_input",
      `Current project snapshot is invalid: ${errorMessage(error)}`,
    );
  }
}

function validatedThread(value: ThreadSnapshot): ThreadSnapshot {
  try {
    return validateThreadSnapshot(value);
  } catch (error) {
    fail(
      "invalid_input",
      `Current Thread snapshot is invalid: ${errorMessage(error)}`,
    );
  }
}

function assertCurrentAnchor(
  project: EngineeringProjectSnapshot,
  thread: ThreadSnapshot,
  artifactId: string,
): void {
  if (project.project.id.length === 0) {
    fail("invalid_input", "Current project identity is missing.");
  }
  if (thread.subject.id !== project.project.subjectId) {
    fail(
      "provenance_mismatch",
      "Current project subject does not match the current Thread subject.",
    );
  }
  const currentRef = project.threadSnapshots.find((reference) =>
    reference.snapshotId === thread.id &&
    reference.revision === thread.revision &&
    reference.subjectId === thread.subject.id &&
    reference.revision ===
      Math.max(...project.threadSnapshots.map((ref) => ref.revision))
  );
  if (!currentRef) {
    fail(
      "absent_anchor",
      "Current project does not name the supplied Thread snapshot.",
    );
  }
  if (
    archivedRefKeys(thread).has(`artifact:${artifactId}`) ||
    !thread.artifacts.some((artifact) => artifact.id === artifactId)
  ) {
    fail(
      "absent_anchor",
      "Current Thread does not include the named approved-brief artifact.",
    );
  }
}

function assertDocumentaryArtifact(
  artifact: ThreadArtifact,
  artifactId: string,
): void {
  const digest = artifact.fingerprint.digest;
  const expectedId = `approved-brief-document-${digest}`;
  if (
    artifact.id !== artifactId || artifact.id !== expectedId ||
    artifact.kind !== "document" || artifact.version !== digest ||
    artifact.uri !== `casys://approved-brief-capture/sha256/${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== APPROVED_BRIEF_VIEWER_PRODUCER_SERVER ||
    artifact.producer.tool !== APPROVED_BRIEF_VIEWER_PRODUCER_TOOL
  ) {
    fail(
      "provenance_mismatch",
      "Named artifact is not the Digital Thread approved-brief documentary document.",
    );
  }
}

function uniqueCompletedBaselineRun(
  project: EngineeringProjectSnapshot,
  artifactId: string,
): EngineeringAgentRun {
  const candidates = project.agentRuns.filter((run) =>
    run.status === "completed" &&
    run.basis?.kind === "approved-brief" &&
    run.evidenceRefs.some((reference) =>
      reference.kind === "artifact" && reference.id === artifactId
    )
  );
  if (candidates.length !== 1 || !candidates[0].basis) {
    fail(
      "provenance_mismatch",
      "Current project has no unique completed approved-brief baseline run for this artifact.",
    );
  }
  return candidates[0];
}

function uniqueBaselineWorkItem(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (
    !workItem?.operation ||
    workItem.operation.id !== APPROVED_BRIEF_BASELINE_OPERATION.id ||
    workItem.operation.version !== APPROVED_BRIEF_BASELINE_OPERATION.version
  ) {
    fail(
      "provenance_mismatch",
      "Completed baseline run is not bound to baseline.from-approved-brief@1.",
    );
  }
  return workItem;
}

async function parseCanonicalCapture(
  text: string,
  fingerprint: ContentFingerprint,
): Promise<Record<string, unknown>> {
  let capture: unknown;
  try {
    capture = JSON.parse(text);
  } catch {
    fail(
      "corrupt_capture",
      "Approved-brief documentary capture is not valid JSON.",
    );
  }
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    fail(
      "corrupt_capture",
      "Approved-brief documentary capture must be an object.",
    );
  }
  const document = capture as Record<string, unknown>;
  if (deterministicJson(document) !== text) {
    fail(
      "corrupt_capture",
      "Approved-brief documentary capture is not stored as its canonical deterministic JSON bytes.",
    );
  }
  const computed = await sha256Fingerprint(document);
  if (!fingerprintsEqual(computed, fingerprint)) {
    fail(
      "corrupt_capture",
      "Approved-brief documentary capture does not match the documentary artifact fingerprint.",
    );
  }
  if (document.schemaVersion !== APPROVED_BRIEF_BASELINE_CAPTURE_SCHEMA) {
    fail(
      "schema_mismatch",
      "Approved-brief documentary capture schema is not approved-brief-baseline-capture/1.1.",
    );
  }
  if (
    document.kind !== PROJECT_RECORDS_DOCUMENT_KIND ||
    document.scope !== PROJECT_RECORDS_DOCUMENT_SCOPE
  ) {
    fail(
      "schema_mismatch",
      "Capture is not the approved-brief pre-technical documentary baseline.",
    );
  }
  try {
    exactRecord(
      document,
      [
        "schemaVersion",
        "kind",
        "scope",
        "statement",
        "runId",
        "capturedAt",
        "operation",
        "workItemId",
        "projectDefinition",
        "approvedBrief",
        "briefSourceAnalysis",
      ],
      "capture",
    );
  } catch (error) {
    fail(
      "schema_mismatch",
      `Approved-brief capture shape is invalid: ${errorMessage(error)}`,
    );
  }
  return document;
}

function assertCaptureMatchesCurrent(
  capture: Record<string, unknown>,
  project: EngineeringProjectSnapshot,
  thread: ThreadSnapshot,
  artifact: ThreadArtifact,
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem,
): void {
  const basis = run.basis as EngineeringApprovedBriefBasis;
  const captureOperation = record(capture.operation, "capture.operation");
  const definition = record(
    capture.projectDefinition,
    "capture.projectDefinition",
  );
  const identity = record(
    definition.identity,
    "capture.projectDefinition.identity",
  );
  const capturedBasis = record(
    definition.basis,
    "capture.projectDefinition.basis",
  );
  const plan = record(definition.plan, "capture.projectDefinition.plan");
  const planBasis = record(plan.basis, "capture.projectDefinition.plan.basis");
  const capturedWorkItem = record(
    definition.workItem,
    "capture.projectDefinition.workItem",
  );
  const workItemOperation = record(
    capturedWorkItem.operation,
    "capture.projectDefinition.workItem.operation",
  );
  const brief = record(capture.approvedBrief, "capture.approvedBrief");
  const analysis = record(
    capture.briefSourceAnalysis,
    "capture.briefSourceAnalysis",
  );
  if (
    capture.runId !== run.id || artifact.producer.runId !== run.id ||
    capture.workItemId !== workItem.id ||
    capturedWorkItem.id !== workItem.id ||
    captureOperation.id !== APPROVED_BRIEF_BASELINE_OPERATION.id ||
    captureOperation.version !== APPROVED_BRIEF_BASELINE_OPERATION.version ||
    workItemOperation.id !== workItem.operation!.id ||
    workItemOperation.version !== workItem.operation!.version
  ) {
    fail(
      "provenance_mismatch",
      "Capture does not retain the exact completed baseline operation and run.",
    );
  }
  if (
    identity.id !== project.project.id ||
    identity.subjectId !== project.project.subjectId ||
    identity.subjectId !== thread.subject.id
  ) {
    fail(
      "provenance_mismatch",
      "Capture does not retain the exact current project and subject identity.",
    );
  }
  if (
    brief.briefId !== basis.briefId || brief.id !== basis.briefSnapshotId ||
    brief.revision !== basis.briefRevision ||
    analysis.briefId !== brief.briefId ||
    analysis.briefSnapshotId !== brief.id ||
    analysis.briefRevision !== brief.revision
  ) {
    fail(
      "provenance_mismatch",
      "Capture does not retain the exact historic approved brief named by the completed run basis.",
    );
  }
  assertApprovedBriefBasisRecord(
    capturedBasis,
    basis,
    "capture.projectDefinition.basis",
  );
  assertApprovedBriefBasisRecord(
    planBasis,
    basis,
    "capture.projectDefinition.plan.basis",
  );
}

function assertApprovedBriefBasisRecord(
  value: Record<string, unknown>,
  basis: EngineeringApprovedBriefBasis,
  label: string,
): void {
  if (
    value.kind !== "approved-brief" || value.projectId !== basis.projectId ||
    value.projectSnapshotId !== basis.projectSnapshotId ||
    value.projectRevision !== basis.projectRevision ||
    value.briefId !== basis.briefId ||
    value.briefSnapshotId !== basis.briefSnapshotId ||
    value.briefRevision !== basis.briefRevision ||
    !fingerprintMatches(
      value.approvedBriefFingerprint,
      basis.approvedBriefFingerprint,
    )
  ) {
    fail(
      "provenance_mismatch",
      `${label} does not exactly match the completed run approved-brief basis.`,
    );
  }
}

async function assertAppSources(
  sources: ApprovedBriefViewerAppSources,
): Promise<void> {
  const manifestText = await readExistingFile(sources.manifestPath, "manifest");
  let manifest;
  try {
    manifest = parseViewAppManifestJson(manifestText);
  } catch (error) {
    fail(
      "invalid_input",
      `Project-records manifest is invalid: ${errorMessage(error)}`,
    );
  }
  if (
    manifest.app.id !== PROJECT_RECORDS_APP_ID ||
    manifest.app.version !== PROJECT_RECORDS_APP_VERSION
  ) {
    fail(
      "invalid_input",
      "Manifest does not declare io.casys.digital-thread.project-records@0.1.0.",
    );
  }
  const resource = manifest.resources.find((candidate) =>
    candidate.uri === PROJECT_RECORDS_WHOLE_VIEW_URI
  );
  if (
    resource?.ownership !== "whole-view" ||
    resource.acceptedActions?.includes(VIEWER_SESSION_APPLY_ACTION) !== true ||
    resource.sessionSchemas?.includes(PROJECT_RECORDS_SESSION_SCHEMA) !== true
  ) {
    fail(
      "invalid_input",
      "Manifest does not admit the project-records whole-view session.",
    );
  }
  const html = await readExistingFile(sources.htmlPath, "whole-view HTML");
  if (!html.startsWith("<!doctype html>")) {
    fail("invalid_input", "Whole-view HTML must start with <!doctype html>.");
  }
  if (
    html.includes("<script src") || html.includes("importmap") ||
    html.includes("modulepreload")
  ) {
    fail(
      "invalid_input",
      "Whole-view HTML must not declare external scripts, import maps or preloads.",
    );
  }
}

async function readExistingFile(path: string, label: string): Promise<string> {
  if (path.length === 0 || path !== path.trim() || path.includes("\0")) {
    fail("invalid_input", `${label} path must be an explicit bounded path.`);
  }
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) {
      fail("invalid_input", `${label} path must be a regular file.`);
    }
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof ApprovedBriefViewerBindingError) throw error;
    fail("invalid_input", `${label} is not readable at ${path}.`);
  }
}

function fingerprintMatches(
  value: unknown,
  expected: ContentFingerprint,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fingerprint = value as Partial<ContentFingerprint>;
  return fingerprintsEqual(
    fingerprint.algorithm === "sha256" && typeof fingerprint.digest === "string"
      ? { algorithm: fingerprint.algorithm, digest: fingerprint.digest }
      : undefined,
    expected,
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("schema_mismatch", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    fail("schema_mismatch", `${label}.${key} must be a non-empty string.`);
  }
  return field;
}

function integerField(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const field = value[key];
  if (!Number.isSafeInteger(field) || (field as number) < 1) {
    fail("schema_mismatch", `${label}.${key} must be a positive integer.`);
  }
  return field as number;
}

function requiredId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    fail("invalid_input", `${label} must be a stable identifier.`);
  }
  return value;
}

function fail(
  code: ApprovedBriefViewerBindingError["code"],
  message: string,
): never {
  throw new ApprovedBriefViewerBindingError(code, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
