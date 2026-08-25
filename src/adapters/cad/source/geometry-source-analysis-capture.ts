/**
 * Passive, pre-provider capture of one native build123d source and its analysis.
 *
 * A geometry preview may execute agent-proposed Python only after the exact source
 * bytes and the source-local analysis have been captured. This adapter deliberately
 * has no MCP client, no decision authority, and no ThreadSnapshot dependency.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import type { SourceAnalysisFrontend } from "../../../domain/compile/source/source-analysis-frontend.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  type GeometrySourceAnalysisReference,
  geometrySourceIdFor,
  type GeometrySourceSelector,
  parseGeometrySourceAnalysisReference,
  parseGeometrySourceSelector,
} from "../../../domain/cad/source/geometry-source-analysis-reference.ts";

export const GEOMETRY_SOURCE_CAPTURE_SCHEMA = "geometry-source-capture/1.0" as const;

/** Immutable source envelope retained before the local frontend observes it. */
export interface GeometrySourceCapture {
  readonly schemaVersion: typeof GEOMETRY_SOURCE_CAPTURE_SCHEMA;
  readonly kind: "geometry-source";
  readonly sourceId: string;
  readonly selector: GeometrySourceSelector;
  readonly sourceText: string;
  readonly sourceFingerprint: ContentFingerprint;
}

export interface GeometrySourceAnalysisCaptureDependencies {
  /** CAS envelope with the exact UTF-8 CAD source submitted to the frontend. */
  readonly sourceCaptures: FileCaptureStore<"geometry-source">;
  /** CAS bundle with the validated, canonical source-analysis JSON. */
  readonly analysisCaptures: FileCaptureStore<"source-analysis">;
  /** Server-fixed local parser frontend. It receives no hash supplied by a caller. */
  readonly frontend: SourceAnalysisFrontend;
}

export type GeometrySourceAnalysisCaptureErrorCode =
  | "source_capture_readback_failed"
  | "analysis_identity_mismatch"
  | "analysis_capture_readback_failed"
  | "analysis_rejected"
  | "source_reference_invalid"
  | "source_capture_invalid"
  | "analysis_capture_invalid";

export class GeometrySourceAnalysisCaptureError extends Error {
  constructor(
    readonly code: GeometrySourceAnalysisCaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeometrySourceAnalysisCaptureError";
  }
}

/**
 * Capture exact native CAD text, then analyse that same text and capture the
 * canonical result. The order is intentional: an analyser never receives a
 * source that was not already durably addressable by its exact bytes.
 */
export class GeometrySourceAnalysisCaptureService {
  readonly #sourceCaptures: FileCaptureStore<"geometry-source">;
  readonly #analysisCaptures: FileCaptureStore<"source-analysis">;
  readonly #frontend: SourceAnalysisFrontend;

  constructor(dependencies: GeometrySourceAnalysisCaptureDependencies) {
    this.#sourceCaptures = dependencies.sourceCaptures;
    this.#analysisCaptures = dependencies.analysisCaptures;
    this.#frontend = dependencies.frontend;
  }

