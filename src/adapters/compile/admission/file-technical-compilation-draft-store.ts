/** Content-addressed persistence for reviewable technical-compilation drafts. */

import {
  TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
  type TechnicalCompilationDraft,
  type TechnicalCompilationDraftReference,
  type TechnicalCompilationDraftStore,
} from "../../../application/ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  validateTechnicalCompilationDocument,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";

export class FileTechnicalCompilationDraftStore
  implements TechnicalCompilationDraftStore {
  readonly #bytes: FileByteStore<"technical-compilation-draft">;

  constructor(bytes: FileByteStore<"technical-compilation-draft">) {
    this.#bytes = bytes;
  }

  async save(
    referenceValue: TechnicalCompilationDraftReference,
    draftValue: TechnicalCompilationDraft,
  ): Promise<TechnicalCompilationDraftReference> {
    const reference = parseReference(referenceValue);
    const draft = await parseDraft(draftValue);
    await assertReferenceMatchesDraft(reference, draft);
    const text = deterministicJson(draft);
    const receipt = await this.#bytes.save(
      reference.envelopeFingerprint,
      new TextEncoder().encode(text),
    );
    if (
      !fingerprintsEqual(receipt.fingerprint, reference.envelopeFingerprint) ||
      receipt.byteCount !== new TextEncoder().encode(text).byteLength
    ) {
      throw new TypeError(
        "Technical compilation draft store returned a foreign receipt.",
      );
    }
    const reopened = await this.read(reference);
    if (reopened === undefined || deterministicJson(reopened) !== text) {
      throw new TypeError("Technical compilation draft failed exact save readback.");
    }
    return reference;
  }

  async read(
    referenceValue: TechnicalCompilationDraftReference,
  ): Promise<TechnicalCompilationDraft | undefined> {
    const reference = parseReference(referenceValue);
    const stored = await this.#bytes.read(reference.envelopeFingerprint);
    if (stored === undefined) return undefined;
    const text = decodeExactUtf8(stored.copy());
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (cause) {
      throw new TypeError("Technical compilation draft is not JSON.", { cause });
    }
    const draft = await parseDraft(value);
    if (deterministicJson(draft) !== text) {
      throw new TypeError("Technical compilation draft is not canonical JSON.");
    }
    await assertReferenceMatchesDraft(reference, draft);
    return draft;
  }
}

function parseReference(value: unknown): TechnicalCompilationDraftReference {
  const reference = exactRecord(
    value,
    [
      "schemaVersion",
      "draftId",
      "projectId",
      "documentFingerprint",
      "envelopeFingerprint",
    ],
    "$technicalCompilationDraftReference",
  );
  literalValue(
    reference.schemaVersion,
    TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    "$technicalCompilationDraftReference.schemaVersion",
  );
  const projectId = safeId(
    reference.projectId,
    "$technicalCompilationDraftReference.projectId",
  );
  const documentFingerprint = parseFingerprint(
    reference.documentFingerprint,
    "$technicalCompilationDraftReference.documentFingerprint",
  );
  const envelopeFingerprint = parseFingerprint(
    reference.envelopeFingerprint,
    "$technicalCompilationDraftReference.envelopeFingerprint",
  );
  const draftId = nonEmptyText(
    reference.draftId,
    "$technicalCompilationDraftReference.draftId",
  );
  if (
    draftId !==
      `technical-compilation:${projectId}:${documentFingerprint.digest}`
  ) {
    throw new TypeError(
      "Technical compilation draft id does not match its project and document fingerprint.",
    );
  }
  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId,
    projectId,
    documentFingerprint,
    envelopeFingerprint,
  });
}

