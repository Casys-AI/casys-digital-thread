import type {
  TechnicalCompilationPreviewEvidence,
  TechnicalCompilationPreviewEvidenceReference,
  TechnicalCompilationPreviewEvidenceStore,
} from "../../../application/ports/out/compile/admission/technical-compilation-preview-evidence-store.ts";
import { TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA } from "../../../application/ports/out/compile/admission/technical-compilation-preview-evidence-store.ts";
import {
  fingerprintTechnicalCompilationDocument,
  validateTechnicalCompilationDocument,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import { assembleTechnicalCompilationAdmissionOperation } from "../../../domain/compile/admission/technical-compilation-admission-operation.ts";
import { validateTechnicalCompilationJoinGaps } from "../../../domain/compile/admission/technical-compilation-preview-review.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  closedRecord,
  exactRecord,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";

export class FileTechnicalCompilationPreviewEvidenceStore
  implements TechnicalCompilationPreviewEvidenceStore {
  constructor(
    private readonly bytes: FileByteStore<"technical-compilation-preview-evidence">,
  ) {}
  async save(
    value: TechnicalCompilationPreviewEvidence,
  ): Promise<TechnicalCompilationPreviewEvidenceReference> {
    const evidence = await parse(value);
    const text = deterministicJson(evidence);
    const bytes = new TextEncoder().encode(text);
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: await fingerprintResourceBytes(bytes),
    };
    const stored = await this.bytes.save(fingerprint, bytes);
    const reopened = await this.read({
      schemaVersion: TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
      projectId: evidence.projectId,
      fingerprint,
      byteCount: stored.byteCount,
    });
    if (!reopened || deterministicJson(reopened) !== text) {
      throw new TypeError("Preview evidence failed exact reread.");
    }
    return {
      schemaVersion: TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
      projectId: evidence.projectId,
      fingerprint,
      byteCount: stored.byteCount,
    };
  }
  async read(
    reference: TechnicalCompilationPreviewEvidenceReference,
  ): Promise<TechnicalCompilationPreviewEvidence | undefined> {
    const ref = parseRef(reference);
    const bytes = await this.bytes.read(ref.fingerprint);
    if (!bytes) return undefined;
    if (bytes.byteLength !== ref.byteCount) {
      throw new TypeError("Preview evidence byte count is not exact.");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.copy());
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TypeError("Preview evidence is not JSON.");
    }
    const evidence = await parse(parsed);
    const canonical = deterministicJson(evidence);
    const actual = {
      algorithm: "sha256" as const,
      digest: await fingerprintResourceBytes(new TextEncoder().encode(canonical)),
    };
    if (
      canonical !== text || !fingerprintsEqual(actual, ref.fingerprint) ||
      evidence.projectId !== ref.projectId
    ) throw new TypeError("Preview evidence is foreign or corrupt.");
    return evidence;
  }
  async saveCursor(
    value: {
      readonly projectId: string;
      readonly fingerprint: string;
      readonly section: string;
      readonly offset: number;
    },
  ): Promise<string> {
    const record = exactRecord(
      value,
      ["projectId", "fingerprint", "section", "offset"],
      "$cursor",
    );
    if (
      !/^[a-f0-9]{64}$/.test(String(record.fingerprint)) ||
      typeof record.section !== "string" || !Number.isSafeInteger(record.offset) ||
      Number(record.offset) < 0
    ) throw new TypeError("Preview evidence cursor is invalid or foreign.");
    const text = deterministicJson({
      projectId: safeId(record.projectId, "$cursor.projectId"),
      fingerprint: record.fingerprint,
      section: record.section,
      offset: Number(record.offset),
    });
    const fp = {
      algorithm: "sha256" as const,
      digest: await fingerprintResourceBytes(new TextEncoder().encode(text)),
    };
    await this.bytes.save(fp, new TextEncoder().encode(text));
    return fp.digest;
  }
  async readCursor(
    cursor: string,
  ): Promise<
    {
      readonly projectId: string;
      readonly fingerprint: string;
      readonly section: string;
      readonly offset: number;
    } | undefined
  > {
    if (!/^[a-f0-9]{64}$/.test(cursor)) {
      throw new TypeError("Preview evidence cursor is invalid or foreign.");
    }
    const bytes = await this.bytes.read({ algorithm: "sha256", digest: cursor });
    if (!bytes) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.copy());
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new TypeError("Preview evidence cursor is corrupt.");
    }
    const record = exactRecord(
      value,
      ["projectId", "fingerprint", "section", "offset"],
      "$cursor",
    );
    if (
      !/^[a-f0-9]{64}$/.test(String(record.fingerprint)) ||
      typeof record.section !== "string" || !Number.isSafeInteger(record.offset) ||
      Number(record.offset) < 0
    ) throw new TypeError("Preview evidence cursor is corrupt.");
    return {
      projectId: safeId(record.projectId, "$cursor.projectId"),
      fingerprint: String(record.fingerprint),
      section: record.section,
      offset: Number(record.offset),
    };
  }
}
function parseRef(value: unknown): TechnicalCompilationPreviewEvidenceReference {
  const x = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "fingerprint",
    "byteCount",
  ], "$ref");
  if (
    x.schemaVersion !== TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA ||
    !Number.isSafeInteger(x.byteCount) || Number(x.byteCount) < 1
  ) throw new TypeError("Invalid preview evidence reference.");
  if (x.fingerprint === null || typeof x.fingerprint !== "object") {
    throw new TypeError("Invalid preview evidence fingerprint.");
  }
  const fingerprint = x.fingerprint as Record<string, unknown>;
  if (
    fingerprint.algorithm !== "sha256" || typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) throw new TypeError("Invalid preview evidence fingerprint.");
  return {
    schemaVersion: TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
    projectId: safeId(x.projectId, "$ref.projectId"),
    fingerprint: { algorithm: "sha256", digest: fingerprint.digest },
    byteCount: Number(x.byteCount),
  };
}
async function parse(value: unknown): Promise<TechnicalCompilationPreviewEvidence> {
  const x = exactRecord(value, ["schemaVersion", "projectId", "result"], "$evidence");
  if (x.schemaVersion !== "technical-compilation-preview-evidence/1.0") {
    throw new TypeError("Invalid preview evidence schema.");
  }
  const projectId = safeId(x.projectId, "$evidence.projectId");
  const r = closedRecord(
    x.result,
    [
      "status",
      "document",
      "fingerprint",
      "gaps",
      "draft",
      "decisionParameters",
      "operation",
    ],
    ["status", "document", "fingerprint", "gaps"],
    "$evidence.result",
  );
  if (
    r.status !== "ready-for-review" && r.status !== "unresolved" &&
    r.status !== "rejected"
  ) throw new TypeError("Invalid preview status.");
  const document = await validateTechnicalCompilationDocument(r.document);
  const fingerprint = parseFingerprint(r.fingerprint, "$evidence.result.fingerprint");
  if (
    !fingerprintsEqual(
      fingerprint,
      await fingerprintTechnicalCompilationDocument(document),
    )
  ) {
    throw new TypeError("Preview evidence fingerprint does not match its document.");
  }
  if (document.basis.thread.projectId !== projectId) {
    throw new TypeError("Foreign preview evidence.");
  }
  if (document.status !== r.status) {
    throw new TypeError("Preview evidence status must equal its document status.");
  }
  const gaps = validateTechnicalCompilationJoinGaps(r.gaps);
  if (deterministicJson(gaps) !== deterministicJson(r.gaps)) {
    throw new TypeError("Preview evidence gaps are not canonical.");
  }
  if (r.status === "ready-for-review") {
    exactRecord(r, [
      "status",
      "document",
      "fingerprint",
      "gaps",
      "draft",
      "decisionParameters",
      "operation",
    ], "$evidence.result");
    validateReadyPreview(r, projectId, fingerprint, document);
  } else if (
    Object.hasOwn(r, "draft") || Object.hasOwn(r, "decisionParameters") ||
    Object.hasOwn(r, "operation")
  ) {
    throw new TypeError("Non-ready preview evidence must not carry MRTR fields.");
  }
  return {
    schemaVersion: "technical-compilation-preview-evidence/1.0",
    projectId,
    result: x.result as TechnicalCompilationPreviewEvidence["result"],
  };
}

