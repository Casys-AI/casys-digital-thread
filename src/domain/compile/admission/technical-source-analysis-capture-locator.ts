/**
 * Opaque technical-source capture locator and sealed attachment/closure
 * provenance. The locator is the only public replay handle.
 */

import {
  closedRecord,
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
import {
  PROJECT_SOURCE_CLOSURE_LOCATOR_KIND,
  PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA,
  type ProjectSourceClosureLocator,
  validateProjectSourceClosureLocator,
} from "../../project-source-workspace/closure.ts";
import type {
  ProjectSourceAttachmentDeclaredAgainst,
  ProjectSourceAttachmentRole,
  ProjectSourceAttachmentTarget,
  ProjectSourceFileRevision,
  ProjectSourceWorkspaceState,
} from "../../project-source-workspace/types.ts";
import {
  parseAttachmentDeclaredAgainst,
  parseAttachmentRole,
  parseAttachmentTarget,
} from "../../project-source-workspace/validation.ts";
import type { TechnicalCompilationBasis } from "./technical-compilation-basis.ts";

export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA =
  "technical-source-analysis-capture/4.0" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND =
  "technical-source-analysis" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA =
  "technical-source-analysis-capture-locator/4.0" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND =
  "technical-source-analysis-capture-locator" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX =
  "casys://technical-source-analysis-capture/sha256/" as const;
export const TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PATTERN =
  /^casys:\/\/technical-source-analysis-capture\/sha256\/[a-f0-9]{64}$/;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CAS_URI = /^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/;

export interface TechnicalSourceAttachmentProvenance {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly predecessorAttachmentRevision?: number;
  readonly fingerprint: ContentFingerprint;
  readonly fileId: string;
  readonly role: ProjectSourceAttachmentRole;
  readonly target: ProjectSourceAttachmentTarget;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
}

export interface TechnicalSourceClosureRoot {
  readonly fileId: string;
  readonly fileRevision: number;
  readonly fileFingerprint: ContentFingerprint;
  readonly resourceRef: AgentResourceReference;
}

export interface TechnicalSourceClosureProvenance {
  readonly locator: ProjectSourceClosureLocator;
  readonly fingerprint: ContentFingerprint;
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly workspaceEventFingerprint: ContentFingerprint;
  readonly root: TechnicalSourceClosureRoot;
}

export interface TechnicalSourceAnalysisCaptureLocator {
  readonly schemaVersion: typeof TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA;
  readonly kind: typeof TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
}

/**
 * The explicit relationship between the sealed author closure and the one
 * script which the compiler is allowed to consume. `unlowered-closure` is a
 * diagnostic state, never a disguised root-only executable unit.
 */
export type TechnicalSourceClosureKind =
  | "root-only"
  | "build123d-workspace-closure-lowered"
  | "unlowered-closure";

export type TechnicalSourceEffectiveUnit =
  | {
    readonly kind: "authored-root";
    readonly closureKind: "root-only" | "unlowered-closure";
    readonly unitId: string;
    readonly closureFingerprint: ContentFingerprint;
    readonly scriptFingerprint: ContentFingerprint;
  }
  | {
    readonly kind: "build123d-workspace-closure-lowered";
    readonly closureKind: "build123d-workspace-closure-lowered";
    readonly unitId: string;
    readonly closureFingerprint: ContentFingerprint;
    readonly scriptFingerprint: ContentFingerprint;
    readonly lowerer: {
      readonly schemaVersion: "build123d-workspace-closure-lowering/1.0";
      readonly kind: "build123d-workspace-closure-lowering";
      readonly manifestFingerprint: ContentFingerprint;
    };
  };

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
  readonly effectiveUnit: TechnicalSourceEffectiveUnit;
  readonly attachment: TechnicalSourceAttachmentProvenance;
  readonly sourceClosure: TechnicalSourceClosureProvenance;
  readonly locator: TechnicalSourceAnalysisCaptureLocator;
}

