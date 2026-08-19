/** Passive CAS capture for one server-rendered SysML architecture write. */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { exactRecord, safeId } from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  type ArchitectureProposal,
  parseArchitectureSysmlSelector,
  renderArchitectureSysmlWithManifest,
  type RenderedArchitectureSysml,
  type SysmlArchitectureSourceSelector,
  validateRenderedArchitectureSysml,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  fingerprintSourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  type RenderedArchitectureSysmlAnalysisFrontend,
  sysmlRenderedSourceIdFor,
} from "./rendered-architecture-sysml-analyzer.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";

export const SYSML_SOURCE_CAPTURE_SCHEMA = "sysml-source-capture/1.0" as const;

export interface SysmlSourceOperation {
  readonly id: string;
  readonly version: string;
}

/** Exact byte envelope retained before the analysis frontend sees the source. */
export interface SysmlSourceCapture {
  readonly schemaVersion: typeof SYSML_SOURCE_CAPTURE_SCHEMA;
  readonly kind: "sysml-source";
  readonly sourceId: string;
  readonly selector: SysmlArchitectureSourceSelector;
  readonly runId: string;
  readonly operation: SysmlSourceOperation;
  readonly sourceText: string;
  readonly manifest: RenderedArchitectureSysml["manifest"];
  readonly sourceFingerprint: ContentFingerprint;
}

export interface SysmlSourceAnalysisReference {
  readonly sourceId: string;
  readonly selector: SysmlArchitectureSourceSelector;
  readonly runId: string;
  readonly operation: SysmlSourceOperation;
  readonly sourceFingerprint: ContentFingerprint;
  readonly sourceCaptureFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
}

export interface SysmlSourceAnalysisCaptureDependencies {
  readonly sourceCaptures: FileCaptureStore<"sysml-source-capture">;
  readonly analysisCaptures: FileCaptureStore<"source-analysis">;
  readonly frontend: RenderedArchitectureSysmlAnalysisFrontend;
}

/**
 * Exact records obtained by reopening a sealed rendered SysML source bundle.
 *
 * This is intentionally an adapter-level port: callers learn the precise
 * native bytes that were captured, but the domain remains independent from a
 * filesystem/CAS implementation.
 */
export interface VerifiedSysmlSourceAnalysis {
  readonly reference: SysmlSourceAnalysisReference;
  readonly source: SysmlSourceCapture;
  readonly analysis: ReturnType<typeof validateSourceAnalysisBundle>;
}

/**
 * Read-side capability consumed by authority boundaries after an architecture
 * capture has named current SysML source-analysis evidence.  It is deliberately
 * narrower than the capture service: consumers can prove sealed bytes, but
 * cannot create, replace, or dispatch source material.
 */
export interface SysmlSourceAnalysisReader {
  reopen(value: unknown): Promise<VerifiedSysmlSourceAnalysis>;
}

export class SysmlSourceAnalysisCaptureError extends Error {
  constructor(
    readonly code:
      | "source_capture_readback_failed"
      | "analysis_identity_mismatch"
      | "analysis_capture_readback_failed"
      | "analysis_rejected",
    message: string,
  ) {
    super(message);
    this.name = "SysmlSourceAnalysisCaptureError";
  }
}

/**
 * The returned reference is provenance only. It cannot dispatch anything and
 * deliberately carries the server-fixed run and operation identity it seals.
 */
export class SysmlSourceAnalysisCaptureService {
  constructor(private readonly dependencies: SysmlSourceAnalysisCaptureDependencies) {}

