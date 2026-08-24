/**
 * Opaque technical-source capture locator and exact project-source anchor.
 *
 * The locator is the only public replay handle. The full capture document
 * never crosses the MCP surface. `fileId` is the technical source id.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { AgentResourceReference } from "../../resource/agent-resource-capture.ts";
import {
  agentResourceReferencesEqual,
  parseAgentResourceReference,
} from "../../resource/agent-resource-reference.ts";
import type {
  ProjectSourceFileRevision,
  ProjectSourceWorkspaceState,
} from "../../project-source-workspace/types.ts";
import { ProjectSourceWorkspaceError } from "../../project-source-workspace/types.ts";

export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA =
  "technical-source-analysis-capture/2.0" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND =
  "technical-source-analysis" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA =
  "technical-source-analysis-capture-locator/2.0" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND =
  "technical-source-analysis-capture-locator" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX =
  "casys://technical-source-analysis-capture/sha256/" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PATTERN =
  /^casys:\/\/technical-source-analysis-capture\/sha256\/[a-f0-9]{64}$/;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CAS_URI = /^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/;

export interface TechnicalProjectSourceAnchor {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly workspaceEventFingerprint: ContentFingerprint;
  readonly fileId: string;
  readonly fileRevision: number;
  readonly fileFingerprint: ContentFingerprint;
  readonly resourceRef: AgentResourceReference;
}

export interface TechnicalSourceAnalysisCaptureLocator {
  readonly schemaVersion: typeof TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA;
  readonly kind: typeof TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
}

/**
 * Complete public provenance of one technical source: the workspace anchor,
 * opaque locator, capture handle, and registered source/profile/analyzer
 * identities. Every recross compares this record field-for-field.
 */
export interface TechnicalSourceProvenanceIdentity {
  readonly sourceId: string;
  readonly role: string;
  readonly language: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly profileFingerprint: ContentFingerprint;
  readonly analyzer: {
    readonly id: string;
    readonly version: string;
  };
  readonly sourceFingerprint: ContentFingerprint;
  readonly captureFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
  readonly projectSource: TechnicalProjectSourceAnchor;
  readonly locator: TechnicalSourceAnalysisCaptureLocator;
}

export type TechnicalSourceWorkspaceRecrossErrorCode =
  | "project_mismatch"
  | "workspace_revision_mismatch"
  | "workspace_event_fingerprint_mismatch"
  | "file_not_found"
  | "file_revision_not_active"
  | "file_fingerprint_mismatch"
  | "resource_ref_mismatch"
  | "capture_request_missing"
  | "capture_request_profile_mismatch"
  | "role_mismatch";

export class TechnicalSourceWorkspaceRecrossError extends Error {
  constructor(
    readonly code: TechnicalSourceWorkspaceRecrossErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TechnicalSourceWorkspaceRecrossError";
  }
}

export function validateTechnicalSourceAnalysisCaptureLocator(
  value: unknown,
  path = "$technicalSourceAnalysisCaptureLocator",
): TechnicalSourceAnalysisCaptureLocator {
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "fingerprint", "byteCount", "casUri"],
    path,
  );
  literalValue(
    root.schemaVersion,
    TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
    `${path}.kind`,
  );
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const byteCount = nonNegativeSafeInteger(root.byteCount, `${path}.byteCount`);
  return deepFreeze({
    schemaVersion: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint,
    byteCount,
    casUri: locatorCasUri(root.casUri, fingerprint.digest, `${path}.casUri`),
  });
}

export function validateTechnicalProjectSourceAnchor(
  value: unknown,
  path = "$projectSource",
): TechnicalProjectSourceAnchor {
  const root = exactRecord(
    value,
    [
      "projectId",
      "workspaceRevision",
      "workspaceEventFingerprint",
      "fileId",
      "fileRevision",
      "fileFingerprint",
      "resourceRef",
    ],
    path,
  );
  return deepFreeze({
    projectId: exactProjectId(root.projectId, `${path}.projectId`),
    workspaceRevision: positiveInteger(
      root.workspaceRevision,
      `${path}.workspaceRevision`,
    ),
    workspaceEventFingerprint: parseFingerprint(
      root.workspaceEventFingerprint,
      `${path}.workspaceEventFingerprint`,
    ),
    fileId: exactProjectId(root.fileId, `${path}.fileId`),
    fileRevision: positiveInteger(root.fileRevision, `${path}.fileRevision`),
    fileFingerprint: parseFingerprint(
      root.fileFingerprint,
      `${path}.fileFingerprint`,
    ),
    resourceRef: parseAgentResourceReference(root.resourceRef, `${path}.resourceRef`),
  });
}

