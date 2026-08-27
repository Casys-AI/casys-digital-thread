/**
 * Closed `cad-placement-analysis-capture/1.0` document and opaque locator.
 *
 * The locator is the only public replay handle. The document records exact
 * workspace, architecture and usage identities after coverage. It grants
 * none and carries no provider, runtime, MRTR or verdict fields.
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
import { parseAgentResourceReference } from "../../resource/agent-resource-reference.ts";
import type { ProjectSourceAttachmentDeclaredAgainst } from "../../project-source-workspace/types.ts";
import { parseAttachmentDeclaredAgainst } from "../../project-source-workspace/validation.ts";
import {
  CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
  type CadImmediatePlacementSource,
  type CadPlacementTransform,
  validateCadImmediatePlacementSource,
} from "./cad-immediate-placement-source.ts";

export const CAD_PLACEMENT_ANALYSIS_CAPTURE_SCHEMA =
  "cad-placement-analysis-capture/1.0" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_KIND = "cad-placement-analysis" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA =
  "cad-placement-analysis-capture-locator/1.0" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND =
  "cad-placement-analysis-capture-locator" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX =
  "casys://cad-placement-analysis-capture/sha256/" as const;
export const CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PATTERN =
  /^casys:\/\/cad-placement-analysis-capture\/sha256\/[a-f0-9]{64}$/;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CAS_URI = /^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/;

export interface CadPlacementAnalysisCaptureLocator {
  readonly schemaVersion: typeof CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA;
  readonly kind: typeof CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
}

export interface CadPlacementAnalysisSourceBytes {
  readonly schemaVersion: typeof CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
}

export interface CadPlacementAnalysisWorkspace {
  readonly projectId: string;
  readonly workspaceRevision: number;
  readonly workspaceEventFingerprint: ContentFingerprint;
  readonly fileId: string;
  readonly fileRevision: number;
  readonly fileFingerprint: ContentFingerprint;
  readonly resourceRef: AgentResourceReference;
  readonly fileRole: "cad-placement-source";
}

export interface CadPlacementAnalysisAttachment {
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly fingerprint: ContentFingerprint;
  readonly usageElementId: string;
}

export interface CadPlacementAnalysisDocument {
  readonly schemaVersion: typeof CAD_PLACEMENT_ANALYSIS_CAPTURE_SCHEMA;
  readonly kind: typeof CAD_PLACEMENT_ANALYSIS_CAPTURE_KIND;
  readonly source: CadPlacementAnalysisSourceBytes;
  readonly workspace: CadPlacementAnalysisWorkspace;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
  readonly owner: {
    readonly elementKind: "PartDefinition";
    readonly elementId: string;
  };
  readonly attachments: readonly CadPlacementAnalysisAttachment[];
  readonly placements: readonly {
    readonly usageElementId: string;
    readonly partDefinitionElementId: string;
    readonly placement: CadPlacementTransform;
  }[];
  readonly grants: "none";
}

export function validateCadPlacementAnalysisCaptureLocator(
  value: unknown,
  path = "$cadPlacementAnalysisCaptureLocator",
): CadPlacementAnalysisCaptureLocator {
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "fingerprint", "byteCount", "casUri"],
    path,
  );
  literalValue(
    root.schemaVersion,
    CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    `${path}.kind`,
  );
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  return deepFreeze({
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
    fingerprint,
    byteCount: nonNegativeSafeInteger(root.byteCount, `${path}.byteCount`),
    casUri: locatorCasUri(root.casUri, fingerprint.digest, `${path}.casUri`),
  });
}

export function validateCadPlacementAnalysisDocument(
  value: unknown,
  path = "$cadPlacementAnalysisCapture",
): CadPlacementAnalysisDocument {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "source",
      "workspace",
      "declaredAgainst",
      "owner",
      "attachments",
      "placements",
      "grants",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    CAD_PLACEMENT_ANALYSIS_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, CAD_PLACEMENT_ANALYSIS_CAPTURE_KIND, `${path}.kind`);
  literalValue(root.grants, "none", `${path}.grants`);
  const source = parseSourceBytes(root.source, `${path}.source`);
  const workspace = parseWorkspace(root.workspace, `${path}.workspace`);
  const owner = exactRecord(root.owner, ["elementKind", "elementId"], `${path}.owner`);
  literalValue(owner.elementKind, "PartDefinition", `${path}.owner.elementKind`);
  if (!Array.isArray(root.attachments) || root.attachments.length === 0) {
    throw new TypeError(`${path}.attachments must be a non-empty array.`);
  }
  const attachments = root.attachments
    .map((item, index) => parseAttachment(item, `${path}.attachments[${index}]`))
    .sort((left, right) => left.usageElementId.localeCompare(right.usageElementId));
  const placements = validateCadImmediatePlacementSource({
    schemaVersion: CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
    unitSystem: "mm",
    placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
    placements: root.placements,
  }, path).placements;
  if (attachments.length !== placements.length) {
    throw new TypeError(
      `${path}.attachments must cover the same usages as placements.`,
    );
  }
  for (const [index, placement] of placements.entries()) {
    const attachment = attachments[index];
    if (attachment?.usageElementId !== placement.usageElementId) {
      throw new TypeError(
        `${path} attachment and placement usages must be exactly equal.`,
      );
    }
  }
  return deepFreeze({
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_KIND,
    source,
    workspace,
    declaredAgainst: parseAttachmentDeclaredAgainst(
      root.declaredAgainst,
      `${path}.declaredAgainst`,
    ),
    owner: {
      elementKind: "PartDefinition",
      elementId: exactId(owner.elementId, `${path}.owner.elementId`),
    },
    attachments,
    placements,
    grants: "none",
  });
}

export function assembleCadPlacementAnalysisDocument(input: {
  readonly source: CadImmediatePlacementSource;
  readonly sourceBytes: CadPlacementAnalysisSourceBytes;
  readonly workspace: CadPlacementAnalysisWorkspace;
  readonly declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
  readonly ownerElementId: string;
  readonly attachments: readonly CadPlacementAnalysisAttachment[];
}): CadPlacementAnalysisDocument {
  return validateCadPlacementAnalysisDocument({
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_SCHEMA,
    kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_KIND,
    source: input.sourceBytes,
    workspace: input.workspace,
    declaredAgainst: input.declaredAgainst,
    owner: {
      elementKind: "PartDefinition",
      elementId: input.ownerElementId,
    },
    attachments: input.attachments,
    placements: input.source.placements,
    grants: "none",
  });
}

export function cadPlacementAnalysisCaptureLocatorsEqual(
  left: CadPlacementAnalysisCaptureLocator,
  right: CadPlacementAnalysisCaptureLocator,
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.kind === right.kind &&
    fingerprintsEqual(left.fingerprint, right.fingerprint) &&
    left.byteCount === right.byteCount &&
    left.casUri === right.casUri;
}

export function assertCadPlacementAnalysisCaptureLocatorsEqual(
  expected: CadPlacementAnalysisCaptureLocator,
  observed: CadPlacementAnalysisCaptureLocator,
  path: string,
): void {
  if (!cadPlacementAnalysisCaptureLocatorsEqual(expected, observed)) {
    throw new TypeError(`${path} does not match the complete opaque locator identity.`);
  }
}

function parseSourceBytes(
  value: unknown,
  path: string,
): CadPlacementAnalysisSourceBytes {
  const rec = exactRecord(
    value,
    ["schemaVersion", "fingerprint", "byteCount", "casUri"],
    path,
  );
  literalValue(
    rec.schemaVersion,
    CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const fingerprint = parseFingerprint(rec.fingerprint, `${path}.fingerprint`);
  return {
    schemaVersion: CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
    fingerprint,
    byteCount: nonNegativeSafeInteger(rec.byteCount, `${path}.byteCount`),
    casUri: canonicalCasUri(rec.casUri, fingerprint.digest, `${path}.casUri`),
  };
}

function parseWorkspace(
  value: unknown,
  path: string,
): CadPlacementAnalysisWorkspace {
  const rec = exactRecord(
    value,
    [
      "projectId",
      "workspaceRevision",
      "workspaceEventFingerprint",
      "fileId",
      "fileRevision",
      "fileFingerprint",
      "resourceRef",
      "fileRole",
    ],
    path,
  );
  literalValue(rec.fileRole, "cad-placement-source", `${path}.fileRole`);
  return {
    projectId: exactId(rec.projectId, `${path}.projectId`),
    workspaceRevision: positiveInteger(
      rec.workspaceRevision,
      `${path}.workspaceRevision`,
    ),
    workspaceEventFingerprint: parseFingerprint(
      rec.workspaceEventFingerprint,
      `${path}.workspaceEventFingerprint`,
    ),
    fileId: exactId(rec.fileId, `${path}.fileId`),
    fileRevision: positiveInteger(rec.fileRevision, `${path}.fileRevision`),
    fileFingerprint: parseFingerprint(rec.fileFingerprint, `${path}.fileFingerprint`),
    resourceRef: parseAgentResourceReference(rec.resourceRef, `${path}.resourceRef`),
    fileRole: "cad-placement-source",
  };
}

function parseAttachment(
  value: unknown,
  path: string,
): CadPlacementAnalysisAttachment {
  const rec = exactRecord(
    value,
    ["attachmentId", "attachmentRevision", "fingerprint", "usageElementId"],
    path,
  );
  return {
    attachmentId: exactId(rec.attachmentId, `${path}.attachmentId`),
    attachmentRevision: positiveInteger(
      rec.attachmentRevision,
      `${path}.attachmentRevision`,
    ),
    fingerprint: parseFingerprint(rec.fingerprint, `${path}.fingerprint`),
    usageElementId: exactId(rec.usageElementId, `${path}.usageElementId`),
  };
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
    !CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PATTERN.test(uri) ||
    uri !== `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${digest}`
  ) {
    throw new TypeError(
      `${path} must be ${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}<digest>.`,
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

function exactId(value: unknown, path: string): string {
  const id = safeId(value, path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  return id;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}
