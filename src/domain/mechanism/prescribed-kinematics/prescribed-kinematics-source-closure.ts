/**
 * Exact ProjectSourceWorkspace binding for a prescribed-kinematics JSON case.
 *
 * One mechanism file is attached, at exact active heads, to its assembly
 * context and every explicitly mapped body PartUsage. The pure workspace can
 * prove the same-file and same-basis facts; the application layer must still
 * recross the exact SysML graph to establish the body set.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../kernel/deterministic-json.ts";
import {
  parseProductStructureElementRef,
  type ProductStructureElementKind,
  type ProductStructureElementRef,
} from "../../architecture/product-structure-ref.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  PROJECT_SOURCE_CLOSURE_SCHEMA,
  type ProjectSourceClosure,
  validateProjectSourceClosure,
} from "../../project-source-workspace/closure.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../resource/agent-resource-reference.ts";
import {
  canonicalPrescribedKinematicsCaseSourceText,
  parsePrescribedKinematicsCaseSourceText,
  type PrescribedKinematicsCaseSource,
} from "./prescribed-kinematics-case-source.ts";
import { VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION } from "./operations.ts";

export const PRESCRIBED_KINEMATICS_SOURCE_CLOSURE_SCHEMA =
  "prescribed-kinematics-source-closure/1.0" as const;
export const PRESCRIBED_KINEMATICS_CASE_SCHEMA =
  "prescribed-kinematics-case/1.0" as const;
export const PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE = Object.freeze(
  {
    id: "mechanism-source",
    version: 1,
  } as const,
);

export interface PrescribedKinematicsSourceClosure {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_SOURCE_CLOSURE_SCHEMA;
  readonly source: PrescribedKinematicsCaseSource;
  readonly workspace: {
    readonly projectId: string;
    readonly workspaceRevision: number;
    readonly workspaceEventFingerprint: ContentFingerprint;
    readonly declaredAgainst: {
      readonly thread: {
        readonly snapshotId: string;
        readonly revision: number;
        readonly subjectId: string;
      };
      readonly architecture: {
        readonly artifactId: string;
        readonly fingerprint: ContentFingerprint;
        readonly captureSchema: "architecture-capture/4.0";
      };
    };
    readonly attachments: readonly {
      readonly attachmentId: string;
      readonly attachmentRevision: number;
      readonly fingerprint: ContentFingerprint;
      readonly closureFingerprint: ContentFingerprint;
      readonly elementId: string;
      readonly elementKind: ProductStructureElementKind;
    }[];
    readonly root: {
      readonly fileId: string;
      readonly fileRevision: number;
      readonly resourceFingerprint: ContentFingerprint;
      readonly byteCount: number;
    };
  };
  /** SHA-256 of this closed binding excluding this self field. */
  readonly fingerprint: ContentFingerprint;
}

/**
 * Candidate sealed by `verify.seal-prescribed-kinematics-case@1` later in the
 * Thread. This pure type cannot itself claim that a Thread successor exists.
 */
export interface PrescribedKinematicsCase {
  readonly schemaVersion: typeof PRESCRIBED_KINEMATICS_CASE_SCHEMA;
  readonly operation: typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION;
  readonly sourceClosure: PrescribedKinematicsSourceClosure;
  readonly fingerprint: ContentFingerprint;
}

/**
 * Bind one exact source text to active same-file workspace closures. Callers
 * cannot provide arbitrary SysML ids: the assembly context and every body
 * mapping must have one matching `mechanism-source@1` attachment at the
 * common exact basis.
 */
export async function resolvePrescribedKinematicsSourceClosure(input: {
  readonly closures: readonly ProjectSourceClosure[];
  readonly sourceText: string;
}): Promise<PrescribedKinematicsSourceClosure> {
  if (input.closures.length === 0) {
    throw new TypeError(
      "Prescribed-kinematics source requires active same-file attachments.",
    );
  }
  const closures = await Promise.all(
    input.closures.map((closure) => validateProjectSourceClosure(closure)),
  );
  for (const closure of closures) assertSingleJsonRoot(closure);
  assertSameFileAttachmentBasis(closures);
  const source = parsePrescribedKinematicsCaseSourceText(input.sourceText);
  await assertSourceMatchesWorkspaceResource(source, closures[0]!.root.resourceRef);
  return await sealPrescribedKinematicsSourceClosure({ source, closures });
}