  async capture(input: {
    /** The reviewed proposal; callers cannot smuggle arbitrary source bytes. */
    readonly proposal: ArchitectureProposal;
    readonly selector: SysmlArchitectureSourceSelector;
    readonly runId: string;
    readonly operation: SysmlSourceOperation;
  }): Promise<SysmlSourceAnalysisReference> {
    const selector = parseArchitectureSysmlSelector(
      input.selector,
      "$input.selector",
    );
    const rendered = validateRenderedArchitectureSysml(
      renderArchitectureSysmlWithManifest(input.proposal, selector),
    );
    if (deterministicJson(selector) !== deterministicJson(rendered.manifest.selector)) {
      throw new TypeError(
        "SysML source selector must equal the rendered manifest selector.",
      );
    }
    const runId = safeId(input.runId, "$input.runId");
    const operation = parseOperation(input.operation, "$input.operation");
    const sourceId = await sysmlRenderedSourceIdFor(selector, runId, operation);
    const sourceFingerprint = await fingerprintUtf8(rendered.sourceText);
    const source: SysmlSourceCapture = {
      schemaVersion: SYSML_SOURCE_CAPTURE_SCHEMA,
      kind: "sysml-source",
      sourceId,
      selector,
      runId,
      operation,
      sourceText: rendered.sourceText,
      manifest: rendered.manifest,
      sourceFingerprint,
    };
    const sourceCaptureFingerprint = await sha256Fingerprint(source);
    const sourceCaptureText = deterministicJson(source);
    await this.dependencies.sourceCaptures.save(
      sourceCaptureFingerprint,
      sourceCaptureText,
    );
    const readback = await this.dependencies.sourceCaptures.read(
      sourceCaptureFingerprint,
    );
    if (readback !== sourceCaptureText || !(await sameSource(readback, source))) {
      throw new SysmlSourceAnalysisCaptureError(
        "source_capture_readback_failed",
        "SysML source was not durably readable and exact before analysis.",
      );
    }
    const readbackCapture = await validateSysmlSourceCapture(JSON.parse(readback));
    const bundle = validateSourceAnalysisBundle(
      await this.dependencies.frontend.analyzeRendered({
        sourceId,
        rendered: {
          sourceText: readbackCapture.sourceText,
          manifest: readbackCapture.manifest,
        },
      }),
    );
    if (
      bundle.source.id !== sourceId || bundle.source.role !== "sysml-model" ||
      bundle.source.language !== "sysml-v2" ||
      !sameFingerprint(bundle.source.fingerprint, sourceFingerprint)
    ) {
      throw new SysmlSourceAnalysisCaptureError(
        "analysis_identity_mismatch",
        "SysML analysis does not name the exact captured rendered source.",
      );
    }
    const analysisFingerprint = await fingerprintSourceAnalysisBundle(bundle);
    const analysisText = deterministicJson(bundle);
    await this.dependencies.analysisCaptures.save(analysisFingerprint, analysisText);
    if (
      await this.dependencies.analysisCaptures.read(analysisFingerprint) !==
        analysisText
    ) {
      throw new SysmlSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        "SysML source analysis was not durably readable after capture.",
      );
    }
    if (bundle.policy.status !== "passed") {
      throw new SysmlSourceAnalysisCaptureError(
        "analysis_rejected",
        "SysML source analysis is not eligible as a passed local fact bundle.",
      );
    }
    return Object.freeze({
      sourceId,
      selector,
      runId,
      operation,
      sourceFingerprint,
      sourceCaptureFingerprint,
      analysisFingerprint,
    });
  }

  /** Reopen the exact bytes and analysis used by a previously sealed reference. */
  async reopen(value: unknown): Promise<VerifiedSysmlSourceAnalysis> {
    return await requireSysmlSourceAnalysis(value, this.dependencies);
  }
}

/**
 * Reopen every source-analysis reference sealed by a current architecture
 * capture and bind it to the architecture occurrence which names it.
 *
 * A v3 capture is not usable merely because its JSON has the right shape.  Its
 * source and analysis CAS records must still be exact, approved, and belong to
 * the same architecture run, operation, and package.  Callers retain control
 * over the surrounding artifact/basis checks; this helper protects the shared
 * source-analysis boundary without coupling them to a concrete CAS adapter.
 */
export async function requireCurrentArchitectureSourceAnalyses(
  references: readonly SysmlSourceAnalysisReference[],
  reader: SysmlSourceAnalysisReader,
  expected: {
    readonly runId: string;
    readonly operation: SysmlSourceOperation;
    readonly packageName: string;
  },
): Promise<readonly VerifiedSysmlSourceAnalysis[]> {
  if (references.length === 0) {
    throw new SysmlSourceAnalysisCaptureError(
      "source_capture_readback_failed",
      "A current architecture capture must seal at least one SysML source analysis.",
    );
  }
  const parsed = references.map((reference, index) => {
    const exact = parseReference(
      reference,
      `$architectureCapture.sourceAnalyses[${index}]`,
    );
    if (
      exact.runId !== expected.runId ||
      exact.operation.id !== expected.operation.id ||
      exact.operation.version !== expected.operation.version ||
      selectorPackageName(exact.selector) !== expected.packageName
    ) {
      throw new SysmlSourceAnalysisCaptureError(
        "source_capture_readback_failed",
        "Architecture source-analysis evidence is foreign to its architecture occurrence.",
      );
    }
    return exact;
  });
  const reopened = await Promise.all(
    parsed.map((reference) => reader.reopen(reference)),
  );
  for (let index = 0; index < reopened.length; index++) {
    if (
      deterministicJson(reopened[index]!.reference) !==
        deterministicJson(parsed[index]!)
    ) {
      throw new SysmlSourceAnalysisCaptureError(
        "source_capture_readback_failed",
        "Reopened SysML source-analysis evidence differs from its sealed reference.",
      );
    }
  }
  return Object.freeze(reopened);
}