export function validateTechnicalSourceEffectiveUnit(
  value: unknown,
  sourceClosure: TechnicalSourceClosureProvenance | undefined,
  sourceId: string,
  sourceFingerprint: ContentFingerprint,
  path = "$effectiveUnit",
): TechnicalSourceEffectiveUnit {
  const root = closedRecord(
    value,
    [
      "kind",
      "closureKind",
      "unitId",
      "closureFingerprint",
      "scriptFingerprint",
      "lowerer",
    ],
    ["kind", "closureKind", "unitId", "closureFingerprint", "scriptFingerprint"],
    path,
  );
  const closureFingerprint = parseFingerprint(
    root.closureFingerprint,
    `${path}.closureFingerprint`,
  );
  const scriptFingerprint = parseFingerprint(
    root.scriptFingerprint,
    `${path}.scriptFingerprint`,
  );
  if (!fingerprintsEqual(scriptFingerprint, sourceFingerprint)) {
    throw new TypeError(
      `${path} must bind the exact effective script bytes.`,
    );
  }
  if (
    sourceClosure !== undefined &&
    !fingerprintsEqual(closureFingerprint, sourceClosure.fingerprint)
  ) {
    throw new TypeError(`${path} must bind the exact sealed closure bytes.`);
  }
  const unitId = exactProjectId(root.unitId, `${path}.unitId`);
  if (unitId !== `technical-unit:${closureFingerprint.digest}`) {
    throw new TypeError(
      `${path}.unitId must derive from the exact closure fingerprint.`,
    );
  }
  if (root.kind === "authored-root") {
    if (
      (root.closureKind !== "root-only" && root.closureKind !== "unlowered-closure") ||
      Object.hasOwn(root, "lowerer") ||
      sourceId !== unitId
    ) {
      throw new TypeError(
        `${path} authored-root must name the server-derived exact closure unit without a lowerer.`,
      );
    }
    return deepFreeze({
      kind: "authored-root",
      closureKind: root.closureKind,
      unitId,
      closureFingerprint,
      scriptFingerprint,
    });
  }
  if (
    root.kind !== "build123d-workspace-closure-lowered" ||
    root.closureKind !== "build123d-workspace-closure-lowered" ||
    !Object.hasOwn(root, "lowerer") ||
    sourceId !== unitId
  ) {
    throw new TypeError(
      `${path} must be one exact Build123d workspace-closure lowered unit.`,
    );
  }
  const lowerer = exactRecord(root.lowerer, [
    "schemaVersion",
    "kind",
    "manifestFingerprint",
  ], `${path}.lowerer`);
  literalValue(
    lowerer.schemaVersion,
    "build123d-workspace-closure-lowering/1.0",
    `${path}.lowerer.schemaVersion`,
  );
  literalValue(
    lowerer.kind,
    "build123d-workspace-closure-lowering",
    `${path}.lowerer.kind`,
  );
  return deepFreeze({
    kind: "build123d-workspace-closure-lowered",
    closureKind: "build123d-workspace-closure-lowered",
    unitId,
    closureFingerprint,
    scriptFingerprint,
    lowerer: {
      schemaVersion: "build123d-workspace-closure-lowering/1.0",
      kind: "build123d-workspace-closure-lowering",
      manifestFingerprint: parseFingerprint(
        lowerer.manifestFingerprint,
        `${path}.lowerer.manifestFingerprint`,
      ),
    },
  });
}

export type TechnicalSourceWorkspaceRecrossErrorCode =
  | "project_mismatch"
  | "workspace_revision_mismatch"
  | "workspace_event_fingerprint_mismatch"
  | "attachment_not_found"
  | "attachment_not_active"
  | "attachment_revision_not_head"
  | "attachment_fingerprint_mismatch"
  | "source_removed"
  | "file_not_found"
  | "file_revision_not_active"
  | "file_fingerprint_mismatch"
  | "resource_ref_mismatch"
  | "capture_request_missing"
  | "capture_request_profile_mismatch";

