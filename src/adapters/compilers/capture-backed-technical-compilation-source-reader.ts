/**
 * Reopens one immutable technical-source capture for the pure compiler.
 *
 * Project and Thread identifiers are validated here only as request context.
 * Captures are global content-addressed objects and may be deliberately reused
 * by another project; the application basis resolver and explicit SysML
 * bindings establish project-local meaning.
 */

import type {
  ReopenedTechnicalCompilationSource,
  TechnicalCompilationSourceReader,
  TechnicalCompilationSourceReadRequest,
} from "../../application/ports/out/technical-compilation-source-reader.ts";
import {
  TechnicalSourceAnalysisCaptureService,
} from "../captures/technical-source-analysis-capture.ts";
import {
  fingerprintSourceAnalysisBundle,
} from "../../domain/analysis/source-analysis.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export class CaptureBackedTechnicalCompilationSourceReader
  implements TechnicalCompilationSourceReader {
  readonly #captures: TechnicalSourceAnalysisCaptureService;

  constructor(captures: TechnicalSourceAnalysisCaptureService) {
    this.#captures = captures;
  }

  async read(
    value: TechnicalCompilationSourceReadRequest,
  ): Promise<ReopenedTechnicalCompilationSource> {
    const request = parseRequest(value);
    const observedReferenceFingerprint = await sha256Fingerprint(
      request.reference,
    );
    if (
      !fingerprintsEqual(
        observedReferenceFingerprint,
        request.referenceFingerprint,
      )
    ) {
      throw new TypeError(
        "Technical source reference fingerprint does not match the exact capture document.",
      );
    }

    const reopened = await this.#captures.reopen(request.reference);
    const analysisFingerprint = await fingerprintSourceAnalysisBundle(
      reopened.analysis,
    );
    const sourceFingerprint: ContentFingerprint = {
      algorithm: "sha256",
      digest: reopened.reference.source.sha256,
    };
    if (
      !fingerprintsEqual(
        sourceFingerprint,
        reopened.analysis.source.fingerprint,
      ) ||
      analysisFingerprint.digest !== reopened.reference.analysis.sha256
    ) {
      throw new TypeError(
        "Reopened technical source provenance does not match its captured analysis.",
      );
    }
    return deepFreeze({
      referenceFingerprint: observedReferenceFingerprint,
      source: {
        sourceText: reopened.sourceText,
        analysis: reopened.analysis,
        analysisFingerprint,
      },
      provenance: {
        profile: {
          id: reopened.reference.profile.id,
          version: reopened.reference.profile.version,
          fingerprint: reopened.reference.profile.fingerprint,
        },
        analyzer: reopened.reference.analysis.analyzer,
        sourceFingerprint,
        captureFingerprint: observedReferenceFingerprint,
        analysisFingerprint,
      },
    });
  }
}

function parseRequest(
  value: unknown,
): TechnicalCompilationSourceReadRequest {
  const request = exactRecord(
    value,
    ["projectId", "basis", "reference", "referenceFingerprint"],
    "$technicalCompilationSourceRead",
  );
  safeId(request.projectId, "$technicalCompilationSourceRead.projectId");
  const basis = exactRecord(
    request.basis,
    ["kind", "snapshotId", "revision", "subjectId"],
    "$technicalCompilationSourceRead.basis",
  );
  literalValue(
    basis.kind,
    "thread-snapshot",
    "$technicalCompilationSourceRead.basis.kind",
  );
  const snapshotId = safeId(
    basis.snapshotId,
    "$technicalCompilationSourceRead.basis.snapshotId",
  );
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(
      "Technical compilation source reads require an exact snapshot id.",
    );
  }
  positiveInteger(
    basis.revision,
    "$technicalCompilationSourceRead.basis.revision",
  );
  safeId(
    basis.subjectId,
    "$technicalCompilationSourceRead.basis.subjectId",
  );
  if (
    request.reference === null || typeof request.reference !== "object" ||
    Array.isArray(request.reference) || Object.keys(request.reference).length === 0
  ) {
    throw new TypeError(
      "Technical source capture reference must be a non-empty object.",
    );
  }
  const referenceFingerprint = parseFingerprint(
    request.referenceFingerprint,
    "$technicalCompilationSourceRead.referenceFingerprint",
  );
  return {
    projectId: request.projectId as string,
    basis: request.basis as TechnicalCompilationSourceReadRequest["basis"],
    reference: request.reference as Readonly<Record<string, unknown>>,
    referenceFingerprint,
  };
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