  async capture(input: {
    readonly selector: GeometrySourceSelector;
    readonly sourceText: string;
  }): Promise<GeometrySourceAnalysisReference> {
    const selector = normalizeSelector(input.selector);
    const sourceText = requireSourceText(input.sourceText);
    const sourceId = await geometrySourceIdFor(selector);
    const sourceFingerprint = await fingerprintUtf8(sourceText);
    const sourceCapture: GeometrySourceCapture = {
      schemaVersion: GEOMETRY_SOURCE_CAPTURE_SCHEMA,
      kind: "geometry-source",
      sourceId,
      selector,
      sourceText,
      sourceFingerprint,
    };
    const sourceCaptureFingerprint = await sha256Fingerprint(sourceCapture);
    const sourceCaptureText = deterministicJson(sourceCapture);
    await this.#sourceCaptures.save(sourceCaptureFingerprint, sourceCaptureText);
    if (
      await this.#sourceCaptures.read(sourceCaptureFingerprint) !== sourceCaptureText
    ) {
      throw new GeometrySourceAnalysisCaptureError(
        "source_capture_readback_failed",
        "Geometry source capture was not durably readable before analysis.",
      );
    }

    const rawBundle = await this.#frontend.analyze({
      sourceId,
      role: "cad-script",
      language: "python",
      sourceText,
    });
    const bundle = validateSourceAnalysisBundle(rawBundle);
    assertExactBundleSource(bundle, sourceId, sourceFingerprint);
    const analysisFingerprint = await fingerprintSourceAnalysisBundle(bundle);
    const analysisText = deterministicJson(bundle);
    await this.#analysisCaptures.save(analysisFingerprint, analysisText);
    if (await this.#analysisCaptures.read(analysisFingerprint) !== analysisText) {
      throw new GeometrySourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        "Geometry source analysis was not durably readable after capture.",
      );
    }
    if (bundle.policy.status === "rejected") {
      throw new GeometrySourceAnalysisCaptureError(
        "analysis_rejected",
        `Geometry source analysis rejected ${sourceId}; the persisted analysis fingerprint is ${analysisFingerprint.digest}.`,
      );
    }
    return Object.freeze({
      sourceId,
      selector,
      sourceFingerprint,
      sourceCaptureFingerprint,
      analysisFingerprint,
    });
  }
}

/** Exact records reopened by a later seal or replay. */
export interface VerifiedGeometrySourceAnalysis {
  readonly reference: GeometrySourceAnalysisReference;
  readonly source: GeometrySourceCapture;
  readonly analysis: SourceAnalysisBundle;
}

/**
 * Reopen and revalidate every byte named by a draft analysis reference.
 *
 * A reference is only a lookup key. This reader proves the source envelope,
 * its embedded source-byte digest, the canonical analysis bundle, and their
 * shared source identity before returning anything to a sealing executor.
 */
export async function requireGeometrySourceAnalysis(
  value: unknown,
  dependencies: Pick<
    GeometrySourceAnalysisCaptureDependencies,
    "sourceCaptures" | "analysisCaptures"
  >,
): Promise<VerifiedGeometrySourceAnalysis> {
  let reference: GeometrySourceAnalysisReference;
  try {
    reference = await parseGeometrySourceAnalysisReference(value);
  } catch (error) {
    throw new GeometrySourceAnalysisCaptureError(
      "source_reference_invalid",
      `Geometry source-analysis reference is invalid: ${errorMessage(error)}`,
    );
  }

  let sourceText: string | undefined;
  try {
    sourceText = await dependencies.sourceCaptures.read(
      reference.sourceCaptureFingerprint,
    );
  } catch (error) {
    throw new GeometrySourceAnalysisCaptureError(
      "source_capture_invalid",
      `Geometry source capture failed content-addressed readback: ${
        errorMessage(error)
      }`,
    );
  }
  if (sourceText === undefined) {
    throw new GeometrySourceAnalysisCaptureError(
      "source_capture_invalid",
      "Geometry source capture is not durably readable.",
    );
  }

  let source: GeometrySourceCapture;
  try {
    source = parseSourceCapture(JSON.parse(sourceText));
    if (deterministicJson(source) !== sourceText) {
      throw new TypeError("source capture is not canonical JSON");
    }
    const observedSourceFingerprint = await fingerprintUtf8(source.sourceText);
    if (!sameFingerprint(observedSourceFingerprint, source.sourceFingerprint)) {
      throw new TypeError("embedded source fingerprint does not name sourceText");
    }
    if (
      source.sourceId !== reference.sourceId ||
      deterministicJson(source.selector) !== deterministicJson(reference.selector) ||
      !sameFingerprint(source.sourceFingerprint, reference.sourceFingerprint)
    ) {
      throw new TypeError("source capture does not match the draft reference");
    }
  } catch (error) {
    throw new GeometrySourceAnalysisCaptureError(
      "source_capture_invalid",
      `Geometry source capture is invalid: ${errorMessage(error)}`,
    );
  }

  let analysisText: string | undefined;
  try {
    analysisText = await dependencies.analysisCaptures.read(
      reference.analysisFingerprint,
    );
  } catch (error) {
    throw new GeometrySourceAnalysisCaptureError(
      "analysis_capture_invalid",
      `Geometry source analysis failed content-addressed readback: ${
        errorMessage(error)
      }`,
    );
  }
  if (analysisText === undefined) {
    throw new GeometrySourceAnalysisCaptureError(
      "analysis_capture_invalid",
      "Geometry source analysis is not durably readable.",
    );
  }

  let analysis: SourceAnalysisBundle;
  try {
    analysis = validateSourceAnalysisBundle(JSON.parse(analysisText));
    if (deterministicJson(analysis) !== analysisText) {
      throw new TypeError("analysis capture is not canonical JSON");
    }
    assertExactBundleSource(
      analysis,
      reference.sourceId,
      reference.sourceFingerprint,
    );
    if (analysis.policy.status !== "passed") {
      throw new TypeError("analysis policy is not passed");
    }
  } catch (error) {
    throw new GeometrySourceAnalysisCaptureError(
      "analysis_capture_invalid",
      `Geometry source analysis is invalid: ${errorMessage(error)}`,
    );
  }

  return Object.freeze({ reference, source, analysis });
}