export class TechnicalSourceWorkspaceRecrossError extends Error {
  constructor(
    readonly code: TechnicalSourceWorkspaceRecrossErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TechnicalSourceWorkspaceRecrossError";
  }
}

export type TechnicalSourceAttachmentAlignment =
  | "exact"
  | "different-basis"
  | "target-missing";

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

export function validateTechnicalSourceAttachmentProvenance(
  value: unknown,
  path = "$attachment",
): TechnicalSourceAttachmentProvenance {
  const root = closedRecord(
    value,
    [
      "attachmentId",
      "attachmentRevision",
      "predecessorAttachmentRevision",
      "fingerprint",
      "fileId",
      "role",
      "target",
      "declaredAgainst",
    ],
    [
      "attachmentId",
      "attachmentRevision",
      "fingerprint",
      "fileId",
      "role",
      "target",
      "declaredAgainst",
    ],
    path,
  );
  let role: ProjectSourceAttachmentRole;
  let target: ProjectSourceAttachmentTarget;
  let declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
  try {
    role = parseAttachmentRole(root.role, `${path}.role`);
    target = parseAttachmentTarget(root.target, `${path}.target`);
    declaredAgainst = parseAttachmentDeclaredAgainst(
      root.declaredAgainst,
      `${path}.declaredAgainst`,
    );
  } catch (cause) {
    throw new TypeError(
      cause instanceof Error
        ? cause.message
        : `${path} is not an exact attachment head.`,
    );
  }
  return deepFreeze({
    attachmentId: exactProjectId(root.attachmentId, `${path}.attachmentId`),
    attachmentRevision: positiveInteger(
      root.attachmentRevision,
      `${path}.attachmentRevision`,
    ),
    ...(Object.hasOwn(root, "predecessorAttachmentRevision")
      ? {
        predecessorAttachmentRevision: positiveInteger(
          root.predecessorAttachmentRevision,
          `${path}.predecessorAttachmentRevision`,
        ),
      }
      : {}),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
    fileId: exactProjectId(root.fileId, `${path}.fileId`),
    role,
    target,
    declaredAgainst,
  });
}