export function requireActiveTechnicalSourceFile(
  state: ProjectSourceWorkspaceState,
  fileId: string,
  fileRevision: number,
): ProjectSourceFileRevision {
  const file = state.files.get(fileId);
  if (!file) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "file_not_found",
      `File ${fileId} is not present in workspace revision ${state.workspaceRevision}.`,
    );
  }
  const record = file.revisions.get(fileRevision);
  if (!record) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "file_not_found",
      `File ${fileId} revision ${fileRevision} is not present in workspace revision ${state.workspaceRevision}.`,
    );
  }
  if (
    file.status !== "active" ||
    file.headRevision !== fileRevision ||
    record.kind !== "content"
  ) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "file_revision_not_active",
      `File ${fileId} revision ${fileRevision} is not the active content revision in workspace revision ${state.workspaceRevision}.`,
    );
  }
  return record;
}

export function recrossTechnicalSourceWorkspace(
  state: ProjectSourceWorkspaceState,
  expected: TechnicalProjectSourceAnchor & {
    readonly profileId: string;
    readonly role: string;
  },
): ProjectSourceFileRevision {
  if (state.projectId !== expected.projectId) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "project_mismatch",
      "Technical source capture is foreign to the requested project.",
    );
  }
  if (state.workspaceRevision !== expected.workspaceRevision) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "workspace_revision_mismatch",
      "Technical source capture does not name the exact workspace revision.",
    );
  }
  if (
    state.lastEventFingerprint === undefined ||
    !fingerprintsEqual(
      state.lastEventFingerprint,
      expected.workspaceEventFingerprint,
    )
  ) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "workspace_event_fingerprint_mismatch",
      "Workspace head fingerprint does not match the captured project-source anchor.",
    );
  }
  const record = requireActiveTechnicalSourceFile(
    state,
    expected.fileId,
    expected.fileRevision,
  );
  if (!fingerprintsEqual(record.fingerprint, expected.fileFingerprint)) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "file_fingerprint_mismatch",
      "Workspace file fingerprint does not match the captured project-source anchor.",
    );
  }
  if (!agentResourceReferencesEqual(record.resourceRef, expected.resourceRef)) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "resource_ref_mismatch",
      "Workspace AgentResourceReference does not match the captured project-source anchor.",
    );
  }
  if (record.captureRequest === undefined) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "capture_request_missing",
      `File ${expected.fileId} has no captureRequest.profileId at the named workspace revision.`,
    );
  }
  if (record.captureRequest.profileId !== expected.profileId) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "capture_request_profile_mismatch",
      "Workspace captureRequest.profileId does not match the captured profile.",
    );
  }
  if (record.role !== expected.role) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "role_mismatch",
      "Workspace file role does not match the registered technical-source profile role.",
    );
  }
  return record;
}

export function projectSourceAnchorFromActiveFile(
  state: ProjectSourceWorkspaceState,
  record: ProjectSourceFileRevision,
): TechnicalProjectSourceAnchor {
  if (state.lastEventFingerprint === undefined) {
    throw new ProjectSourceWorkspaceError(
      "event_chain_mismatch",
      "A technical-source capture requires a hash-chained workspace event fingerprint.",
    );
  }
  return deepFreeze({
    projectId: state.projectId,
    workspaceRevision: state.workspaceRevision,
    workspaceEventFingerprint: state.lastEventFingerprint,
    fileId: record.fileId,
    fileRevision: record.fileRevision,
    fileFingerprint: record.fingerprint,
    resourceRef: record.resourceRef,
  });
}

export function technicalProjectSourceAnchorsEqual(
  left: TechnicalProjectSourceAnchor,
  right: TechnicalProjectSourceAnchor,
): boolean {
  return left.projectId === right.projectId &&
    left.workspaceRevision === right.workspaceRevision &&
    fingerprintsEqual(
      left.workspaceEventFingerprint,
      right.workspaceEventFingerprint,
    ) &&
    left.fileId === right.fileId &&
    left.fileRevision === right.fileRevision &&
    fingerprintsEqual(left.fileFingerprint, right.fileFingerprint) &&
    agentResourceReferencesEqual(left.resourceRef, right.resourceRef);
}

export function technicalSourceAnalysisCaptureLocatorsEqual(
  left: TechnicalSourceAnalysisCaptureLocator,
  right: TechnicalSourceAnalysisCaptureLocator,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.kind === right.kind &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.byteCount === right.byteCount &&
    left.casUri === right.casUri;
}

