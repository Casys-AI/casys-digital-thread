import type {
  TechnicalCompilationPreviewEvidence,
  TechnicalCompilationPreviewEvidenceReference,
  TechnicalCompilationPreviewEvidenceStore,
} from "../../../application/ports/out/compile/admission/technical-compilation-preview-evidence-store.ts";
import { TECHNICAL_COMPILATION_PREVIEW_EVIDENCE_REFERENCE_SCHEMA } from "../../../application/ports/out/compile/admission/technical-compilation-preview-evidence-store.ts";
import { validateTechnicalCompilationDocument } from "../../../domain/compile/admission/technical-compilation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { exactRecord, safeId } from "../../../domain/kernel/case-validation.ts";
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
  const r = exactRecord(x.result, [
    "status",
    "document",
    "fingerprint",
    "gaps",
    "draft",
    "decisionParameters",
    "operation",
  ], "$evidence.result");
  if (
    r.status !== "ready-for-review" && r.status !== "unresolved" &&
    r.status !== "rejected"
  ) throw new TypeError("Invalid preview status.");
  const document = await validateTechnicalCompilationDocument(r.document);
  if (document.basis.thread.projectId !== projectId) {
    throw new TypeError("Foreign preview evidence.");
  }
  return {
    schemaVersion: "technical-compilation-preview-evidence/1.0",
    projectId,
    result: x.result as TechnicalCompilationPreviewEvidence["result"],
  };
}
