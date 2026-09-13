import type {
  BuyCostEstimatePreviewEvidence,
  BuyCostEstimatePreviewEvidenceCursor,
  BuyCostEstimatePreviewEvidenceReference,
  BuyCostEstimatePreviewEvidenceStore,
} from "../../application/ports/out/buy/buy-cost-estimate-preview-evidence-store.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_SCHEMA,
} from "../../application/ports/out/buy/buy-cost-estimate-preview-evidence-store.ts";
import { BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES } from "../../application/ports/in/buy/project-buy-cost-estimate-preview.ts";
import { validateBuyCostBundleV2 } from "../../domain/buy/buy-cost-bundle-v2.ts";
import { validateBuyProductionEstimateBundle } from "../../domain/buy/buy-production-estimate.ts";
import {
  arrayOf,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../domain/kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../domain/kernel/resource-bytes.ts";
import { parseExactThreadSnapshotBasis } from "../../domain/project/thread-tip.ts";
import { parseAgentResourceReference } from "../../domain/resource/agent-resource-reference.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";

export const BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND =
  "buy-cost-estimate-preview-evidence" as const;
export const BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE =
  "buy-cost-estimate-preview-evidence" as const;

const SHA256_HEX = /^[a-f0-9]{64}$/;

export class FileBuyCostEstimatePreviewEvidenceStore
  implements BuyCostEstimatePreviewEvidenceStore {
  constructor(
    private readonly bytes: FileByteStore<
      typeof BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND
    >,
  ) {}

  async save(
    value: BuyCostEstimatePreviewEvidence,
  ): Promise<BuyCostEstimatePreviewEvidenceReference> {
    const evidence = parse(value);
    const text = deterministicJson(evidence);
    const bytes = new TextEncoder().encode(text);
    const fingerprint = {
      algorithm: "sha256" as const,
      digest: await fingerprintResourceBytes(bytes),
    };
    const stored = await this.bytes.save(fingerprint, bytes);
    const reopened = await this.read({
      schemaVersion: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
      projectId: evidence.projectId,
      fingerprint,
      byteCount: stored.byteCount,
    });
    if (!reopened || deterministicJson(reopened) !== text) {
      throw new TypeError("Preview evidence failed exact reread.");
    }
    return {
      schemaVersion: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
      projectId: evidence.projectId,
      fingerprint,
      byteCount: stored.byteCount,
    };
  }

  async read(
    reference: BuyCostEstimatePreviewEvidenceReference,
  ): Promise<BuyCostEstimatePreviewEvidence | undefined> {
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
    const evidence = parse(parsed);
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
    value: BuyCostEstimatePreviewEvidenceCursor,
  ): Promise<string> {
    const record = exactRecord(
      value,
      ["projectId", "fingerprint", "section", "offset"],
      "$cursor",
    );
    if (
      !SHA256_HEX.test(String(record.fingerprint)) ||
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
  ): Promise<BuyCostEstimatePreviewEvidenceCursor | undefined> {
    if (!SHA256_HEX.test(cursor)) {
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
      !SHA256_HEX.test(String(record.fingerprint)) ||
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

function parseRef(
  value: unknown,
): BuyCostEstimatePreviewEvidenceReference {
  const ref = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "fingerprint",
    "byteCount",
  ], "$ref");
  if (
    ref.schemaVersion !== BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA ||
    !Number.isSafeInteger(ref.byteCount) || Number(ref.byteCount) < 1
  ) throw new TypeError("Invalid preview evidence reference.");
  if (ref.fingerprint === null || typeof ref.fingerprint !== "object") {
    throw new TypeError("Invalid preview evidence fingerprint.");
  }
  const fingerprint = ref.fingerprint as Record<string, unknown>;
  if (
    fingerprint.algorithm !== "sha256" || typeof fingerprint.digest !== "string" ||
    !SHA256_HEX.test(fingerprint.digest)
  ) throw new TypeError("Invalid preview evidence fingerprint.");
  return {
    schemaVersion: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA,
    projectId: safeId(ref.projectId, "$ref.projectId"),
    fingerprint: { algorithm: "sha256", digest: fingerprint.digest },
    byteCount: Number(ref.byteCount),
  };
}

function parse(value: unknown): BuyCostEstimatePreviewEvidence {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "basis",
    "candidate",
    "configurationDigest",
    "baseBundleDigest",
    "inputRefs",
    "result",
  ], "$evidence");
  if (root.schemaVersion !== BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_SCHEMA) {
    throw new TypeError("Invalid preview evidence schema.");
  }
  const projectId = safeId(root.projectId, "$evidence.projectId");
  const basis = parseExactThreadSnapshotBasis(root.basis, "$evidence.basis");
  const candidate = exactRecord(
    root.candidate,
    ["artifactId", "digest"],
    "$evidence.candidate",
  );
  const candidateRef = {
    artifactId: safeId(candidate.artifactId, "$evidence.candidate.artifactId"),
    digest: sha256Hex(candidate.digest, "$evidence.candidate.digest"),
  };
  const configurationDigest = sha256Hex(
    root.configurationDigest,
    "$evidence.configurationDigest",
  );
  const baseBundleDigest = sha256Hex(
    root.baseBundleDigest,
    "$evidence.baseBundleDigest",
  );
  const inputRefs = arrayOf(root.inputRefs, "$evidence.inputRefs");
  if (
    inputRefs.length < 1 ||
    inputRefs.length > BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES
  ) {
    throw new TypeError(
      `$evidence.inputRefs must hold 1..${BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES} references.`,
    );
  }
  const parsedRefs = inputRefs.map((ref, i) =>
    parseAgentResourceReference(ref, `$evidence.inputRefs[${i}]`)
  );
  rejectDuplicates(
    parsedRefs.map((ref) => ref.uri),
    "$evidence.inputRefs.uri",
  );
  const result = parseResult(root.result, projectId);
  if (deterministicJson(result.basis) !== deterministicJson(basis)) {
    throw new TypeError("Preview evidence basis must equal its result basis.");
  }
  if (deterministicJson(result.candidate) !== deterministicJson(candidateRef)) {
    throw new TypeError("Preview evidence candidate must equal its result candidate.");
  }
  if (result.configurationDigest !== configurationDigest) {
    throw new TypeError(
      "Preview evidence configuration digest must equal its result digest.",
    );
  }
  const inputUris = new Set(parsedRefs.map((ref) => ref.uri));
  for (const entry of result.estimates) {
    if (!inputUris.has(entry.captureUri)) {
      throw new TypeError(
        "Preview evidence estimate capture URI is not a retained input ref.",
      );
    }
  }
  const estimateUris = new Set(result.estimates.map((entry) => entry.captureUri));
  for (const annex of result.annexes) {
    if (!estimateUris.has(annex.estimateSource.inputCaptureUri)) {
      throw new TypeError(
        "Preview evidence annex capture URI is not a retained estimate.",
      );
    }
  }
  if (result.bundle.configurationRef.digest !== configurationDigest) {
    throw new TypeError(
      "Preview evidence bundle configuration digest does not match.",
    );
  }
  if (result.bundle.baseBundle.digest !== baseBundleDigest) {
    throw new TypeError(
      "Preview evidence base bundle digest does not match its bundle.",
    );
  }
  return {
    schemaVersion: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_SCHEMA,
    projectId,
    basis,
    candidate: candidateRef,
    configurationDigest,
    baseBundleDigest,
    inputRefs: parsedRefs,
    result,
  };
}

function parseResult(
  value: unknown,
  projectId: string,
): BuyCostEstimatePreviewEvidence["result"] {
  const root = exactRecord(value, [
    "status",
    "projectId",
    "basis",
    "candidate",
    "configurationDigest",
    "pricing",
    "estimates",
    "evidence",
    "annexes",
    "bundle",
    "nature",
    "provisional",
    "authority",
    "limits",
  ], "$evidence.result");
  literalValue(root.status, "preview", "$evidence.result.status");
  if (safeId(root.projectId, "$evidence.result.projectId") !== projectId) {
    throw new TypeError("Foreign preview evidence.");
  }
  const basis = parseExactThreadSnapshotBasis(root.basis, "$evidence.result.basis");
  const candidate = exactRecord(
    root.candidate,
    ["artifactId", "digest"],
    "$evidence.result.candidate",
  );
  const pricing = exactRecord(
    root.pricing,
    ["currency", "asOf"],
    "$evidence.result.pricing",
  );
  const estimates = arrayOf(root.estimates, "$evidence.result.estimates").map(
    (entry, i) => parseEstimateEntry(entry, `$evidence.result.estimates[${i}]`),
  );
  const evidence = arrayOf(root.evidence, "$evidence.result.evidence").map(
    (entry, i) => parseEvidenceEntry(entry, `$evidence.result.evidence[${i}]`),
  );
  const bundle = validateBuyCostBundleV2(root.bundle);
  literalValue(root.nature, "documentary", "$evidence.result.nature");
  if (typeof root.provisional !== "boolean") {
    throw new TypeError("$evidence.result.provisional must be a boolean.");
  }
  const authority = exactRecord(
    root.authority,
    ["registeredSeal", "spendingApproval", "qualification"],
    "$evidence.result.authority",
  );
  literalValue(
    authority.registeredSeal,
    "no registered seal executed",
    "$evidence.result.authority.registeredSeal",
  );
  literalValue(
    authority.spendingApproval,
    "none",
    "$evidence.result.authority.spendingApproval",
  );
  literalValue(
    authority.qualification,
    "none",
    "$evidence.result.authority.qualification",
  );
  const limits = exactRecord(
    root.limits,
    ["maxEstimates", "maxBytesPerSource", "acceptedMimeTypes"],
    "$evidence.result.limits",
  );
  return {
    status: "preview",
    projectId,
    basis,
    candidate: {
      artifactId: safeId(candidate.artifactId, "$evidence.result.candidate.artifactId"),
      digest: sha256Hex(candidate.digest, "$evidence.result.candidate.digest"),
    },
    configurationDigest: sha256Hex(
      root.configurationDigest,
      "$evidence.result.configurationDigest",
    ),
    pricing: {
      currency: nonEmptyText(pricing.currency, "$evidence.result.pricing.currency"),
      asOf: nonEmptyText(pricing.asOf, "$evidence.result.pricing.asOf"),
    },
    estimates,
    evidence,
    annexes: arrayOf(root.annexes, "$evidence.result.annexes").map((annex) =>
      validateBuyProductionEstimateBundle(annex)
    ),
    bundle,
    nature: "documentary",
    provisional: root.provisional,
    authority: {
      registeredSeal: "no registered seal executed",
      spendingApproval: "none",
      qualification: "none",
    },
    limits: {
      maxEstimates: positiveInt(
        limits.maxEstimates,
        "$evidence.result.limits.maxEstimates",
      ),
      maxBytesPerSource: positiveInt(
        limits.maxBytesPerSource,
        "$evidence.result.limits.maxBytesPerSource",
      ),
      acceptedMimeTypes: arrayOf(
        limits.acceptedMimeTypes,
        "$evidence.result.limits.acceptedMimeTypes",
      ).map((mime, i) =>
        nonEmptyText(mime, `$evidence.result.limits.acceptedMimeTypes[${i}]`)
      ),
    },
  };
}

function parseEstimateEntry(value: unknown, path: string) {
  const entry = exactRecord(value, [
    "captureUri",
    "digest",
    "estimateId",
    "lineIds",
    "provisionalLineIds",
  ], path);
  const lineIds = arrayOf(entry.lineIds, `${path}.lineIds`).map((id, i) =>
    safeId(id, `${path}.lineIds[${i}]`)
  );
  const provisionalLineIds = arrayOf(
    entry.provisionalLineIds,
    `${path}.provisionalLineIds`,
  ).map((id, i) => safeId(id, `${path}.provisionalLineIds[${i}]`));
  for (const id of provisionalLineIds) {
    if (!lineIds.includes(id)) {
      throw new TypeError(
        `${path}.provisionalLineIds names ${id}, which is not a line.`,
      );
    }
  }
  return {
    captureUri: nonEmptyText(entry.captureUri, `${path}.captureUri`),
    digest: sha256Hex(entry.digest, `${path}.digest`),
    estimateId: safeId(entry.estimateId, `${path}.estimateId`),
    lineIds,
    provisionalLineIds,
  };
}

function parseEvidenceEntry(value: unknown, path: string) {
  const entry = exactRecord(value, [
    "uri",
    "digest",
    "byteCount",
    "mimeType",
    "anchors",
    "observedAts",
  ], path);
  return {
    uri: nonEmptyText(entry.uri, `${path}.uri`),
    digest: sha256Hex(entry.digest, `${path}.digest`),
    byteCount: positiveInt(entry.byteCount, `${path}.byteCount`),
    mimeType: nonEmptyText(entry.mimeType, `${path}.mimeType`),
    anchors: arrayOf(entry.anchors, `${path}.anchors`).map((anchor, i) =>
      nonEmptyText(anchor, `${path}.anchors[${i}]`)
    ),
    observedAts: arrayOf(entry.observedAts, `${path}.observedAts`).map((at, i) =>
      nonEmptyText(at, `${path}.observedAts[${i}]`)
    ),
  };
}

function sha256Hex(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!SHA256_HEX.test(text)) {
    throw new TypeError(`${path} must be lowercase sha256 hex.`);
  }
  return text;
}

function positiveInt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return Number(value);
}
