/**
 * Shared signed-offer fixture for review and seal tests. Not product code.
 */

import type { ReopenedTechnicalCompilationAdmission } from "../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { parseFeaProofCaseCapture } from "../domain/fea/seal-case/fea-proof-case-capture.ts";
import { canonicalProofText } from "../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  compileSensitivityCatalogOfferFromAdmission,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
} from "../domain/sensitivity/study/sensitivity-catalog-from-proof.ts";
import { fingerprintTechnicalSourceText } from "../domain/compile/admission/technical-compilation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../domain/kernel/primitives.ts";
import { validateThreadSnapshot } from "../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../domain/thread/thread-snapshot.ts";

export const SIGNED_OFFER_AT = "2026-08-16T00:00:00.000Z";
export const SIGNED_OFFER_PROJECT_ID = "desk-lamp-dl06";
export const SIGNED_OFFER_SUBJECT_ID = "project:desk-lamp-dl06";
export const SIGNED_OFFER_ADMISSION_ID = "compile-admission-1";
export const SIGNED_OFFER_ADMISSION_DIGEST = "a".repeat(64);
export const SIGNED_OFFER_CASE_ID = "desk-lamp-dl06-arm-cantilever-arm_thickness";

const LINKED_SOURCE_TEXT =
  "from build123d import Box\narm_thickness = 10\nresult = Box(220, 20, arm_thickness)\n";
const DL06_TARGET_ELEMENT_ID = "7dda85d1-764e-4329-95ea-09052355cc47";