export function validateTechnicalSourceClosureProvenance(
  value: unknown,
  path = "$sourceClosure",
): TechnicalSourceClosureProvenance {
  const root = exactRecord(
    value,
    [
      "locator",
      "fingerprint",
      "projectId",
      "workspaceRevision",
      "workspaceEventFingerprint",
      "root",
    ],
    path,
  );
  const locator = validateProjectSourceClosureLocator(root.locator, `${path}.locator`);
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const closureRoot = exactRecord(
    root.root,
    ["fileId", "fileRevision", "fileFingerprint", "resourceRef"],
    `${path}.root`,
  );
  return deepFreeze({
    locator,
    fingerprint,
    projectId: exactProjectId(root.projectId, `${path}.projectId`),
    workspaceRevision: positiveInteger(
      root.workspaceRevision,
      `${path}.workspaceRevision`,
    ),
    workspaceEventFingerprint: parseFingerprint(
      root.workspaceEventFingerprint,
      `${path}.workspaceEventFingerprint`,
    ),
    root: {
      fileId: exactProjectId(closureRoot.fileId, `${path}.root.fileId`),
      fileRevision: positiveInteger(
        closureRoot.fileRevision,
        `${path}.root.fileRevision`,
      ),
      fileFingerprint: parseFingerprint(
        closureRoot.fileFingerprint,
        `${path}.root.fileFingerprint`,
      ),
      resourceRef: parseAgentResourceReference(
        closureRoot.resourceRef,
        `${path}.root.resourceRef`,
      ),
    },
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

export function recrossTechnicalSourceAuthority(
  state: ProjectSourceWorkspaceState,
  expected: {
    readonly attachment: TechnicalSourceAttachmentProvenance;
    readonly sourceClosure: TechnicalSourceClosureProvenance;
    readonly profileId: string;
  },
): ProjectSourceFileRevision {
  const { attachment, sourceClosure } = expected;
  if (state.projectId !== sourceClosure.projectId) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "project_mismatch",
      "Technical source capture is foreign to the requested project.",
    );
  }
  if (state.workspaceRevision !== sourceClosure.workspaceRevision) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "workspace_revision_mismatch",
      "Technical source capture does not name the exact workspace revision.",
    );
  }
  if (
    state.lastEventFingerprint === undefined ||
    !fingerprintsEqual(
      state.lastEventFingerprint,
      sourceClosure.workspaceEventFingerprint,
    )
  ) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "workspace_event_fingerprint_mismatch",
      "Workspace head fingerprint does not match the captured source closure.",
    );
  }
  recrossAttachmentHead(state, attachment, sourceClosure.root.fileId);
  const record = requireActiveTechnicalSourceFile(
    state,
    sourceClosure.root.fileId,
    sourceClosure.root.fileRevision,
  );
  if (!fingerprintsEqual(record.fingerprint, sourceClosure.root.fileFingerprint)) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "file_fingerprint_mismatch",
      "Workspace file fingerprint does not match the captured source closure root.",
    );
  }
  if (
    !agentResourceReferencesEqual(
      record.resourceRef,
      sourceClosure.root.resourceRef,
    )
  ) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "resource_ref_mismatch",
      "Workspace AgentResourceReference does not match the captured source closure root.",
    );
  }
  if (record.captureRequest === undefined) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "capture_request_missing",
      `File ${sourceClosure.root.fileId} has no captureRequest.profileId at the named workspace revision.`,
    );
  }
  if (record.captureRequest.profileId !== expected.profileId) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "capture_request_profile_mismatch",
      "Workspace captureRequest.profileId does not match the captured profile.",
    );
  }
  return record;
}

export function assessAttachmentAgainstCompilationBasis(
  attachment: TechnicalSourceAttachmentProvenance,
  basis: TechnicalCompilationBasis,
): TechnicalSourceAttachmentAlignment {
  const declared = attachment.declaredAgainst;
  if (
    declared.thread.snapshotId !== basis.thread.snapshotId ||
    declared.thread.revision !== basis.thread.revision ||
    declared.thread.subjectId !== basis.thread.subjectId ||
    declared.architecture.artifactId !== basis.sysmlAnchor.artifactId ||
    !fingerprintsEqual(
      declared.architecture.fingerprint,
      basis.sysmlAnchor.artifactFingerprint,
    )
  ) {
    return "different-basis";
  }
  const target = basis.sysmlAnchor.elements.find((element) =>
    element.id === attachment.target.elementId &&
    element.kind === attachment.target.elementKind
  );
  if (!target) return "target-missing";
  return "exact";
}

export function technicalSourceAttachmentProvenanceEqual(
  left: TechnicalSourceAttachmentProvenance,
  right: TechnicalSourceAttachmentProvenance,
): boolean {
  return left.attachmentId === right.attachmentId &&
    left.attachmentRevision === right.attachmentRevision &&
    left.predecessorAttachmentRevision === right.predecessorAttachmentRevision &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.fileId === right.fileId &&
    left.role.id === right.role.id &&
    left.role.version === right.role.version &&
    left.target.elementId === right.target.elementId &&
    left.target.elementKind === right.target.elementKind &&
    left.declaredAgainst.thread.snapshotId ===
      right.declaredAgainst.thread.snapshotId &&
    left.declaredAgainst.thread.revision === right.declaredAgainst.thread.revision &&
    left.declaredAgainst.thread.subjectId ===
      right.declaredAgainst.thread.subjectId &&
    left.declaredAgainst.architecture.artifactId ===
      right.declaredAgainst.architecture.artifactId &&
    fingerprintsEqual(
      left.declaredAgainst.architecture.fingerprint,
      right.declaredAgainst.architecture.fingerprint,
    ) &&
    left.declaredAgainst.architecture.captureSchema ===
      right.declaredAgainst.architecture.captureSchema;
}