function normalizeSelector(selector: GeometrySourceSelector): GeometrySourceSelector {
  return parseGeometrySourceSelector(selector);
}

function parseSourceCapture(value: unknown): GeometrySourceCapture {
  const source = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "sourceId",
      "selector",
      "sourceText",
      "sourceFingerprint",
    ],
    "$geometrySourceCapture",
  );
  if (source.schemaVersion !== GEOMETRY_SOURCE_CAPTURE_SCHEMA) {
    throw new TypeError("unsupported geometry source capture schema");
  }
  if (source.kind !== "geometry-source") {
    throw new TypeError("geometry source capture kind must be geometry-source");
  }
  return Object.freeze({
    schemaVersion: GEOMETRY_SOURCE_CAPTURE_SCHEMA,
    kind: "geometry-source",
    sourceId: requireSafeId(source.sourceId, "$geometrySourceCapture.sourceId"),
    selector: parseGeometrySourceSelector(
      source.selector,
      "$geometrySourceCapture.selector",
    ),
    sourceText: requireSourceText(source.sourceText),
    sourceFingerprint: parseFingerprint(
      source.sourceFingerprint,
      "$geometrySourceCapture.sourceFingerprint",
    ),
  });
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  if (
    fingerprint.algorithm !== "sha256" ||
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path} must be a canonical SHA-256 fingerprint`);
  }
  return Object.freeze({ algorithm: "sha256", digest: fingerprint.digest });
}

function requireSafeId(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${path} must be a safe id`);
  }
  return value;
}

function requireSourceText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Geometry sourceText must be a non-empty string.");
  }
  return value;
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

function assertExactBundleSource(
  bundle: SourceAnalysisBundle,
  sourceId: string,
  sourceFingerprint: ContentFingerprint,
): void {
  if (
    bundle.source.id !== sourceId ||
    bundle.source.role !== "cad-script" ||
    bundle.source.language !== "python" ||
    bundle.source.fingerprint.algorithm !== sourceFingerprint.algorithm ||
    bundle.source.fingerprint.digest !== sourceFingerprint.digest
  ) {
    throw new GeometrySourceAnalysisCaptureError(
      "analysis_identity_mismatch",
      "Geometry source analysis does not name the exact captured Python CAD source.",
    );
  }
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