export async function signedCatalogOfferFixture(
  options: {
    readonly extraOffer?: boolean;
    readonly admissionSource?: string;
    readonly truncatedOffer?: boolean;
    readonly extraProofSameDigest?: boolean;
    readonly invalidProofSibling?: boolean;
    readonly emptyInputManifest?: boolean;
  } = {},
) {
  const sourceText = LINKED_SOURCE_TEXT;
  const proofCase = await linkedProofCase(sourceText);
  const admissionDocument = await linkedAdmissionDocument(sourceText);
  const liveDocument = await linkedAdmissionDocument(
    options.admissionSource ?? sourceText,
    { emptyInputManifest: options.emptyInputManifest },
  );
  const offer = compileSensitivityCatalogOfferFromAdmission({
    proofCase,
    proofDigest: (await sha256Fingerprint(proofCase)).digest,
    admissionArtifact: {
      id: SIGNED_OFFER_ADMISSION_ID,
      fingerprint: { algorithm: "sha256", digest: SIGNED_OFFER_ADMISSION_DIGEST },
    },
    document: admissionDocument as never,
  });
  if (offer.status !== "ready-for-opt-in") {
    throw new Error(`Expected a ready offer, got ${offer.status}.`);
  }
  const sealedOffer = options.truncatedOffer
    ? (() => {
      const { authority: _dropped, ...truncated } = offer;
      return truncated;
    })()
    : offer;
  const offerDigest = (await sha256Fingerprint(sealedOffer)).digest;
  const proofCaptureRecord = {
    schemaVersion: "fea-proof-case-capture/1.0",
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "run-seal",
    proofDigest: (await sha256Fingerprint(proofCase)).digest,
    canonicalProofText: canonicalProofText(proofCase),
    geometryArtifact: {
      id: "geometry-1",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producerRunId: "run-geom",
    },
    stepArtifact: {
      id: "step-1",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      producerRunId: "run-geom",
      bytes: proofCase.expectedCadArtifact.bytes,
    },
    requirementsArtifact: {
      id: "req-1",
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      producerRunId: "run-req",
    },
    requirementsElementId: proofCase.requirementsSource.elementId,
    seedIdentity: {
      editingContextId: proofCase.requirementsSource.editingContextId,
      elementId: proofCase.requirementsSource.elementId,
    },
    sealedAt: SIGNED_OFFER_AT,
  };
  const proofCaptureText = deterministicJson(proofCaptureRecord);
  await parseFeaProofCaseCapture(proofCaptureText);
  const proofCaptureFp = await sha256Fingerprint(JSON.parse(proofCaptureText));
  const proofArtifactId = `fea-proof-${proofCaptureFp.digest}`;
  const offerCaptureRecord = {
    schemaVersion: SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
    operation: { id: "verify.seal-proof-case", version: "1" },
    trustedRunId: "run-seal",
    sealedAt: SIGNED_OFFER_AT,
    offerDigest,
    offer: sealedOffer,
  };
  const offerCaptureText = deterministicJson(offerCaptureRecord);
  const offerCaptureFp = await sha256Fingerprint(JSON.parse(offerCaptureText));
  const offerArtifactId = `sensitivity-catalog-offer-${offerCaptureFp.digest}`;
  const artifacts = [
    offerArtifact(
      SIGNED_OFFER_ADMISSION_ID,
      "Compilation admission",
      "document",
      SIGNED_OFFER_ADMISSION_DIGEST,
      {
        uri:
          `casys://technical-compilation-admission-capture/sha256/${SIGNED_OFFER_ADMISSION_DIGEST}`,
        mediaType: "application/json",
        tool: "compile.seal-admission@3",
      },
    ),
    offerArtifact(proofArtifactId, "FEA proof", "document", proofCaptureFp.digest, {
      uri: `casys://fea-proof-case-capture/sha256/${proofCaptureFp.digest}`,
      mediaType: "application/json",
      tool: "verify.seal-proof-case@1",
    }),
    {
      ...offerArtifact(
        offerArtifactId,
        "Catalog offer",
        "document",
        offerCaptureFp.digest,
        {
          uri:
            `casys://sensitivity-catalog-offer-capture/sha256/${offerCaptureFp.digest}`,
          mediaType: "application/json",
          tool: "verify.seal-proof-case@1",
        },
      ),
      version: offerDigest,
    },
    ...(options.extraOffer
      ? [offerArtifact(
        "sensitivity-catalog-offer-sibling",
        "Sibling offer",
        "document",
        "e".repeat(64),
        {
          uri: "casys://sensitivity-catalog-offer-capture/sha256/" + "e".repeat(64),
          mediaType: "application/json",
          tool: "verify.seal-proof-case@1",
        },
      )]
      : []),
    ...(options.extraProofSameDigest
      ? [offerArtifact(
        "fea-proof-duplicate",
        "FEA proof duplicate",
        "document",
        "9".repeat(64),
        {
          uri: "casys://fea-proof-case-capture/sha256/" + "9".repeat(64),
          mediaType: "application/json",
          tool: "verify.seal-proof-case@1",
        },
      )]
      : []),
    ...(options.invalidProofSibling
      ? [offerArtifact(
        "fea-proof-invalid",
        "Invalid FEA proof",
        "document",
        "f".repeat(64),
        {
          uri: "casys://fea-proof-case-capture/sha256/" + "f".repeat(64),
          mediaType: "application/json",
          tool: "verify.seal-proof-case@1",
        },
      )]
      : []),
  ];
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snap-sensitivity-offer",
    revision: 1,
    generatedAt: SIGNED_OFFER_AT,
    subject: {
      id: SIGNED_OFFER_SUBJECT_ID,
      name: "Heron",
      kind: "system",
      version: "r7",
      modelArtifactId: SIGNED_OFFER_ADMISSION_ID,
    },
    freshness: {
      status: "fresh" as const,
      changedAt: SIGNED_OFFER_AT,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change-set.sensitivity-offer",
      name: "Signed catalog offer",
      status: "applied",
      createdAt: SIGNED_OFFER_AT,
      appliedAt: SIGNED_OFFER_AT,
      changes: artifacts.map((item) => ({
        id: `change.${item.id}`,
        kind: "created" as const,
        target: { kind: "artifact" as const, id: item.id },
        summary: `Created ${item.id}.`,
        afterFingerprint: item.fingerprint,
      })),
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: artifacts.map((item) => ({
      id: `prov-${item.id}`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: `change.${item.id}` },
      to: { kind: "artifact" as const, id: item.id },
      rationale: `Created ${item.id}.`,
    })),
    proposedActions: [],
  });
  return {
    snapshot,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    },
    catalogOffers: new MemoryOfferCaptures([
      [offerCaptureFp.digest, offerCaptureText],
    ]),
    proofCaptures: new MemoryOfferCaptures([
      [proofCaptureFp.digest, proofCaptureText],
      ...(options.extraProofSameDigest
        ? [["9".repeat(64), proofCaptureText] as const]
        : []),
      ...(options.invalidProofSibling ? [["f".repeat(64), "{not-json"] as const] : []),
    ]),
    admissions: {
      read: () =>
        Promise.resolve({
          document: liveDocument,
        } as unknown as ReopenedTechnicalCompilationAdmission),
    },
    liveDocument,
    cadSource: {
      artifactUri:
        `thread-artifact://${SIGNED_OFFER_PROJECT_ID}/${SIGNED_OFFER_ADMISSION_ID}`,
      sha256: SIGNED_OFFER_ADMISSION_DIGEST,
    },
  };
}

export function snapshotWithAdmissionTool(
  snapshot: ThreadSnapshot,
  tool: string,
): ThreadSnapshot {
  return validateThreadSnapshot({
    ...snapshot,
    artifacts: snapshot.artifacts.map((item) =>
      item.id === SIGNED_OFFER_ADMISSION_ID
        ? {
          ...item,
          producer: { ...item.producer, tool },
        }
        : item
    ),
  });
}

