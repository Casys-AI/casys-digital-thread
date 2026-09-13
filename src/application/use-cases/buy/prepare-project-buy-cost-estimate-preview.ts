/**
 * Read-only Buy documentary-estimate costing preview. No ERP dispatch, no
 * registered seal, no spending approval, no qualification.
 *
 * Reopens one existing capture@1 candidate through the seal@1 review
 * authority, then reopens estimate inputs and every named evidence source
 * from draft CAS by exact reference. Costs compute only from retained bytes;
 * stale, missing, foreign, or basis-mismatched inputs yield no usable costs.
 * Evidence bytes prove capture, never numeric extraction or engineering
 * qualification: values and assumptions stay for human MRTR review.
 */

import type {
  ProjectBuyCostEstimatePreviewCommand,
  ProjectBuyCostEstimatePreviewEvidence,
  ProjectBuyCostEstimatePreviewResult,
  ProjectBuyCostEstimatePreviewUseCase,
} from "../../ports/in/buy/project-buy-cost-estimate-preview.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES,
  BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_BYTES,
  BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_REFS,
} from "../../ports/in/buy/project-buy-cost-estimate-preview.ts";
import type { ProjectBuyConfigurationCostSealReviewUseCase } from "../../ports/in/buy/project-buy-configuration-cost-seal-review.ts";
import {
  assertBuyCostBundleV2Lineage,
  computeBuyCostCandidateV2,
} from "../../../domain/buy/buy-cost-bundle-v2.ts";
import {
  assertBuyProductionEstimateLineage,
  computeBuyProductionEstimateCandidate,
  validateBuyProductionEstimateBundle,
} from "../../../domain/buy/buy-production-estimate.ts";
import {
  BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
  type BuyDocumentaryEstimateEnvelope,
  type BuyEstimateQuantityOperand,
  type BuyEstimateRateOperand,
  validateBuyDocumentaryEstimateEnvelope,
} from "../../../domain/buy/buy-documentary-estimate.ts";
import {
  canonicalBuyCandidateCaptureText,
  validateBuyCandidateCapture,
} from "../../../domain/buy/buy-candidate-capture.ts";
import {
  arrayOf,
  exactRecord,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { parseExactThreadSnapshotBasis } from "../../../domain/project/thread-tip.ts";
import type { AgentResourceReference } from "../../../domain/resource/agent-resource-capture.ts";
import { AGENT_RESOURCE_MAX_BYTES } from "../../../domain/resource/agent-resource-envelope.ts";
import {
  JSON_SOURCE_ACCEPTED_MIME_TYPES,
  parseAgentResourceReference,
} from "../../../domain/resource/agent-resource-reference.ts";
import type { BuyCandidateCaptureReader } from "./prepare-project-buy-configuration-cost-seal-review.ts";
import {
  AgentResourceReopenError,
  ReopenAgentResource,
} from "../resource/reopen-agent-resource.ts";

export class PrepareProjectBuyCostEstimatePreview
  implements ProjectBuyCostEstimatePreviewUseCase {
  constructor(
    private readonly sealReview: ProjectBuyConfigurationCostSealReviewUseCase,
    private readonly candidates: BuyCandidateCaptureReader,
    private readonly reopen: ReopenAgentResource,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectBuyCostEstimatePreviewResult> {
    const command = parseCommand(value);
    const seal = await this.sealReview.execute({
      projectId: command.projectId,
      basis: command.basis,
      candidateArtifactId: command.candidateArtifactId,
      candidateFingerprint: command.candidateFingerprint,
    });
    if (seal.status !== "ready") return seal;
    const candidate = await this.reopenCandidate(command);
    if (candidate.status !== "ready") return candidate;
    const envelopes: BuyDocumentaryEstimateEnvelope[] = [];
    for (const ref of command.estimateRefs) {
      const envelope = await this.reopenEstimateInput(ref);
      if (envelope.status !== "ready") return envelope;
      envelopes.push(envelope.envelope);
    }
    try {
      rejectDuplicates(
        envelopes.map((envelope) => envelope.fingerprint),
        "$buyCostEstimatePreview.estimateRefs",
      );
    } catch (error) {
      return {
        status: "unresolved",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const evidence = await this.reopenEvidence(envelopes);
    if (evidence.status !== "ready") return evidence;
    try {
      const annexes = [];
      for (const envelope of envelopes) {
        const annex = await computeBuyProductionEstimateCandidate({
          configuration: candidate.capture.configuration,
          configurationDigest: candidate.capture.configurationDigest,
          estimate: envelope,
          pricingContext: candidate.capture.bundle.pricingContext,
        });
        await assertBuyProductionEstimateLineage(annex, envelope, {
          configuration: candidate.capture.configuration,
          configurationDigest: candidate.capture.configurationDigest,
          pricingContext: candidate.capture.bundle.pricingContext,
        });
        annexes.push(validateBuyProductionEstimateBundle(annex));
      }
      const bundle = await computeBuyCostCandidateV2({
        configuration: candidate.capture.configuration,
        configurationDigest: candidate.capture.configurationDigest,
        baseBundle: candidate.capture.bundle,
        estimates: annexes,
        pricingContext: candidate.capture.bundle.pricingContext,
      });
      await assertBuyCostBundleV2Lineage(bundle, {
        baseBundle: candidate.capture.bundle,
        annexes,
        configuration: candidate.capture.configuration,
      });
      return {
        status: "preview",
        projectId: command.projectId,
        basis: command.basis,
        candidate: {
          artifactId: command.candidateArtifactId,
          digest: command.candidateFingerprint.digest,
        },
        configurationDigest: candidate.capture.configurationDigest,
        pricing: {
          currency: candidate.capture.bundle.pricingContext.currency,
          asOf: candidate.capture.bundle.pricingContext.asOf,
        },
        estimates: annexes.map((annex) => ({
          captureUri: annex.estimateSource.inputCaptureUri,
          digest: annex.estimateSource.inputFingerprint.replace(/^sha256:/, ""),
          estimateId: envelopes.find((envelope) =>
            envelope.fingerprint === annex.estimateSource.inputFingerprint
          )!.estimate.estimateId,
          lineIds: annex.lines.map((line) =>
            line.configurationLineId
          ),
          provisionalLineIds: annex.lines
            .filter((line) => line.provisional)
            .map((line) => line.configurationLineId),
        })),
        evidence: evidence.evidence,
        annexes,
        bundle,
        nature: "documentary",
        provisional: annexes.some((annex) =>
          annex.lines.some((line) => line.provisional)
        ),
        authority: {
          registeredSeal: "no registered seal executed",
          spendingApproval: "none",
          qualification: "none",
        },
        limits: {
          maxEstimates: BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES,
          maxBytesPerSource: AGENT_RESOURCE_MAX_BYTES,
          acceptedMimeTypes: [...JSON_SOURCE_ACCEPTED_MIME_TYPES],
        },
      };
    } catch (error) {
      return {
        status: "unresolved",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async reopenCandidate(command: ProjectBuyCostEstimatePreviewCommand) {
    let text: string | undefined;
    try {
      text = await this.candidates.read(command.candidateFingerprint);
    } catch (error) {
      return {
        status: "unavailable" as const,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (text === undefined) {
      return {
        status: "unresolved" as const,
        reason: "The Buy candidate capture is not readable.",
      };
    }
    try {
      const capture = await validateBuyCandidateCapture(JSON.parse(text));
      if (canonicalBuyCandidateCaptureText(capture) !== text) {
        return {
          status: "unavailable" as const,
          reason: "The Buy candidate capture bytes are not canonical.",
        };
      }
      if (
        (await sha256Fingerprint(capture)).digest !==
          command.candidateFingerprint.digest
      ) {
        return {
          status: "unavailable" as const,
          reason: "The Buy candidate capture fingerprint is not canonical.",
        };
      }
      return { status: "ready" as const, capture };
    } catch (error) {
      return {
        status: "unresolved" as const,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async reopenEstimateInput(ref: AgentResourceReference) {
    let reopened;
    try {
      reopened = await this.reopen.reopenUtf8Text(ref, {
        acceptedMimeTypes: [...JSON_SOURCE_ACCEPTED_MIME_TYPES],
        maxBytes: AGENT_RESOURCE_MAX_BYTES,
      });
    } catch (error) {
      return mapReopenRefusal(error, `Estimate input ${ref.uri}`);
    }
    try {
      const envelope = validateBuyDocumentaryEstimateEnvelope({
        schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
        estimate: JSON.parse(reopened.text),
        capture: reopened.reference,
        canonicalText: reopened.text,
        fingerprint: `sha256:${reopened.reference.fingerprint.digest}`,
        byteCount: reopened.bytes.byteLength,
      });
      return { status: "ready" as const, envelope };
    } catch (error) {
      return {
        status: "unresolved" as const,
        reason: `Estimate input ${ref.uri} is not a valid documentary estimate: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async reopenEvidence(envelopes: readonly BuyDocumentaryEstimateEnvelope[]) {
    const collected = envelopes.flatMap((envelope) => collectEvidenceRefs(envelope));
    const unique = new Map<string, typeof collected>();
    for (const ref of collected) {
      const key = deterministicJson(ref.reference);
      const group = unique.get(key);
      if (group) group.push(ref);
      else unique.set(key, [ref]);
    }
    if (unique.size > BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_REFS) {
      return {
        status: "unresolved" as const,
        reason:
          `Evidence references exceed the per-request budget (${unique.size} unique sources; at most ${BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_REFS}).`,
      };
    }
    let declaredBytes = 0;
    for (const group of unique.values()) {
      declaredBytes += group[0]!.reference.byteCount;
    }
    if (declaredBytes > BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_BYTES) {
      return {
        status: "unresolved" as const,
        reason:
          `Evidence declared bytes exceed the per-request budget (${declaredBytes} bytes; at most ${BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_BYTES}).`,
      };
    }
    const evidence: ProjectBuyCostEstimatePreviewEvidence[] = [];
    let actualBytes = 0;
    for (const group of unique.values()) {
      const reference = group[0]!.reference;
      let reopened;
      try {
        reopened = await this.reopen.reopenUtf8Text(reference, {
          acceptedMimeTypes: [...JSON_SOURCE_ACCEPTED_MIME_TYPES],
          maxBytes: AGENT_RESOURCE_MAX_BYTES,
        });
      } catch (error) {
        return mapReopenRefusal(error, `Evidence source ${reference.uri}`);
      }
      actualBytes += reopened.reference.byteCount;
      if (actualBytes > BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_BYTES) {
        return {
          status: "unresolved" as const,
          reason:
            `Evidence actual bytes exceed the per-request budget (over ${BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_BYTES} bytes reopened).`,
        };
      }
      evidence.push({
        uri: reopened.reference.uri,
        digest: reopened.reference.fingerprint.digest,
        byteCount: reopened.reference.byteCount,
        mimeType: reopened.reference.mimeType,
        anchors: [...new Set(group.map((item) => item.anchor))],
        observedAts: [...new Set(group.map((item) => item.observedAt))],
      });
    }
    return { status: "ready" as const, evidence };
  }
}

function collectEvidenceRefs(
  envelope: BuyDocumentaryEstimateEnvelope,
): Array<{
  readonly reference: AgentResourceReference;
  readonly anchor: string;
  readonly observedAt: string;
}> {
  const refs: Array<{
    readonly reference: AgentResourceReference;
    readonly anchor: string;
    readonly observedAt: string;
  }> = [];
  const push = (operand: BuyEstimateQuantityOperand | BuyEstimateRateOperand) => {
    if (operand.operand === "sourced") {
      refs.push({
        reference: operand.source.reference,
        anchor: operand.source.anchor,
        observedAt: operand.source.observedAt,
      });
    } else if (operand.operand === "assumed") {
      refs.push({
        reference: operand.justification.source.reference,
        anchor: operand.justification.source.anchor,
        observedAt: operand.justification.source.observedAt,
      });
    }
  };
  for (const line of envelope.estimate.lines) {
    for (const term of line.terms) {
      push(term.consumption);
      push(term.rate);
    }
  }
  return refs;
}

function mapReopenRefusal(
  error: unknown,
  what: string,
): { readonly status: "unresolved" | "unavailable"; readonly reason: string } {
  if (error instanceof AgentResourceReopenError) {
    switch (error.code) {
      case "resource_missing":
        return { status: "unresolved", reason: `${what} is not present in draft CAS.` };
      case "resource_mismatch":
      case "source_exactness_failed":
      case "invalid_utf8":
        return {
          status: "unavailable",
          reason: `${what} failed exact reopen (${error.code}).`,
        };
      default:
        return {
          status: "unresolved",
          reason: `${what} is not usable here (${error.code}).`,
        };
    }
  }
  return { status: "unresolved", reason: `${what} could not be reopened.` };
}

function parseCommand(
  value: unknown,
): ProjectBuyCostEstimatePreviewCommand {
  const root = exactRecord(value, [
    "projectId",
    "basis",
    "candidateArtifactId",
    "candidateFingerprint",
    "estimateRefs",
  ], "$buyCostEstimatePreview");
  const fingerprint = exactRecord(
    root.candidateFingerprint,
    ["algorithm", "digest"],
    "$buyCostEstimatePreview.candidateFingerprint",
  );
  const estimateRefs = arrayOf(
    root.estimateRefs,
    "$buyCostEstimatePreview.estimateRefs",
  );
  if (
    estimateRefs.length < 1 ||
    estimateRefs.length > BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES
  ) {
    throw new TypeError(
      `$buyCostEstimatePreview.estimateRefs must hold 1..${BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES} references.`,
    );
  }
  const parsed = estimateRefs.map((ref, i) =>
    parseAgentResourceReference(ref, `$buyCostEstimatePreview.estimateRefs[${i}]`)
  );
  rejectDuplicates(
    parsed.map((ref) => ref.uri),
    "$buyCostEstimatePreview.estimateRefs.uri",
  );
  return {
    projectId: safeId(root.projectId, "$buyCostEstimatePreview.projectId"),
    basis: parseExactThreadSnapshotBasis(root.basis, "$buyCostEstimatePreview.basis"),
    candidateArtifactId: safeId(
      root.candidateArtifactId,
      "$buyCostEstimatePreview.candidateArtifactId",
    ),
    candidateFingerprint: parseCandidateFingerprint(fingerprint),
    estimateRefs: parsed,
  };
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

function parseCandidateFingerprint(fingerprint: Record<string, unknown>): {
  readonly algorithm: "sha256";
  readonly digest: string;
} {
  if (fingerprint.algorithm !== "sha256") {
    throw new TypeError(
      "$buyCostEstimatePreview.candidateFingerprint.algorithm must be sha256.",
    );
  }
  const digest = nonEmptyText(
    fingerprint.digest,
    "$buyCostEstimatePreview.candidateFingerprint.digest",
  );
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(
      "$buyCostEstimatePreview.candidateFingerprint.digest must be lowercase sha256 hex.",
    );
  }
  return { algorithm: "sha256", digest };
}