export function technicalSourceClosureProvenanceEqual(
  left: TechnicalSourceClosureProvenance,
  right: TechnicalSourceClosureProvenance,
): boolean {
  return left.locator.schemaVersion === right.locator.schemaVersion &&
    left.locator.kind === right.locator.kind &&
    fingerprintsEqual(left.locator.fingerprint, right.locator.fingerprint) &&
    left.locator.byteCount === right.locator.byteCount &&
    left.locator.casUri === right.locator.casUri &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.projectId === right.projectId &&
    left.workspaceRevision === right.workspaceRevision &&
    fingerprintsEqual(
      left.workspaceEventFingerprint,
      right.workspaceEventFingerprint,
    ) &&
    left.root.fileId === right.root.fileId &&
    left.root.fileRevision === right.root.fileRevision &&
    fingerprintsEqual(left.root.fileFingerprint, right.root.fileFingerprint) &&
    agentResourceReferencesEqual(left.root.resourceRef, right.root.resourceRef);
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
    technicalSourceEffectiveUnitsEqual(left.effectiveUnit, right.effectiveUnit) &&
    technicalSourceAttachmentProvenanceEqual(left.attachment, right.attachment) &&
    technicalSourceClosureProvenanceEqual(left.sourceClosure, right.sourceClosure) &&
    technicalSourceAnalysisCaptureLocatorsEqual(left.locator, right.locator);
}

export function technicalSourceEffectiveUnitsEqual(
  left: TechnicalSourceEffectiveUnit,
  right: TechnicalSourceEffectiveUnit,
): boolean {
  if (
    left.kind !== right.kind || left.closureKind !== right.closureKind ||
    left.unitId !== right.unitId ||
    !fingerprintsEqual(left.closureFingerprint, right.closureFingerprint) ||
    !fingerprintsEqual(left.scriptFingerprint, right.scriptFingerprint)
  ) return false;
  if (left.kind === "authored-root" && right.kind === "authored-root") return true;
  return left.kind === "build123d-workspace-closure-lowered" &&
    right.kind === "build123d-workspace-closure-lowered" &&
    left.lowerer.schemaVersion === right.lowerer.schemaVersion &&
    left.lowerer.kind === right.lowerer.kind &&
    fingerprintsEqual(
      left.lowerer.manifestFingerprint,
      right.lowerer.manifestFingerprint,
    );
}

export function assertTechnicalSourceAttachmentProvenanceEqual(
  expected: TechnicalSourceAttachmentProvenance,
  observed: TechnicalSourceAttachmentProvenance,
  path: string,
): void {
  if (!technicalSourceAttachmentProvenanceEqual(expected, observed)) {
    throw new TypeError(`${path} does not match the complete attachment provenance.`);
  }
}

