/**
 * Read-only Buy capture review. No ERP dispatch.
 */

import type {
  ProjectBuyConfigurationCostCaptureReviewCommand,
  ProjectBuyConfigurationCostCaptureReviewResult,
  ProjectBuyConfigurationCostCaptureReviewUseCase,
} from "../../ports/in/buy/project-buy-configuration-cost-capture-review.ts";
import type { BuyConfigurationSourceReader } from "../../ports/out/buy/buy-configuration-source-reader.ts";
import type { BuyQualifiedErpBindingResolver } from "../../ports/out/buy/buy-qualified-erp-binding.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import type { AgentResourceStore } from "../../ports/out/resource/agent-resource-store.ts";
import {
  buyGeometryApplicability,
  recrossBuyConfigurationThreadBasis,
  recrossBuyDocumentaryEstimateBasis,
} from "../../../domain/buy/buy-applicability.ts";
import {
  BUY_CONFIGURATION_SCHEMA,
  type BuyConfiguration,
  validateBuyConfiguration,
} from "../../../domain/buy/buy-configuration.ts";
import {
  BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
  buyDocumentaryEstimateEnvelopeFromResource,
} from "../../../domain/buy/buy-documentary-estimate.ts";
import {
  BUY_CLOSED_DOCTYPES,
  type BuyClosedDoctype,
} from "../../../domain/buy/buy-source-capture.ts";
import {
  BUY_COST_DIMENSIONS,
  type BuyCostDimension,
  type BuyPricingContext,
} from "../../../domain/buy/buy-cost-bundle.ts";
import { validateBuyDecimalRounding } from "../../../domain/buy/buy-decimal.ts";
import {
  type BuyCaptureEstimateSource,
  encodeBuyCaptureDecisionParameters,
} from "../../../domain/buy/buy-proposal.ts";
import { decodeUtf8ResourceText } from "../../../domain/resource/agent-resource-envelope.ts";
import { ERPNEXT_BUY_CAPTURE_TOOL } from "../../../domain/buy/buy-operations.ts";
import {
  arrayOf,
  closedRecord,
  exactRecord,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { parseExactThreadSnapshotBasis } from "../../../domain/project/thread-tip.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";

export class PrepareProjectBuyConfigurationCostCaptureReview
  implements ProjectBuyConfigurationCostCaptureReviewUseCase {
  constructor(
    private readonly snapshots: ThreadSnapshotStore,
    private readonly configurations: BuyConfigurationSourceReader,
    private readonly bindings: BuyQualifiedErpBindingResolver,
    private readonly projects?: EngineeringProjectRevisionStore,
    private readonly resources?: Pick<AgentResourceStore, "read">,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectBuyConfigurationCostCaptureReviewResult> {
    const command = parseCommand(value);
    const project = this.projects
      ? await this.projects.get(command.projectId)
      : undefined;
    const binding = await this.bindings.resolve(
      project ? { project } : undefined,
    );
    if (binding.status !== "qualified") {
      return { status: binding.status, reason: binding.reason };
    }
    const snapshot = await this.snapshots.get(command.basis.snapshotId);
    if (
      !snapshot ||
      snapshot.id !== command.basis.snapshotId ||
      snapshot.revision !== command.basis.revision ||
      snapshot.subject.id !== command.basis.subjectId
    ) {
      return {
        status: "unresolved",
        reason: "The exact Thread basis snapshot could not be reopened.",
      };
    }
    const text = await this.configurations.read(
      command.configurationResourceUri,
      command.configurationResourceDigest,
    );
    if (text === undefined) {
      return {
        status: "unresolved",
        reason: "The Buy configuration agent-resource is not readable.",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: "unresolved", reason: "The Buy configuration is not JSON." };
    }
    const configuration = validateBuyConfiguration(parsed);
    if (configuration.schemaVersion !== BUY_CONFIGURATION_SCHEMA) {
      return { status: "unresolved", reason: "Buy configuration schema is divergent." };
    }
    const basisRecross = recrossBuyConfigurationThreadBasis(configuration, {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    });
    if (basisRecross.status !== "current") {
      return { status: "unresolved", reason: basisRecross.reason };
    }
    if (configuration.projectId !== command.projectId) {
      return {
        status: "unresolved",
        reason: "Buy configuration projectId does not match the requested project.",
      };
    }
    if (
      command.geometryArtifactId !== configuration.geometry.parentArtifactId ||
      command.geometryArtifactFingerprint !==
        configuration.geometry.parentFingerprint
    ) {
      return {
        status: "unresolved",
        reason:
          "Supplied parent geometry does not match the reopened Buy configuration.",
      };
    }
    const applicability = buyGeometryApplicability(snapshot, configuration);
    if (applicability.status !== "current") {
      return {
        status: "unresolved",
        reason: applicability.status === "historical"
          ? applicability.reason
          : applicability.reason,
      };
    }
    const configurationDigest = (await sha256Fingerprint(configuration)).digest;
    const estimate = await this.reopenEstimate(command, {
      configuration,
      configurationDigest,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    });
    if (estimate.status !== "ready") return estimate;
    const admission = {
      configurationDigest,
      configurationResourceUri: command.configurationResourceUri,
      configurationResourceDigest: command.configurationResourceDigest,
      ...(estimate.source ? { estimate: estimate.source } : {}),
      schemaVersion: BUY_CONFIGURATION_SCHEMA,
      projectId: command.projectId,
      subjectId: command.basis.subjectId,
      configurationRevision: configuration.configurationRevision,
      basisSnapshotId: command.basis.snapshotId,
      basisRevision: command.basis.revision,
      geometry: configuration.geometry,
      documents: command.documents,
      pricing: command.pricing,
      authorizedSiteFingerprint: binding.binding.sourceInstance.siteId,
      providerTool: ERPNEXT_BUY_CAPTURE_TOOL,
    };
    return {
      status: "ready",
      configuration,
      configurationDigest,
      decisionParameters: encodeBuyCaptureDecisionParameters(admission),
      admission,
    };
  }

  private async reopenEstimate(
    command: ProjectBuyConfigurationCostCaptureReviewCommand,
    basis: {
      readonly configuration: BuyConfiguration;
      readonly configurationDigest: string;
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    },
  ): Promise<
    | { readonly status: "ready"; readonly source?: BuyCaptureEstimateSource }
    | { readonly status: "unresolved"; readonly reason: string }
  > {
    if (
      command.estimateResourceUri === undefined &&
      command.estimateResourceDigest === undefined
    ) {
      return { status: "ready" };
    }
    if (
      command.estimateResourceUri === undefined ||
      command.estimateResourceDigest === undefined
    ) {
      return {
        status: "unresolved",
        reason:
          "Estimate input names only one of estimateResourceUri and estimateResourceDigest.",
      };
    }
    if (!this.resources) {
      return {
        status: "unresolved",
        reason: "Estimate input is named but no agent-resource store is composed.",
      };
    }
    const stored = await this.resources.read(command.estimateResourceUri);
    if (
      !stored ||
      stored.reference.fingerprint.digest !== command.estimateResourceDigest
    ) {
      return {
        status: "unresolved",
        reason: "The documentary estimate agent-resource is not readable.",
      };
    }
    let envelope;
    try {
      const text = decodeUtf8ResourceText(stored.bytes, "Documentary estimate");
      envelope = buyDocumentaryEstimateEnvelopeFromResource(
        stored.reference,
        text,
      );
    } catch (error) {
      return {
        status: "unresolved",
        reason: `The documentary estimate is not usable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    const recross = recrossBuyDocumentaryEstimateBasis(envelope.estimate, basis);
    if (recross.status !== "current") {
      return { status: "unresolved", reason: recross.reason };
    }
    return {
      status: "ready",
      source: {
        resourceUri: command.estimateResourceUri,
        resourceDigest: command.estimateResourceDigest,
        schemaVersion: BUY_DOCUMENTARY_ESTIMATE_SCHEMA,
      },
    };
  }
}

function parseCommand(value: unknown): ProjectBuyConfigurationCostCaptureReviewCommand {
  const root = closedRecord(value, [
    "projectId",
    "basis",
    "configurationResourceUri",
    "configurationResourceDigest",
    "estimateResourceUri",
    "estimateResourceDigest",
    "geometryArtifactId",
    "geometryArtifactFingerprint",
    "documents",
    "pricing",
  ], [
    "projectId",
    "basis",
    "configurationResourceUri",
    "configurationResourceDigest",
    "geometryArtifactId",
    "geometryArtifactFingerprint",
    "documents",
    "pricing",
  ], "$buyCaptureReview");
  const basis = parseExactThreadSnapshotBasis(root.basis, "$buyCaptureReview.basis");
  return {
    projectId: safeId(root.projectId, "$buyCaptureReview.projectId"),
    basis,
    configurationResourceUri: nonEmptyText(
      root.configurationResourceUri,
      "$buyCaptureReview.configurationResourceUri",
    ),
    configurationResourceDigest: sha256(
      root.configurationResourceDigest,
      "$buyCaptureReview.configurationResourceDigest",
    ),
    ...(root.estimateResourceUri === undefined || root.estimateResourceUri === null
      ? {}
      : {
        estimateResourceUri: nonEmptyText(
          root.estimateResourceUri,
          "$buyCaptureReview.estimateResourceUri",
        ),
      }),
    ...(root.estimateResourceDigest === undefined ||
        root.estimateResourceDigest === null
      ? {}
      : {
        estimateResourceDigest: sha256(
          root.estimateResourceDigest,
          "$buyCaptureReview.estimateResourceDigest",
        ),
      }),
    geometryArtifactId: safeId(
      root.geometryArtifactId,
      "$buyCaptureReview.geometryArtifactId",
    ),
    geometryArtifactFingerprint: sha256(
      root.geometryArtifactFingerprint,
      "$buyCaptureReview.geometryArtifactFingerprint",
    ),
    documents: arrayOf(root.documents, "$buyCaptureReview.documents").map(
      (document, i) => parseDocument(document, `$buyCaptureReview.documents[${i}]`),
    ),
    pricing: parsePricing(root.pricing),
  };
}

function parseDocument(
  value: unknown,
  path: string,
): ProjectBuyConfigurationCostCaptureReviewCommand["documents"][number] {
  const input = closedRecord(
    value,
    ["doctype", "name", "expectedModified"],
    ["doctype", "name"],
    path,
  );
  return {
    doctype: oneOf(
      input.doctype,
      BUY_CLOSED_DOCTYPES,
      `${path}.doctype`,
    ) as BuyClosedDoctype,
    name: nonEmptyText(input.name, `${path}.name`),
    ...(input.expectedModified === undefined || input.expectedModified === null ? {} : {
      expectedModified: nonEmptyText(
        input.expectedModified,
        `${path}.expectedModified`,
      ),
    }),
  };
}

function parsePricing(value: unknown): BuyPricingContext {
  const input = exactRecord(
    value,
    ["currency", "asOf", "requiredDimensions", "rounding"],
    "$buyCaptureReview.pricing",
  );
  return {
    currency: nonEmptyText(input.currency, "$buyCaptureReview.pricing.currency"),
    asOf: nonEmptyText(input.asOf, "$buyCaptureReview.pricing.asOf"),
    requiredDimensions: arrayOf(
      input.requiredDimensions,
      "$buyCaptureReview.pricing.requiredDimensions",
    ).map((dimension, i) =>
      oneOf(
        dimension,
        BUY_COST_DIMENSIONS,
        `$buyCaptureReview.pricing.requiredDimensions[${i}]`,
      )
    ) as BuyCostDimension[],
    rounding: validateBuyDecimalRounding(
      input.rounding,
      "$buyCaptureReview.pricing.rounding",
    ),
  };
}

function sha256(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!/^[0-9a-f]{64}$/.test(text)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex SHA-256 digest.`);
  }
  return text;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
