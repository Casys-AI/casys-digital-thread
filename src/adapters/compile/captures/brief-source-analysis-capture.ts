/**
 * Passive capture of one canonical project-brief revision and its local facts.
 * It is deliberately outside admission and execution: the returned reference
 * is proof-addressable data, not authority to run a provider operation.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { exactRecord, safeId } from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { ProjectBriefRevision } from "../../../domain/project/project-brief.ts";
import {
  type BriefSourceAnalysisReference,
  briefSourceIdFor,
  validateBriefSourceAnalysisReference,
} from "../../../domain/compile/brief/brief-source-analysis-reference.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisAnalyzer,
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import type { SourceAnalysisFrontendRegistry } from "../../../domain/compile/source/source-analysis-frontend-registry.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";

export const BRIEF_SOURCE_CAPTURE_SCHEMA = "brief-source-capture/1.0" as const;

/** Exact brief bytes that were supplied to the local analysis frontend. */
export interface BriefSourceCapture {
  readonly schemaVersion: typeof BRIEF_SOURCE_CAPTURE_SCHEMA;
  readonly kind: "brief-source";
  readonly briefId: string;
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly sourceText: string;
  readonly sourceFingerprint: ContentFingerprint;
}

/** Content-addressed handle for the captured brief and its analysis bundle. */
export type { BriefSourceAnalysisReference } from "../../../domain/compile/brief/brief-source-analysis-reference.ts";

export interface BriefSourceAnalysisCaptureDependencies {
  readonly sourceCaptures: FileCaptureStore<"brief-source-capture">;
  readonly analysisCaptures: FileCaptureStore<"source-analysis">;
  /** Registry owned by the composition root, exact on analyzer id + version. */
  readonly frontends: SourceAnalysisFrontendRegistry;
  /** The reviewed frontend used for new brief captures in this deployment. */
  readonly analyzer: SourceAnalysisAnalyzer;
}

/** Reader dependencies required to verify one sealed brief analysis on replay. */
export interface BriefSourceAnalysisReaders {
  readonly sourceCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly analysisCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly frontends: SourceAnalysisFrontendRegistry;
}

export type BriefSourceAnalysisCaptureErrorCode =
  | "source_capture_readback_failed"
  | "analysis_identity_mismatch"
  | "analysis_capture_readback_failed"
  | "analysis_rejected";

export class BriefSourceAnalysisCaptureError extends Error {
  constructor(
    readonly code: BriefSourceAnalysisCaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BriefSourceAnalysisCaptureError";
  }
}

export class BriefSourceAnalysisCaptureService {
  readonly #sourceCaptures: FileCaptureStore<"brief-source-capture">;
  readonly #analysisCaptures: FileCaptureStore<"source-analysis">;
  readonly #frontends: SourceAnalysisFrontendRegistry;
  readonly #analyzer: SourceAnalysisAnalyzer;

  constructor(dependencies: BriefSourceAnalysisCaptureDependencies) {
    this.#sourceCaptures = dependencies.sourceCaptures;
    this.#analysisCaptures = dependencies.analysisCaptures;
    this.#frontends = dependencies.frontends;
    this.#analyzer = Object.freeze({
      id: safeId(dependencies.analyzer.id, "$dependencies.analyzer.id"),
      version: requireAnalyzerVersion(dependencies.analyzer.version),
    });
    // Resolve at construction time. A deployment must never begin a fresh
    // capture with a supposedly current but unregistered parser version.
    this.#frontends.require(this.#analyzer);
  }

  async capture(
    input: { readonly brief: ProjectBriefRevision },
  ): Promise<BriefSourceAnalysisReference> {
    const brief = input.brief;
    const briefId = safeId(brief.briefId, "$brief.briefId");
    const briefSnapshotId = safeId(brief.id, "$brief.id");
    const briefRevision = requireRevision(brief.revision);
    const sourceId = await briefSourceIdFor(briefId, briefSnapshotId, briefRevision);
    const sourceText = deterministicJson(brief);
    const sourceFingerprint = await fingerprintUtf8(sourceText);
    const sourceCapture: BriefSourceCapture = {
      schemaVersion: BRIEF_SOURCE_CAPTURE_SCHEMA,
      kind: "brief-source",
      briefId,
      briefSnapshotId,
      briefRevision,
      sourceText,
      sourceFingerprint,
    };
    const sourceCaptureFingerprint = await sha256Fingerprint(sourceCapture);
    const sourceCaptureText = deterministicJson(sourceCapture);
    await this.#sourceCaptures.save(sourceCaptureFingerprint, sourceCaptureText);
    const persistedSourceCapture = await this.#sourceCaptures.read(
      sourceCaptureFingerprint,
    );
    if (persistedSourceCapture !== sourceCaptureText) {
      throw new BriefSourceAnalysisCaptureError(
        "source_capture_readback_failed",
        "Brief source capture was not durably readable before analysis.",
      );
    }
    try {
      await validateBriefSourceCapture(JSON.parse(persistedSourceCapture));
    } catch (error) {
      throw new BriefSourceAnalysisCaptureError(
        "source_capture_readback_failed",
        `Brief source capture failed exact readback validation: ${errorMessage(error)}`,
      );
    }

    const rawBundle = await this.#frontends.require(this.#analyzer).analyze({
      sourceId,
      role: "brief",
      language: "plain-text",
      sourceText,
    });
    const bundle = validateSourceAnalysisBundle(rawBundle);
    assertExactBundleSource(bundle, sourceId, sourceFingerprint, this.#analyzer);
    const analysisFingerprint = await fingerprintSourceAnalysisBundle(bundle);
    const analysisText = deterministicJson(bundle);
    await this.#analysisCaptures.save(analysisFingerprint, analysisText);
    if (await this.#analysisCaptures.read(analysisFingerprint) !== analysisText) {
      throw new BriefSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        "Brief source analysis was not durably readable after capture.",
      );
    }
    if (bundle.policy.status === "rejected") {
      throw new BriefSourceAnalysisCaptureError(
        "analysis_rejected",
        `Brief source analysis rejected ${sourceId}; the persisted analysis fingerprint is ${analysisFingerprint.digest}.`,
      );
    }
    const reference = Object.freeze({
      briefId,
      briefSnapshotId,
      briefRevision,
      sourceId,
      sourceFingerprint,
      sourceCaptureFingerprint,
      analysisFingerprint,
    });
    try {
      await requireBriefSourceAnalysis(reference, {
        sourceCaptures: this.#sourceCaptures,
        analysisCaptures: this.#analysisCaptures,
        frontends: this.#frontends,
      });
    } catch (error) {
      throw new BriefSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        `Brief source analysis could not be exactly replayed after capture: ${
          errorMessage(error)
        }`,
      );
    }
    return reference;
  }
}