async function parseDraft(value: unknown): Promise<TechnicalCompilationDraft> {
  const envelope = exactRecord(
    value,
    ["projectId", "document", "fingerprint", "sourceCaptures"],
    "$technicalCompilationDraft",
  );
  const projectId = safeId(
    envelope.projectId,
    "$technicalCompilationDraft.projectId",
  );
  const document = await validateTechnicalCompilationDocument(envelope.document);
  if (document.status !== "ready-for-review") {
    throw new TypeError(
      "Only ready-for-review technical compilations may be persisted as drafts.",
    );
  }
  if (document.basis.thread.projectId !== projectId) {
    throw new TypeError(
      "Technical compilation draft project does not match its Thread basis.",
    );
  }
  const fingerprint = parseFingerprint(
    envelope.fingerprint,
    "$technicalCompilationDraft.fingerprint",
  );
  const observed = await sha256Fingerprint(document);
  if (!fingerprintsEqual(observed, fingerprint)) {
    throw new TypeError(
      "Technical compilation draft fingerprint does not match its document.",
    );
  }
  const sourceCaptures = await Promise.all(
    arrayOf(
      envelope.sourceCaptures,
      "$technicalCompilationDraft.sourceCaptures",
    ).map((item, index) =>
      parseSourceCapture(
        item,
        `$technicalCompilationDraft.sourceCaptures[${index}]`,
      )
    ),
  );
  sourceCaptures.sort(compareSourceCaptures);
  rejectDuplicates(
    sourceCaptures.map((capture) => capture.sourceId),
    "$technicalCompilationDraft.sourceCaptures source ids",
  );
  rejectDuplicates(
    sourceCaptures.map((capture) => capture.referenceFingerprint.digest),
    "$technicalCompilationDraft.sourceCaptures reference fingerprints",
  );
  const expectedSourceIds = document.inputManifest.sources
    .map((source) => source.analysis.source.id)
    .sort(compareText);
  if (
    expectedSourceIds.length !== sourceCaptures.length ||
    expectedSourceIds.some((sourceId, index) =>
      sourceId !== sourceCaptures[index].sourceId
    )
  ) {
    throw new TypeError(
      "Technical compilation draft source captures must exactly cover its input manifest.",
    );
  }
  return deepFreeze({ projectId, document, fingerprint, sourceCaptures });
}

async function parseSourceCapture(
  value: unknown,
  path: string,
): Promise<TechnicalCompilationDraft["sourceCaptures"][number]> {
  const capture = exactRecord(
    value,
    ["sourceId", "reference", "referenceFingerprint"],
    path,
  );
  const sourceId = safeId(capture.sourceId, `${path}.sourceId`);
  const reference = validateTechnicalSourceAnalysisCaptureLocator(
    capture.reference,
    `${path}.reference`,
  );
  const referenceFingerprint = parseFingerprint(
    capture.referenceFingerprint,
    `${path}.referenceFingerprint`,
  );
  const observed = await sha256Fingerprint(reference);
  if (!fingerprintsEqual(observed, referenceFingerprint)) {
    throw new TypeError(`${path}.reference fingerprint does not match its content.`);
  }
  return deepFreeze({ sourceId, reference, referenceFingerprint });
}

async function assertReferenceMatchesDraft(
  reference: TechnicalCompilationDraftReference,
  draft: TechnicalCompilationDraft,
): Promise<void> {
  const observedEnvelopeFingerprint = await sha256Fingerprint(draft);
  if (
    reference.projectId !== draft.projectId ||
    !fingerprintsEqual(reference.documentFingerprint, draft.fingerprint) ||
    !fingerprintsEqual(
      reference.envelopeFingerprint,
      observedEnvelopeFingerprint,
    )
  ) {
    throw new TypeError(
      "Technical compilation draft reference does not match its exact envelope.",
    );
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  const digest = safeId(fingerprint.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function decodeExactUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const encoded = new TextEncoder().encode(text);
    if (!bytesEqual(encoded, bytes)) throw new TypeError("UTF-8 round-trip failed.");
    return text;
  } catch (cause) {
    throw new TypeError("Technical compilation draft is not exact UTF-8.", {
      cause,
    });
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index] ^ right[index];
  }
  return different === 0;
}

function compareSourceCaptures(
  left: TechnicalCompilationDraft["sourceCaptures"][number],
  right: TechnicalCompilationDraft["sourceCaptures"][number],
): number {
  return compareText(left.sourceId, right.sourceId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