export function assertTechnicalSourceClosureProvenanceEqual(
  expected: TechnicalSourceClosureProvenance,
  observed: TechnicalSourceClosureProvenance,
  path: string,
): void {
  if (!technicalSourceClosureProvenanceEqual(expected, observed)) {
    throw new TypeError(
      `${path} does not match the complete source-closure provenance.`,
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
 * are rejected.
 */
export function assertTechnicalCompilationSourcesShareExactWorkspace(
  sources: readonly { readonly sourceClosure: TechnicalSourceClosureProvenance }[],
  projectId: string,
  path: string,
): number {
  if (sources.length === 0) {
    throw new TypeError(`${path} must contain at least one technical source.`);
  }
  const workspaceRevision = sources[0]!.sourceClosure.workspaceRevision;
  const workspaceEventFingerprint = sources[0]!.sourceClosure.workspaceEventFingerprint;
  for (const [index, source] of sources.entries()) {
    if (source.sourceClosure.projectId !== projectId) {
      throw new TypeError(
        `${path}[${index}].sourceClosure.projectId must equal the exact project ${projectId}.`,
      );
    }
    if (source.sourceClosure.workspaceRevision !== workspaceRevision) {
      throw new TypeError(
        `${path} must name one identical workspaceRevision; mixed workspace snapshots are rejected.`,
      );
    }
    if (
      !fingerprintsEqual(
        source.sourceClosure.workspaceEventFingerprint,
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

export function sourceClosureProvenanceFrom(
  locator: ProjectSourceClosureLocator,
  closure: {
    readonly fingerprint: ContentFingerprint;
    readonly projectId: string;
    readonly workspaceRevision: number;
    readonly workspaceEventFingerprint: ContentFingerprint;
    readonly root: {
      readonly fileId: string;
      readonly fileRevision: number;
      readonly fingerprint: ContentFingerprint;
      readonly resourceRef: AgentResourceReference;
    };
  },
): TechnicalSourceClosureProvenance {
  return deepFreeze({
    locator,
    fingerprint: closure.fingerprint,
    projectId: closure.projectId,
    workspaceRevision: closure.workspaceRevision,
    workspaceEventFingerprint: closure.workspaceEventFingerprint,
    root: {
      fileId: closure.root.fileId,
      fileRevision: closure.root.fileRevision,
      fileFingerprint: closure.root.fingerprint,
      resourceRef: closure.root.resourceRef,
    },
  });
}

export function attachmentProvenanceFrom(attachment: {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly predecessorAttachmentRevision?: number;
  readonly fingerprint: ContentFingerprint;
  readonly fileId: string;
  readonly role: ProjectSourceAttachmentRole;
  readonly target: ProjectSourceAttachmentTarget;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
}): TechnicalSourceAttachmentProvenance {
  return validateTechnicalSourceAttachmentProvenance(attachment);
}

function recrossAttachmentHead(
  state: ProjectSourceWorkspaceState,
  expected: TechnicalSourceAttachmentProvenance,
  rootFileId: string,
): void {
  const record = state.attachments.get(expected.attachmentId);
  if (!record) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "attachment_not_found",
      `Attachment ${expected.attachmentId} is not present in workspace revision ${state.workspaceRevision}.`,
    );
  }
  const revision = record.revisions.get(expected.attachmentRevision);
  if (!revision) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "attachment_not_found",
      `Attachment ${expected.attachmentId}@${expected.attachmentRevision} is not present in workspace revision ${state.workspaceRevision}.`,
    );
  }
  if (record.status === "detached" || revision.kind !== "content") {
    throw new TechnicalSourceWorkspaceRecrossError(
      "attachment_not_active",
      `Attachment ${expected.attachmentId}@${expected.attachmentRevision} is not an active head.`,
    );
  }
  if (record.headRevision !== expected.attachmentRevision) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "attachment_revision_not_head",
      `Attachment ${expected.attachmentId}@${expected.attachmentRevision} is not the unique active head.`,
    );
  }
  if (record.status !== "active" || record.fileId !== rootFileId) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "source_removed",
      `Attachment ${expected.attachmentId} source file is not the captured root.`,
    );
  }
  if (!fingerprintsEqual(revision.fingerprint, expected.fingerprint)) {
    throw new TechnicalSourceWorkspaceRecrossError(
      "attachment_fingerprint_mismatch",
      "Attachment fingerprint does not match the captured attachment head.",
    );
  }
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

function canonicalCasUri(value: unknown, digest: string, path: string): string {
  const uri = nonEmptyText(value, path);
  if (!CAS_URI.test(uri) || !uri.endsWith(`/sha256/${digest}`)) {
    throw new TypeError(`${path} must be a canonical CAS URI for its sha256.`);
  }
  return uri;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

export { PROJECT_SOURCE_CLOSURE_LOCATOR_KIND, PROJECT_SOURCE_CLOSURE_LOCATOR_SCHEMA };