/** Strictly parse a persisted source envelope for later read-only replay. */
export async function validateBriefSourceCapture(
  value: unknown,
): Promise<BriefSourceCapture> {
  const capture = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "briefId",
      "briefSnapshotId",
      "briefRevision",
      "sourceText",
      "sourceFingerprint",
    ],
    "$briefSourceCapture",
  );
  if (capture.schemaVersion !== BRIEF_SOURCE_CAPTURE_SCHEMA) {
    throw new TypeError("unsupported brief source capture schema");
  }
  if (capture.kind !== "brief-source") {
    throw new TypeError("brief source capture kind must be brief-source");
  }
  const sourceText = requireSourceText(capture.sourceText);
  const parsed = JSON.parse(sourceText);
  if (deterministicJson(parsed) !== capture.sourceText) {
    throw new TypeError("brief source capture sourceText is not canonical JSON");
  }
  const briefId = safeId(capture.briefId, "$briefSourceCapture.briefId");
  const briefSnapshotId = safeId(
    capture.briefSnapshotId,
    "$briefSourceCapture.briefSnapshotId",
  );
  const briefRevision = requireRevision(capture.briefRevision);
  const sourceFingerprint = parseFingerprint(
    capture.sourceFingerprint,
    "$briefSourceCapture.sourceFingerprint",
  );
  const recomputedSourceFingerprint = await fingerprintUtf8(sourceText);
  if (
    recomputedSourceFingerprint.algorithm !== sourceFingerprint.algorithm ||
    recomputedSourceFingerprint.digest !== sourceFingerprint.digest
  ) {
    throw new TypeError(
      "brief source capture sourceFingerprint does not match sourceText bytes",
    );
  }
  const parsedBrief = exactRecord(
    parsed,
    Object.hasOwn(parsed as object, "contractVersion")
      ? [
        "contractVersion",
        "briefId",
        "id",
        "revision",
        "items",
        "proposedAt",
        "proposedBy",
        ...(Object.hasOwn(parsed as object, "previous") ? ["previous"] : []),
      ]
      : [
        "briefId",
        "id",
        "revision",
        "items",
        "proposedAt",
        "proposedBy",
        ...(Object.hasOwn(parsed as object, "previous") ? ["previous"] : []),
      ],
    "$briefSourceCapture.sourceText",
  );
  if (
    parsedBrief.briefId !== briefId || parsedBrief.id !== briefSnapshotId ||
    parsedBrief.revision !== briefRevision
  ) {
    throw new TypeError(
      "brief source capture metadata does not match its canonical brief bytes",
    );
  }
  return Object.freeze({
    schemaVersion: BRIEF_SOURCE_CAPTURE_SCHEMA,
    kind: "brief-source",
    briefId,
    briefSnapshotId,
    briefRevision,
    sourceText,
    sourceFingerprint,
  });
}