export function technicalSourceProvenanceIdentitiesEqual(
  left: TechnicalSourceProvenanceIdentity,
  right: TechnicalSourceProvenanceIdentity,
): boolean {
  return left.sourceId === right.sourceId &&
    left.role === right.role &&
    left.language === right.language &&
    left.profileId === right.profileId &&
    left.profileVersion === right.profileVersion &&
    fingerprintsEqual(left.profileFingerprint, right.profileFingerprint) &&
    left.analyzer.id === right.analyzer.id &&
    left.analyzer.version === right.analyzer.version &&
    fingerprintsEqual(left.sourceFingerprint, right.sourceFingerprint) &&
    fingerprintsEqual(left.captureFingerprint, right.captureFingerprint) &&
    fingerprintsEqual(left.analysisFingerprint, right.analysisFingerprint) &&
    technicalProjectSourceAnchorsEqual(left.projectSource, right.projectSource) &&
    technicalSourceAnalysisCaptureLocatorsEqual(left.locator, right.locator);
}

export function assertTechnicalProjectSourceAnchorsEqual(
  expected: TechnicalProjectSourceAnchor,
  observed: TechnicalProjectSourceAnchor,
  path: string,
): void {
  if (!technicalProjectSourceAnchorsEqual(expected, observed)) {
    throw new TypeError(
      `${path} does not match the complete project-source anchor.`,
    );
  }
}

export function assertTechnicalSourceAnalysisCaptureLocatorsEqual(
  expected: TechnicalSourceAnalysisCaptureLocator,
  observed: TechnicalSourceAnalysisCaptureLocator,
  path: string,
): void {
  if (!technicalSourceAnalysisCaptureLocatorsEqual(expected, observed)) {
    throw new TypeError(
      `${path} does not match the complete opaque locator identity.`,
    );
  }
}

export function assertTechnicalSourceProvenanceIdentitiesEqual(
  expected: TechnicalSourceProvenanceIdentity,
  observed: TechnicalSourceProvenanceIdentity,
  path: string,
): void {
  if (!technicalSourceProvenanceIdentitiesEqual(expected, observed)) {
    throw new TypeError(
      `${path} does not match the complete technical-source provenance identity.`,
    );
  }
}

/**
 * Every source in one preview or admission bundle names the command/draft
 * project, one identical workspaceRevision, and one identical
 * workspaceEventFingerprint. Mixed projects and mixed workspace snapshots
 * are rejected. An unchanged sibling is recaptured at the common revision
 * rather than mixed in; a later sibling bump does not reuse an earlier
 * fingerprint at the same numeric revision.
 */
export function assertTechnicalCompilationSourcesShareExactWorkspace(
  sources: readonly { readonly projectSource: TechnicalProjectSourceAnchor }[],
  projectId: string,
  path: string,
): number {
  if (sources.length === 0) {
    throw new TypeError(`${path} must contain at least one technical source.`);
  }
  const workspaceRevision = sources[0]!.projectSource.workspaceRevision;
  const workspaceEventFingerprint = sources[0]!.projectSource.workspaceEventFingerprint;
  for (const [index, source] of sources.entries()) {
    if (source.projectSource.projectId !== projectId) {
      throw new TypeError(
        `${path}[${index}].projectSource.projectId must equal the exact project ${projectId}.`,
      );
    }
    if (source.projectSource.workspaceRevision !== workspaceRevision) {
      throw new TypeError(
        `${path} must name one identical workspaceRevision; mixed workspace snapshots are rejected.`,
      );
    }
    if (
      !fingerprintsEqual(
        source.projectSource.workspaceEventFingerprint,
        workspaceEventFingerprint,
      )
    ) {
      throw new TypeError(
        `${path} must name one identical workspaceEventFingerprint; mixed workspace snapshots are rejected.`,
      );
    }
  }
  return workspaceRevision;
}

function exactProjectId(value: unknown, path: string): string {
  const id = safeId(value, path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  return id;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" || !SHA256_HEX.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function canonicalCasUri(value: unknown, digest: string, path: string): string {
  const uri = nonEmptyText(value, path);
  if (!CAS_URI.test(uri) || !uri.endsWith(`/sha256/${digest}`)) {
    throw new TypeError(`${path} must be a canonical CAS URI for its sha256.`);
  }
  return uri;
}

function locatorCasUri(value: unknown, digest: string, path: string): string {
  const uri = canonicalCasUri(value, digest, path);
  if (
    !TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PATTERN.test(uri) ||
    uri !== `${TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX}${digest}`
  ) {
    throw new TypeError(
      `${path} must be ${TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX}<digest>.`,
    );
  }
  return uri;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}