export async function sealPrescribedKinematicsSourceClosure(input: {
  readonly source: PrescribedKinematicsCaseSource;
  readonly closures: readonly ProjectSourceClosure[];
}): Promise<PrescribedKinematicsSourceClosure> {
  if (input.closures.length === 0) {
    throw new TypeError(
      "Prescribed-kinematics source requires active same-file attachments.",
    );
  }
  const closures = await Promise.all(
    input.closures.map((closure) => validateProjectSourceClosure(closure)),
  );
  for (const closure of closures) assertSingleJsonRoot(closure);
  assertSameFileAttachmentBasis(closures);
  const source = validateSource(input.source);
  assertSourceMatchesClosures(source, closures);
  await assertSourceMatchesWorkspaceResource(source, closures[0]!.root.resourceRef);
  const body = sourceClosureBody(source, closures);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validatePrescribedKinematicsSourceClosure(
  value: unknown,
  path = "$prescribedKinematicsSourceClosure",
): Promise<PrescribedKinematicsSourceClosure> {
  const root = exactRecord(value, [
    "schemaVersion",
    "source",
    "workspace",
    "fingerprint",
  ], path);
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_SOURCE_CLOSURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const source = validateSource(root.source);
  const workspace = parseWorkspace(root.workspace, `${path}.workspace`);
  if (source.project.id !== workspace.projectId) {
    throw new TypeError(`${path}.source.project.id must equal workspace.projectId.`);
  }
  if (source.project.subjectId !== workspace.declaredAgainst.thread.subjectId) {
    throw new TypeError(
      `${path}.source.project.subjectId must equal the exact declared-against Thread subject.`,
    );
  }
  await assertSourceMatchesWorkspaceResource(source, {
    fingerprint: workspace.root.resourceFingerprint,
    byteCount: workspace.root.byteCount,
  });
  assertAttachmentTargets(
    source,
    workspace.attachments,
    `${path}.workspace.attachments`,
  );
  const body = {
    schemaVersion: PRESCRIBED_KINEMATICS_SOURCE_CLOSURE_SCHEMA,
    source,
    workspace,
  } as const;
  const fingerprint = fingerprintValue(root.fingerprint, `${path}.fingerprint`);
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(
      `${path}.fingerprint does not match its exact source closure body.`,
    );
  }
  return deepFreeze({ ...body, fingerprint: expected });
}

export async function sealPrescribedKinematicsCase(
  sourceClosure: PrescribedKinematicsSourceClosure,
): Promise<PrescribedKinematicsCase> {
  const validated = await validatePrescribedKinematicsSourceClosure(sourceClosure);
  const body = {
    schemaVersion: PRESCRIBED_KINEMATICS_CASE_SCHEMA,
    operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    sourceClosure: validated,
  } as const;
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validatePrescribedKinematicsCase(
  value: unknown,
  path = "$prescribedKinematicsCase",
): Promise<PrescribedKinematicsCase> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "sourceClosure",
    "fingerprint",
  ], path);
  literalValue(
    root.schemaVersion,
    PRESCRIBED_KINEMATICS_CASE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION.version,
    `${path}.operation.version`,
  );
  const sourceClosure = await validatePrescribedKinematicsSourceClosure(
    root.sourceClosure,
    `${path}.sourceClosure`,
  );
  const body = {
    schemaVersion: PRESCRIBED_KINEMATICS_CASE_SCHEMA,
    operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    sourceClosure,
  } as const;
  const fingerprint = fingerprintValue(root.fingerprint, `${path}.fingerprint`);
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(`${path}.fingerprint does not match its exact case body.`);
  }
  return deepFreeze({ ...body, fingerprint: expected });
}

