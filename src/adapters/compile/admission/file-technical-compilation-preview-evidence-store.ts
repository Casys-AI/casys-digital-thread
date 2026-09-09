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
  const fp = x.fingerprint as any;
  if (
    !fp || fp.algorithm !== "sha256" || typeof fp.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fp.digest)
  ) throw new TypeError("Invalid preview evidence fingerprint.");
  return {
    schemaVersion: TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
    projectId: safeId(x.projectId, "$ref.projectId"),
    fingerprint: { algorithm: "sha256", digest: fp.digest },
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
    safeId(draft.draftId, "$evidence.result.draft.draftId") === "" ||
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
  for (const [index, parameter] of value.decisionParameters.entries()) {
    const record = exactRecord(
      parameter,
      ["key", "label", "value"],
      `$evidence.result.decisionParameters[${index}]`,
    );
    safeId(record.key, `$evidence.result.decisionParameters[${index}].key`);
    if (
      typeof record.label !== "string" || record.label.length === 0 ||
      (typeof record.value !== "string" && typeof record.value !== "number" &&
        typeof record.value !== "boolean") ||
      (typeof record.value === "number" && !Number.isFinite(record.value))
    ) {
      throw new TypeError("Ready preview decision parameter is invalid.");
    }
  }
  const operation = exactRecord(
    value.operation,
    ["id", "version", "bindings"],
    "$evidence.result.operation",
  );
  if (
    operation.id !== "compile.seal-admission" || operation.version !== "3" ||
    !Array.isArray(operation.bindings) || operation.bindings.length !== 1
  ) throw new TypeError("Ready preview operation is invalid.");
  const binding = exactRecord(
    operation.bindings[0],
    ["name", "source"],
    "$evidence.result.operation.bindings[0]",
  );
  const source = exactRecord(
    binding.source,
    ["kind", "reference"],
    "$evidence.result.operation.bindings[0].source",
  );
  const reference = exactRecord(
    source.reference,
    ["snapshotId", "snapshotRevision", "kind", "id"],
    "$evidence.result.operation.bindings[0].source.reference",
  );
  if (
    binding.name !== "sysmlModel" || source.kind !== "thread-entity" ||
    reference.kind !== "artifact" ||
    reference.snapshotId !== document.basis.thread.snapshotId ||
    reference.snapshotRevision !== document.basis.thread.revision ||
    reference.id !== document.basis.sysmlAnchor.artifactId
  ) throw new TypeError("Ready preview operation is foreign or mismatched.");
}