/**
 * Reopen and prove the exact source and analysis named by a reference.
 *
 * A reference is only an address. This function verifies the CAS envelope
 * fingerprints, canonical encodings, embedded native-source hash, source
 * occurrence identity, and the source identity carried by the analysis. It
 * deliberately does not rerender the proposal: the text returned here is the
 * exact text eligible for a provider write.
 */
export async function requireSysmlSourceAnalysis(
  value: unknown,
  dependencies: Pick<
    SysmlSourceAnalysisCaptureDependencies,
    "sourceCaptures" | "analysisCaptures"
  >,
): Promise<VerifiedSysmlSourceAnalysis> {
  const reference = parseReference(value, "$sysmlSourceAnalysisReference");

  const sourceText = await dependencies.sourceCaptures.read(
    reference.sourceCaptureFingerprint,
  );
  if (sourceText === undefined) {
    throw new SysmlSourceAnalysisCaptureError(
      "source_capture_readback_failed",
      "SysML source capture is not durably readable.",
    );
  }
  let source: SysmlSourceCapture;
  try {
    source = await validateSysmlSourceCapture(JSON.parse(sourceText));
    if (deterministicJson(source) !== sourceText) {
      throw new TypeError("SysML source capture is not canonical JSON.");
    }
    if (
      !sameFingerprint(
        await sha256Fingerprint(source),
        reference.sourceCaptureFingerprint,
      )
    ) {
      throw new TypeError("SysML source capture fingerprint is not exact.");
    }
    if (
      source.sourceId !== reference.sourceId ||
      deterministicJson(source.selector) !== deterministicJson(reference.selector) ||
      source.runId !== reference.runId ||
      deterministicJson(source.operation) !== deterministicJson(reference.operation) ||
      !sameFingerprint(source.sourceFingerprint, reference.sourceFingerprint)
    ) {
      throw new TypeError("SysML source capture does not match its reference.");
    }
  } catch (error) {
    throw new SysmlSourceAnalysisCaptureError(
      "source_capture_readback_failed",
      `SysML source capture did not pass exact readback validation: ${
        errorMessage(error)
      }`,
    );
  }

  const analysisText = await dependencies.analysisCaptures.read(
    reference.analysisFingerprint,
  );
  if (analysisText === undefined) {
    throw new SysmlSourceAnalysisCaptureError(
      "analysis_capture_readback_failed",
      "SysML source analysis capture is not durably readable.",
    );
  }
  let analysis: ReturnType<typeof validateSourceAnalysisBundle>;
  try {
    analysis = validateSourceAnalysisBundle(JSON.parse(analysisText));
    if (deterministicJson(analysis) !== analysisText) {
      throw new TypeError("SysML source analysis is not canonical JSON.");
    }
    if (
      !sameFingerprint(
        await fingerprintSourceAnalysisBundle(analysis),
        reference.analysisFingerprint,
      )
    ) {
      throw new TypeError("SysML source analysis fingerprint is not exact.");
    }
    if (
      analysis.policy.status !== "passed" ||
      analysis.source.id !== source.sourceId ||
      analysis.source.role !== "sysml-model" ||
      analysis.source.language !== "sysml-v2" ||
      !sameFingerprint(analysis.source.fingerprint, source.sourceFingerprint)
    ) {
      throw new TypeError("SysML source analysis does not attest the reopened source.");
    }
  } catch (error) {
    throw new SysmlSourceAnalysisCaptureError(
      "analysis_capture_readback_failed",
      `SysML source analysis did not pass exact readback validation: ${
        errorMessage(error)
      }`,
    );
  }

  return Object.freeze({ reference, source, analysis });
}

/** Validate a reference without opening its CAS entries. */
export function validateSysmlSourceAnalysisReference(
  value: unknown,
): SysmlSourceAnalysisReference {
  return parseReference(value, "$sysmlSourceAnalysisReference");
}