function assertSingleJsonRoot(closure: ProjectSourceClosure): void {
  if (closure.schemaVersion !== PROJECT_SOURCE_CLOSURE_SCHEMA) {
    throw new TypeError(
      "Prescribed-kinematics source closure uses an unsupported workspace closure schema.",
    );
  }
  if (closure.files.length !== 1 || closure.edges.length !== 0) {
    throw new TypeError(
      "Prescribed-kinematics V1 accepts exactly one root JSON resource and no dependencies.",
    );
  }
  const root = closure.files[0];
  if (
    root === undefined ||
    root.fileId !== closure.root.fileId ||
    root.fileRevision !== closure.root.fileRevision ||
    !fingerprintsEqual(root.fingerprint, closure.root.fingerprint) ||
    !fingerprintsEqual(
      root.resourceRef.fingerprint,
      closure.root.resourceRef.fingerprint,
    )
  ) {
    throw new TypeError(
      "Prescribed-kinematics workspace closure does not contain its exact root resource.",
    );
  }
  if (
    root.resourceRef.representation !== "text" ||
    !JSON_SOURCE_ACCEPTED_MIME_TYPES.includes(
      root.resourceRef.mimeType as (typeof JSON_SOURCE_ACCEPTED_MIME_TYPES)[number],
    )
  ) {
    throw new TypeError(
      "Prescribed-kinematics root resource must be JSON-compatible text.",
    );
  }
  if (
    !isAssemblyOrBodyKind(closure.attachment.target.elementKind) ||
    closure.attachment.role.id !== PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE.id ||
    closure.attachment.role.version !==
      PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE.version
  ) {
    throw new TypeError(
      "Prescribed-kinematics source attachments must be mechanism-source@1 edges to PartDefinition or PartUsage targets.",
    );
  }
}

function assertSameFileAttachmentBasis(
  closures: readonly ProjectSourceClosure[],
): void {
  const first = closures[0]!;
  for (const closure of closures.slice(1)) {
    if (
      closure.projectId !== first.projectId ||
      closure.workspaceRevision !== first.workspaceRevision ||
      !fingerprintsEqual(
        closure.workspaceEventFingerprint,
        first.workspaceEventFingerprint,
      ) ||
      closure.root.fileId !== first.root.fileId ||
      closure.root.fileRevision !== first.root.fileRevision ||
      !fingerprintsEqual(closure.root.fingerprint, first.root.fingerprint) ||
      !fingerprintsEqual(
        closure.root.resourceRef.fingerprint,
        first.root.resourceRef.fingerprint,
      ) ||
      closure.root.resourceRef.byteCount !== first.root.resourceRef.byteCount ||
      deterministicJson(closure.attachment.declaredAgainst) !==
        deterministicJson(first.attachment.declaredAgainst)
    ) {
      throw new TypeError(
        "Prescribed-kinematics attachments must be active heads for the same file and exact declared-against basis.",
      );
    }
  }
  rejectDuplicates(
    closures.map((closure) => closure.attachment.attachmentId),
    "$prescribedKinematicsClosures attachment ids",
  );
  rejectDuplicates(
    closures.map((closure) => attachmentTargetKey(closure.attachment.target)),
    "$prescribedKinematicsClosures attachment targets",
  );
}

function assertSourceMatchesClosures(
  source: PrescribedKinematicsCaseSource,
  closures: readonly ProjectSourceClosure[],
): void {
  if (source.project.id !== closures[0]!.projectId) {
    throw new TypeError(
      "Prescribed-kinematics source project is foreign to its workspace closures.",
    );
  }
  if (
    source.project.subjectId !==
      closures[0]!.attachment.declaredAgainst.thread.subjectId
  ) {
    throw new TypeError(
      "Prescribed-kinematics source subject is foreign to its declared-against Thread basis.",
    );
  }
  assertAttachmentTargets(
    source,
    closures.map((closure) => closure.attachment.target),
    "$prescribedKinematicsClosures",
  );
}

async function assertSourceMatchesWorkspaceResource(
  source: PrescribedKinematicsCaseSource,
  resource: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  },
): Promise<void> {
  const sourceBytes = new TextEncoder().encode(
    canonicalPrescribedKinematicsCaseSourceText(source),
  );
  if (sourceBytes.byteLength !== resource.byteCount) {
    throw new TypeError(
      "Prescribed-kinematics source byteCount differs from its workspace resource.",
    );
  }
  if ((await sha256Hex(sourceBytes)) !== resource.fingerprint.digest) {
    throw new TypeError(
      "Prescribed-kinematics source bytes differ from its workspace resource fingerprint.",
    );
  }
}