export function snapshotWithAdmissionDigest(
  snapshot: ThreadSnapshot,
  digest: string,
): ThreadSnapshot {
  const fingerprint = { algorithm: "sha256" as const, digest };
  return validateThreadSnapshot({
    ...snapshot,
    artifacts: snapshot.artifacts.map((item) =>
      item.id === SIGNED_OFFER_ADMISSION_ID
        ? {
          ...item,
          version: digest,
          fingerprint,
        }
        : item
    ),
    changeSet: {
      ...snapshot.changeSet,
      changes: snapshot.changeSet.changes.map((change) =>
        change.target.id === SIGNED_OFFER_ADMISSION_ID
          ? { ...change, afterFingerprint: fingerprint }
          : change
      ),
    },
  });
}

async function linkedProofCase(sourceText: string): Promise<MechanicalProofCase> {
  const base = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl06-arm-cantilever.json",
          import.meta.url,
        ),
      ),
    ),
  );
  if (base.cadSource.kind !== "parametric") {
    throw new Error("Expected a parametric dl06 proof.");
  }
  const fingerprint = await fingerprintTechnicalSourceText(sourceText);
  return validateMechanicalProofCase({
    ...base,
    cadSource: {
      ...base.cadSource,
      generator: {
        ...base.cadSource.generator,
        definition: {
          mediaType: "text/x-python",
          sha256: fingerprint.digest,
          bytes: new TextEncoder().encode(sourceText).byteLength,
        },
      },
    },
  });
}

async function linkedAdmissionDocument(
  sourceText: string,
  options: { readonly emptyInputManifest?: boolean } = {},
) {
  const hasLever = sourceText.includes("arm_thickness = 10");
  const sourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  const parameter = {
    id: "parameter.arm-thickness",
    kind: "parameter" as const,
    name: "arm_thickness",
    span: {
      start: { line: 2, column: 0 },
      end: { line: 2, column: 13 },
    },
  };
  const result = {
    id: "artifact.result",
    kind: "artifact" as const,
    name: "result",
  };
  const analysis = {
    schemaVersion: "source-analysis/1.0" as const,
    source: {
      id: "source.cad",
      role: "cad-script" as const,
      language: "python" as const,
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "build123d-qualified-lezer", version: "1.6.0" },
    policy: {
      profile: "build123d-closed-subset-v1",
      status: "passed" as const,
      findings: [],
    },
    symbols: hasLever ? [parameter, result] : [result],
    dependencies: hasLever
      ? [{
        id: "dependency.arm-thickness.result",
        kind: "structural-incidence" as const,
        fromSymbolId: parameter.id,
        toSymbolId: result.id,
      }]
      : [],
    unresolvedConstructs: [],
  };
  const bindings = [
    ...(hasLever
      ? [{
        id: "binding.arm-thickness",
        sourceId: "source.cad",
        sourceSymbolId: parameter.id,
        sysmlElementId: "sysml.attribute.arm-thickness",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes" as const,
      }]
      : []),
    {
      id: "binding.result",
      sourceId: "source.cad",
      sourceSymbolId: result.id,
      sysmlElementId: DL06_TARGET_ELEMENT_ID,
      sysmlElementKind: "PartDefinition",
      relation: "represents" as const,
    },
  ];
  return {
    inputManifest: {
      sources: options.emptyInputManifest ? [] : [{
        sourceText,
        analysis,
      }],
      bindings,
    },
    projections: [{
      target: "build123d-source" as const,
      status: "ready-for-review" as const,
      sources: [{
        sourceText,
        analysis,
        analysisFingerprint: { algorithm: "sha256" as const, digest: "2".repeat(64) },
        bindings,
      }],
    }],
  };
}

function offerArtifact(
  id: string,
  name: string,
  kind: "document",
  digest: string,
  extra: {
    readonly uri: string;
    readonly mediaType: string;
    readonly tool: string;
  },
) {
  return {
    id,
    name,
    kind,
    version: digest,
    fingerprint: { algorithm: "sha256" as const, digest },
    uri: extra.uri,
    mediaType: extra.mediaType,
    producer: {
      serverId: "digital-thread",
      tool: extra.tool,
      runId: "run-source",
    },
    inputArtifactIds: [] as string[],
    freshness: {
      status: "fresh" as const,
      changedAt: SIGNED_OFFER_AT,
      invalidatedByChangeIds: [],
    },
  };
}

export class MemoryOfferCaptures {
  constructor(private readonly items: ReadonlyArray<readonly [string, string]>) {}
  read(fingerprint: ContentFingerprint) {
    const found = this.items.find((item) => item[0] === fingerprint.digest);
    return Promise.resolve(found?.[1]);
  }
}