/** Parse a durable envelope and prove that its source text still matches map. */
export async function validateSysmlSourceCapture(
  value: unknown,
): Promise<SysmlSourceCapture> {
  const raw = exactRecord(value, [
    "schemaVersion",
    "kind",
    "sourceId",
    "selector",
    "runId",
    "operation",
    "sourceText",
    "manifest",
    "sourceFingerprint",
  ], "$sysmlSourceCapture");
  if (
    raw.schemaVersion !== SYSML_SOURCE_CAPTURE_SCHEMA || raw.kind !== "sysml-source"
  ) {
    throw new TypeError("Unsupported SysML source capture envelope.");
  }
  const selector = parseArchitectureSysmlSelector(
    raw.selector,
    "$sysmlSourceCapture.selector",
  );
  const rendered = validateRenderedArchitectureSysml({
    sourceText: raw.sourceText,
    manifest: raw.manifest,
  });
  if (deterministicJson(selector) !== deterministicJson(rendered.manifest.selector)) {
    throw new TypeError("SysML capture selector must equal manifest selector.");
  }
  const sourceFingerprint = parseFingerprint(
    raw.sourceFingerprint,
    "$sysmlSourceCapture.sourceFingerprint",
  );
  const observedSourceFingerprint = await fingerprintUtf8(rendered.sourceText);
  if (!sameFingerprint(observedSourceFingerprint, sourceFingerprint)) {
    throw new TypeError("SysML source capture fingerprint does not name sourceText.");
  }
  const sourceId = safeId(raw.sourceId, "$sysmlSourceCapture.sourceId");
  const runId = safeId(raw.runId, "$sysmlSourceCapture.runId");
  const operation = parseOperation(raw.operation, "$sysmlSourceCapture.operation");
  const expectedSourceId = await sysmlRenderedSourceIdFor(selector, runId, operation);
  if (sourceId !== expectedSourceId) {
    throw new TypeError(
      "SysML source capture sourceId does not name selector, run, and operation.",
    );
  }
  return Object.freeze({
    schemaVersion: SYSML_SOURCE_CAPTURE_SCHEMA,
    kind: "sysml-source",
    sourceId,
    selector,
    runId,
    operation,
    sourceText: rendered.sourceText,
    manifest: rendered.manifest,
    sourceFingerprint,
  });
}

async function sameSource(
  text: string | undefined,
  expected: SysmlSourceCapture,
): Promise<boolean> {
  if (text === undefined) return false;
  try {
    const capture = await validateSysmlSourceCapture(JSON.parse(text));
    return deterministicJson(capture) === text &&
      deterministicJson(capture) === deterministicJson(expected);
  } catch {
    return false;
  }
}

function selectorPackageName(selector: SysmlArchitectureSourceSelector): string {
  return selector.packageName;
}

function parseOperation(value: unknown, path: string): SysmlSourceOperation {
  const raw = exactRecord(value, ["id", "version"], path);
  return Object.freeze({
    id: safeId(raw.id, `${path}.id`),
    version: safeId(raw.version, `${path}.version`),
  });
}

function parseReference(value: unknown, path: string): SysmlSourceAnalysisReference {
  const raw = exactRecord(value, [
    "sourceId",
    "selector",
    "runId",
    "operation",
    "sourceFingerprint",
    "sourceCaptureFingerprint",
    "analysisFingerprint",
  ], path);
  return Object.freeze({
    sourceId: safeId(raw.sourceId, `${path}.sourceId`),
    selector: parseArchitectureSysmlSelector(raw.selector, `${path}.selector`),
    runId: safeId(raw.runId, `${path}.runId`),
    operation: parseOperation(raw.operation, `${path}.operation`),
    sourceFingerprint: parseFingerprint(
      raw.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
    sourceCaptureFingerprint: parseFingerprint(
      raw.sourceCaptureFingerprint,
      `${path}.sourceCaptureFingerprint`,
    ),
    analysisFingerprint: parseFingerprint(
      raw.analysisFingerprint,
      `${path}.analysisFingerprint`,
    ),
  });
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const raw = exactRecord(value, ["algorithm", "digest"], path);
  if (
    raw.algorithm !== "sha256" || typeof raw.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(raw.digest)
  ) throw new TypeError(`${path} must be a SHA-256 fingerprint.`);
  return Object.freeze({ algorithm: "sha256", digest: raw.digest });
}

function sameFingerprint(left: ContentFingerprint, right: ContentFingerprint): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

async function fingerprintUtf8(text: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