function sourceClosureBody(
  source: PrescribedKinematicsCaseSource,
  closures: readonly ProjectSourceClosure[],
): Omit<PrescribedKinematicsSourceClosure, "fingerprint"> {
  const first = closures[0]!;
  const attachments = closures.map((closure) =>
    deepFreeze({
      attachmentId: closure.attachment.attachmentId,
      attachmentRevision: closure.attachment.attachmentRevision,
      fingerprint: closure.attachment.fingerprint,
      closureFingerprint: closure.fingerprint,
      elementId: closure.attachment.target.elementId,
      elementKind: closure.attachment.target.elementKind,
    })
  ).sort(compareAttachmentTargets);
  return {
    schemaVersion: PRESCRIBED_KINEMATICS_SOURCE_CLOSURE_SCHEMA,
    source,
    workspace: {
      projectId: first.projectId,
      workspaceRevision: first.workspaceRevision,
      workspaceEventFingerprint: first.workspaceEventFingerprint,
      declaredAgainst: first.attachment.declaredAgainst,
      attachments: deepFreeze(attachments),
      root: {
        fileId: first.root.fileId,
        fileRevision: first.root.fileRevision,
        resourceFingerprint: first.root.resourceRef.fingerprint,
        byteCount: first.root.resourceRef.byteCount,
      },
    },
  };
}

function validateSource(value: unknown): PrescribedKinematicsCaseSource {
  return parsePrescribedKinematicsCaseSourceText(
    deterministicJson(value),
    "$prescribedKinematicsSourceClosure.source",
  );
}

function parseWorkspace(
  value: unknown,
  path: string,
): PrescribedKinematicsSourceClosure["workspace"] {
  const root = exactRecord(
    value,
    [
      "projectId",
      "workspaceRevision",
      "workspaceEventFingerprint",
      "declaredAgainst",
      "attachments",
      "root",
    ],
    path,
  );
  const declaredAgainst = parseDeclaredAgainst(
    root.declaredAgainst,
    `${path}.declaredAgainst`,
  );
  const attachments = arrayOf(root.attachments, `${path}.attachments`).map(
    (attachment, index) => {
      const itemPath = `${path}.attachments[${index}]`;
      const record = exactRecord(
        attachment,
        [
          "attachmentId",
          "attachmentRevision",
          "fingerprint",
          "closureFingerprint",
          "elementId",
          "elementKind",
        ],
        itemPath,
      );
      const target = parseProductStructureElementRef(
        {
          elementId: record.elementId,
          elementKind: record.elementKind,
        },
        itemPath,
      );
      return deepFreeze({
        attachmentId: safeId(record.attachmentId, `${itemPath}.attachmentId`),
        attachmentRevision: positiveInteger(
          record.attachmentRevision,
          `${itemPath}.attachmentRevision`,
        ),
        fingerprint: fingerprintValue(record.fingerprint, `${itemPath}.fingerprint`),
        closureFingerprint: fingerprintValue(
          record.closureFingerprint,
          `${itemPath}.closureFingerprint`,
        ),
        elementId: target.elementId,
        elementKind: target.elementKind,
      });
    },
  );
  if (attachments.length === 0) {
    throw new TypeError(`${path}.attachments must not be empty.`);
  }
  rejectDuplicates(
    attachments.map((attachment) => attachment.attachmentId),
    `${path}.attachments attachment ids`,
  );
  rejectDuplicates(
    attachments.map((attachment) => attachmentTargetKey(attachment)),
    `${path}.attachments targets`,
  );
  const expectedOrder = [...attachments].sort(compareAttachmentTargets);
  if (attachments.some((attachment, index) => attachment !== expectedOrder[index])) {
    throw new TypeError(
      `${path}.attachments must use canonical (elementKind, elementId) order.`,
    );
  }
  const sourceRoot = exactRecord(
    root.root,
    ["fileId", "fileRevision", "resourceFingerprint", "byteCount"],
    `${path}.root`,
  );
  return deepFreeze({
    projectId: safeId(root.projectId, `${path}.projectId`),
    workspaceRevision: positiveInteger(
      root.workspaceRevision,
      `${path}.workspaceRevision`,
    ),
    workspaceEventFingerprint: fingerprintValue(
      root.workspaceEventFingerprint,
      `${path}.workspaceEventFingerprint`,
    ),
    declaredAgainst,
    attachments,
    root: {
      fileId: safeId(sourceRoot.fileId, `${path}.root.fileId`),
      fileRevision: positiveInteger(
        sourceRoot.fileRevision,
        `${path}.root.fileRevision`,
      ),
      resourceFingerprint: fingerprintValue(
        sourceRoot.resourceFingerprint,
        `${path}.root.resourceFingerprint`,
      ),
      byteCount: positiveInteger(sourceRoot.byteCount, `${path}.root.byteCount`),
    },
  });
}