function parseFingerprint(value: unknown, path: string) {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  if (
    fingerprint.algorithm !== "sha256" || typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) throw new TypeError(`${path} must be a lowercase sha256 fingerprint.`);
  return { algorithm: "sha256" as const, digest: fingerprint.digest };
}

function validateReadyPreview(
  value: Record<string, unknown>,
  projectId: string,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  document: Awaited<ReturnType<typeof validateTechnicalCompilationDocument>>,
): void {
  const draft = exactRecord(value.draft, [
    "schemaVersion",
    "draftId",
    "projectId",
    "documentFingerprint",
    "envelopeFingerprint",
  ], "$evidence.result.draft");
  if (
    draft.schemaVersion !== "technical-compilation-draft-reference/1.0" ||
    draft.draftId !== `technical-compilation:${projectId}:${fingerprint.digest}` ||
    draft.projectId !== projectId ||
    !fingerprintsEqual(
      parseFingerprint(
        draft.documentFingerprint,
        "$evidence.result.draft.documentFingerprint",
      ),
      fingerprint,
    )
  ) throw new TypeError("Ready preview draft is not exact.");
  parseFingerprint(
    draft.envelopeFingerprint,
    "$evidence.result.draft.envelopeFingerprint",
  );

  if (!Array.isArray(value.decisionParameters)) {
    throw new TypeError("Ready preview decisionParameters must be an array.");
  }
  const admission = parseTechnicalCompilationAdmissionParameters(
    value.decisionParameters as never,
  );
  const reencoded = encodeTechnicalCompilationAdmissionParameters(admission);
  if (deterministicJson(reencoded) !== deterministicJson(value.decisionParameters)) {
    throw new TypeError("Ready preview decision parameters are not canonical.");
  }
  if (
    admission.draft.draftId !== draft.draftId ||
    admission.draft.projectId !== projectId ||
    !fingerprintsEqual(admission.draft.documentFingerprint, fingerprint) ||
    !fingerprintsEqual(
      admission.draft.envelopeFingerprint,
      parseFingerprint(
        draft.envelopeFingerprint,
        "$evidence.result.draft.envelopeFingerprint",
      ),
    ) ||
    !fingerprintsEqual(admission.compilation.fingerprint, fingerprint) ||
    admission.compilation.status !== "ready-for-review" ||
    !fingerprintsEqual(admission.basis.fingerprint, document.basisFingerprint) ||
    admission.basis.thread.projectId !== document.basis.thread.projectId ||
    admission.basis.thread.subjectId !== document.basis.thread.subjectId ||
    admission.basis.thread.snapshotId !== document.basis.thread.snapshotId ||
    admission.basis.thread.revision !== document.basis.thread.revision ||
    !fingerprintsEqual(
      admission.basis.thread.fingerprint,
      document.basis.thread.snapshotFingerprint,
    ) ||
    admission.basis.sysml.artifactId !== document.basis.sysmlAnchor.artifactId ||
    admission.basis.sysml.captureId !== document.basis.sysmlAnchor.captureId ||
    admission.basis.sysml.editingContextId !==
      document.basis.sysmlAnchor.editingContextId ||
    admission.basis.sysml.rootElementId !== document.basis.sysmlAnchor.rootElementId ||
    admission.basis.sysml.rootElementKind !==
      document.basis.sysmlAnchor.rootElementKind ||
    !fingerprintsEqual(
      admission.basis.sysml.artifactFingerprint,
      document.basis.sysmlAnchor.artifactFingerprint,
    ) ||
    !fingerprintsEqual(
      admission.basis.sysml.anchorFingerprint,
      document.basis.sysmlAnchorFingerprint,
    ) ||
    deterministicJson(admission.bindings) !==
      deterministicJson(document.inputManifest.bindings)
  ) throw new TypeError("Ready preview admission does not exactly match its document.");
  if (
    admission.sources.length !== document.inputManifest.sources.length ||
    admission.compilationProfileRequests.length !==
      document.inputManifest.profileRequests.length
  ) throw new TypeError("Ready preview admission does not exactly cover its document.");
  for (const source of document.inputManifest.sources) {
    const expected = admission.sources.find((item) =>
      item.id === source.analysis.source.id
    );
    if (
      !expected || expected.role !== source.analysis.source.role ||
      expected.language !== source.analysis.source.language ||
      !fingerprintsEqual(
        expected.sourceFingerprint,
        source.analysis.source.fingerprint,
      ) ||
      !fingerprintsEqual(expected.analysisFingerprint, source.analysisFingerprint) ||
      deterministicJson(expected.effectiveUnit) !==
        deterministicJson(source.effectiveUnit)
    ) {
      throw new TypeError(
        "Ready preview admission source does not exactly match its document.",
      );
    }
  }
  for (const request of document.inputManifest.profileRequests) {
    const expected = admission.compilationProfileRequests.find((item) =>
      item.profileId === request.profileId &&
      item.profileVersion === request.profileVersion
    );
    if (
      !expected ||
      deterministicJson(expected.sourceIds) !== deterministicJson(request.sourceIds)
    ) {
      throw new TypeError(
        "Ready preview admission profile does not exactly match its document.",
      );
    }
  }
  const expectedOperation = assembleTechnicalCompilationAdmissionOperation({
    basis: {
      kind: "thread-snapshot",
      snapshotId: admission.basis.thread.snapshotId,
      revision: admission.basis.thread.revision,
      subjectId: admission.basis.thread.subjectId,
    },
    sysmlArtifactId: admission.basis.sysml.artifactId,
  });
  if (deterministicJson(value.operation) !== deterministicJson(expectedOperation)) {
    throw new TypeError("Ready preview operation is foreign or mismatched.");
  }
}