function assertExactBundleSource(
  bundle: SourceAnalysisBundle,
  sourceId: string,
  sourceFingerprint: ContentFingerprint,
  analyzer: SourceAnalysisAnalyzer,
): void {
  if (
    bundle.source.id !== sourceId || bundle.source.role !== "brief" ||
    bundle.source.language !== "plain-text" ||
    bundle.source.fingerprint.algorithm !== sourceFingerprint.algorithm ||
    bundle.source.fingerprint.digest !== sourceFingerprint.digest
  ) {
    throw new BriefSourceAnalysisCaptureError(
      "analysis_identity_mismatch",
      "Brief source analysis does not name the exact captured canonical brief.",
    );
  }
  if (
    bundle.analyzer.id !== analyzer.id ||
    bundle.analyzer.version !== analyzer.version
  ) {
    throw new BriefSourceAnalysisCaptureError(
      "analysis_identity_mismatch",
      "Brief source analysis does not name the exact registered analyzer version.",
    );
  }
}

/**
 * Reopen one sealed brief source-analysis reference and recompute its exact
 * local facts with the parser version named by the persisted bundle.
 *
 * This is deliberately shared by execution and completion validation so no
 * replay path can silently construct the current ProjectBriefSourceAnalyzer.
 */
export async function requireBriefSourceAnalysis(
  reference: BriefSourceAnalysisReference,
  readers: BriefSourceAnalysisReaders,
): Promise<{
  readonly reference: BriefSourceAnalysisReference;
  readonly source: BriefSourceCapture;
  readonly bundle: SourceAnalysisBundle;
}> {
  const sealed = validateBriefSourceAnalysisReference(reference);
  const sourceText = await readers.sourceCaptures.read(
    sealed.sourceCaptureFingerprint,
  );
  if (sourceText === undefined) {
    throw new TypeError("Brief source capture is not durably readable after capture.");
  }
  const source = await validateBriefSourceCapture(JSON.parse(sourceText));
  const sourceCaptureFingerprint = await sha256Fingerprint(source);
  if (
    deterministicJson(source) !== sourceText ||
    source.briefId !== sealed.briefId ||
    source.briefSnapshotId !== sealed.briefSnapshotId ||
    source.briefRevision !== sealed.briefRevision ||
    !sameFingerprint(source.sourceFingerprint, sealed.sourceFingerprint) ||
    !sameFingerprint(sourceCaptureFingerprint, sealed.sourceCaptureFingerprint) ||
    sealed.sourceId !== await briefSourceIdFor(
        sealed.briefId,
        sealed.briefSnapshotId,
        sealed.briefRevision,
      )
  ) {
    throw new TypeError(
      "Brief source capture does not exactly match its source-analysis reference.",
    );
  }
  const observedSourceFingerprint = await fingerprintUtf8(source.sourceText);
  if (!sameFingerprint(observedSourceFingerprint, source.sourceFingerprint)) {
    throw new TypeError(
      "Brief source capture sourceText does not match its embedded UTF-8 fingerprint.",
    );
  }

  const analysisText = await readers.analysisCaptures.read(sealed.analysisFingerprint);
  if (analysisText === undefined) {
    throw new TypeError("Brief source analysis is not durably readable after capture.");
  }
  const bundle = validateSourceAnalysisBundle(JSON.parse(analysisText));
  const frontend = readers.frontends.require(bundle.analyzer);
  const recomputed = validateSourceAnalysisBundle(
    await frontend.analyze({
      sourceId: sealed.sourceId,
      role: "brief",
      language: "plain-text",
      sourceText: source.sourceText,
    }),
  );
  const analysisFingerprint = await fingerprintSourceAnalysisBundle(bundle);
  if (
    deterministicJson(bundle) !== analysisText ||
    deterministicJson(recomputed) !== analysisText ||
    !sameFingerprint(analysisFingerprint, sealed.analysisFingerprint) ||
    bundle.source.id !== sealed.sourceId ||
    bundle.source.role !== "brief" ||
    bundle.source.language !== "plain-text" ||
    !sameFingerprint(bundle.source.fingerprint, sealed.sourceFingerprint) ||
    bundle.policy.status !== "passed"
  ) {
    throw new TypeError(
      "Brief source analysis does not exactly match its sealed source and fingerprint.",
    );
  }
  return Object.freeze({ reference: sealed, source, bundle });
}

function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError("$brief.revision must be a positive integer.");
  }
  return Number(value);
}

function requireAnalyzerVersion(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("$dependencies.analyzer.version must be non-empty.");
  }
  return value;
}

function requireSourceText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Brief sourceText must be a non-empty string.");
  }
  return value;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  if (
    fingerprint.algorithm !== "sha256" || typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path} must be a canonical SHA-256 fingerprint`);
  }
  return Object.freeze({ algorithm: "sha256", digest: fingerprint.digest });
}

async function fingerprintUtf8(text: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}

function sameFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