function parseDeclaredAgainst(
  value: unknown,
  path: string,
): PrescribedKinematicsSourceClosure["workspace"]["declaredAgainst"] {
  const root = exactRecord(value, ["thread", "architecture"], path);
  const thread = exactRecord(
    root.thread,
    ["snapshotId", "revision", "subjectId"],
    `${path}.thread`,
  );
  const architecture = exactRecord(
    root.architecture,
    ["artifactId", "fingerprint", "captureSchema"],
    `${path}.architecture`,
  );
  literalValue(
    architecture.captureSchema,
    "architecture-capture/4.0",
    `${path}.architecture.captureSchema`,
  );
  return deepFreeze({
    thread: {
      snapshotId: safeId(thread.snapshotId, `${path}.thread.snapshotId`),
      revision: positiveInteger(thread.revision, `${path}.thread.revision`),
      subjectId: safeId(thread.subjectId, `${path}.thread.subjectId`),
    },
    architecture: {
      artifactId: safeId(architecture.artifactId, `${path}.architecture.artifactId`),
      fingerprint: fingerprintValue(
        architecture.fingerprint,
        `${path}.architecture.fingerprint`,
      ),
      captureSchema: "architecture-capture/4.0" as const,
    },
  });
}

function assertAttachmentTargets(
  source: PrescribedKinematicsCaseSource,
  attachments: readonly ProductStructureElementRef[],
  path: string,
): void {
  const expected = expectedAttachmentTargets(source);
  if (new Set(expected.map(attachmentTargetKey)).size !== expected.length) {
    throw new TypeError(
      `${path} cannot collapse the assembly context into a body-mapped PartUsage.`,
    );
  }
  const actual = [...attachments].sort(compareAttachmentTargets);
  if (
    actual.length !== expected.length ||
    actual.some((attachment, index) =>
      attachmentTargetKey(attachment) !== attachmentTargetKey(expected[index]!)
    )
  ) {
    throw new TypeError(
      `${path} must equal exactly the assembly context and body-mapped PartUsage target set.`,
    );
  }
}

function expectedAttachmentTargets(
  source: PrescribedKinematicsCaseSource,
): readonly ProductStructureElementRef[] {
  return [
    source.assembly,
    ...source.bodies.map((body) =>
      deepFreeze({
        elementId: body.partUsageElementId,
        elementKind: "PartUsage" as const,
      })
    ),
  ].sort(compareAttachmentTargets);
}

function isAssemblyOrBodyKind(
  value: string,
): value is ProductStructureElementKind {
  return value === "PartDefinition" || value === "PartUsage";
}

function attachmentTargetKey(
  target: ProductStructureElementRef,
): string {
  return `${target.elementKind}\0${target.elementId}`;
}

function compareAttachmentTargets(
  left: ProductStructureElementRef,
  right: ProductStructureElementRef,
): number {
  return left.elementKind.localeCompare(right.elementKind) ||
    left.elementId.localeCompare(right.elementId);
}

function fingerprintValue(value: unknown, path: string): ContentFingerprint {
  const record = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(record.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof record.digest === "string" ? record.digest : "";
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest });
}
