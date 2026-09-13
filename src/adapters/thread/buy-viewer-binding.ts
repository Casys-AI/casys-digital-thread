/**
 * Exact, read-only whole-App binding for a sealed Buy configuration-cost
 * bundle. The provider owns the session schema; DT builds the payload only
 * from reopened sealed bytes. No live ERP fallback.
 */

import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import { sameSnapshotRef } from "../../domain/project/validation/engineering-project-invariant-values.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import { buyGeometryApplicability } from "../../domain/buy/buy-applicability.ts";
import {
  BUY_SEAL_CONFIGURATION_COST_OPERATION,
  BUY_SEAL_CONFIGURATION_COST_TOOL,
} from "../../domain/buy/buy-operations.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  BUY_SEAL_CAPTURE_URI_PREFIX,
  type BuySealCapture,
  canonicalBuySealCaptureText,
  fingerprintBuySealCapture,
  validateBuySealCapture,
} from "../buy/buy-seal-capture.ts";
import {
  BUY_CAPTURE_URI_PREFIX,
  sha256Digest,
} from "../../domain/buy/buy-source-capture.ts";
import {
  buildBuyRecordedResult,
  BUY_CONFIGURATION_URI_PREFIX,
} from "../buy/buy-recorded-projection.ts";
import type { ThreadViewerAppMaterializationCatalogBinding } from "./thread-viewer-app-materializer.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";
import {
  currentViewerRegistrationBasis,
  exactViewerArtifact,
  installedViewerResource,
} from "./thread-viewer-registration-context.ts";

export const BUY_VIEWER_APP_ID = "io.casys.mcp-erpnext.buy-evidence";
export const BUY_VIEWER_RESOURCE_URI = "ui://mcp-erpnext/buy-evidence-viewer";
export const BUY_VIEWER_SESSION_SCHEMA =
  "io.casys.mcp-erpnext.buy-recorded-session/1.0";
export const BUY_VIEWER_RESULT_SCHEMA = "io.casys.mcp-erpnext.buy-recorded-result/1.0";
export const BUY_VIEWER_SESSION_KIND = "buy.configuration-cost";
export const BUY_VIEWER_PACKAGE_UNAVAILABLE_REASON =
  "No exact admitted Buy evidence viewer package is installed.";
export const BUY_VIEWER_AUTHORITY_MISSING_REASON =
  "No exact human-approved Buy-seal MRTR decision is bound to this run basis.";
export const BUY_VIEWER_AUTHORITY_DIVERGENT_REASON =
  "The signed Buy-seal approval basis differs from this run basis.";
export const BUY_VIEWER_AUTHORITY_AMBIGUOUS_REASON =
  "Multiple human-approved Buy-seal MRTR decisions are bound to this run basis.";
export const BUY_VIEWER_AUTHORITY_WRONG_DECISION_REASON =
  "The Buy seal capture decision is not the work item's authorized MRTR decision.";

export type BuyViewerSessionProjectionPayload =
  | { readonly status: "available"; readonly result: Record<string, unknown> }
  | { readonly status: "unresolved"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * Provider-owned recorded-session payload. Anchor equals provenance.bundleRef
 * and names the published DT seal-capture document, not recorded-result bytes.
 */
export async function composeBuyViewerSessionPayload(input: {
  readonly basis: {
    readonly projectId: string;
    readonly projectRevision: number;
    readonly subjectId: string;
    readonly thread: { readonly id: string; readonly revision: number };
  };
  readonly artifact: ThreadArtifact;
  readonly capture: BuySealCapture;
  readonly projection: BuyViewerSessionProjectionPayload;
}): Promise<Record<string, unknown>> {
  const bundleRef = {
    uri: `${BUY_SEAL_CAPTURE_URI_PREFIX}${input.artifact.fingerprint.digest}`,
    fingerprint: `sha256:${input.artifact.fingerprint.digest}`,
  };
  if (input.artifact.uri && input.artifact.uri !== bundleRef.uri) {
    throw new TypeError(
      "Buy seal artifact URI does not match the published DT bundle address.",
    );
  }
  const unsigned = {
    schemaVersion: BUY_VIEWER_SESSION_SCHEMA,
    kind: BUY_VIEWER_SESSION_KIND,
    basis: input.basis,
    anchor: {
      kind: "document",
      id: input.artifact.id,
      uri: bundleRef.uri,
      fingerprint: bundleRef.fingerprint,
    },
    provenance: {
      kind: "digital-thread-operation",
      operation: BUY_SEAL_CONFIGURATION_COST_TOOL,
      runId: input.capture.trustedRunId,
      configurationRef: {
        uri: `${BUY_CONFIGURATION_URI_PREFIX}${input.capture.configurationDigest}`,
        fingerprint: `sha256:${input.capture.configurationDigest}`,
      },
      bundleRef,
      captureRefs: input.capture.sourceCaptures.map((item) => ({
        uri: `${BUY_CAPTURE_URI_PREFIX}${sha256Digest(item.fingerprint)}`,
        fingerprint: item.fingerprint,
      })),
    },
    projection: input.projection,
  };
  const sessionFingerprint = await sha256Fingerprint(unsigned);
  return {
    ...unsigned,
    basis: {
      ...unsigned.basis,
      sessionFingerprint: `sha256:${sessionFingerprint.digest}`,
    },
  };
}

export interface BuyCaptureReader {
  read(
    fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  ): Promise<string | undefined>;
}

export async function buildBuyViewerBinding(request: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly artifactId: string;
  readonly packages: readonly InstalledThreadViewerAppPackage[];
  readonly seals: BuyCaptureReader;
}): Promise<ThreadViewerAppMaterializationCatalogBinding | undefined> {
  const basis = currentViewerRegistrationBasis(request.project, request.thread);
  const resultArtifact = exactViewerArtifact(request.thread, request.artifactId);
  if (!isBuyProducer(resultArtifact)) return undefined;
  if (!isExactBuySealArtifact(resultArtifact)) {
    throw new TypeError(
      "Buy viewer requires one exact unarchived buy-cost-bundle evidence artifact.",
    );
  }
  const installed = installedViewerResource(
    request.packages,
    BUY_VIEWER_APP_ID,
    BUY_VIEWER_RESOURCE_URI,
    BUY_VIEWER_SESSION_SCHEMA,
  );
  if (!installed) return undefined;
  const capture = await reopenBuySealCapture(request.seals, resultArtifact);
  if (capture.trustedRunId !== resultArtifact.producer.runId) {
    throw new TypeError(
      "The Buy seal capture trusted run does not match its Thread producer.",
    );
  }
  if (!basis.thread) {
    throw new TypeError("Buy viewer requires the project's exact Thread head.");
  }
  const run = exactCompletedBuyRun(request.project, capture, resultArtifact, {
    subjectId: basis.subjectId,
  });
  const authority = recrossBuySealAuthority(request.project, run, capture);
  const applicability = buyGeometryApplicability(
    request.thread,
    capture.configuration,
  );
  const recorded = authority.status === "available" &&
      applicability.status !== "refused"
    ? await buildBuyRecordedResult(
      capture,
      applicability.status === "historical" ? "historical" : "current",
    )
    : undefined;
  const projection = recorded
    ? { status: "available" as const, result: recorded.result }
    : {
      status: "unavailable" as const,
      reason: authority.status === "unavailable"
        ? authority.reason
        : applicability.status === "refused"
        ? applicability.reason
        : "Buy recorded result is unavailable.",
    };
  const payload = await composeBuyViewerSessionPayload({
    basis: {
      projectId: basis.projectId,
      projectRevision: basis.projectRevision,
      subjectId: basis.subjectId,
      thread: basis.thread,
    },
    artifact: resultArtifact,
    capture,
    projection,
  });
  return {
    basis: { ...basis },
    anchor: { kind: "artifact", id: resultArtifact.id },
    app: { ...installed.app.app },
    manifest: { uri: installed.app.manifest.uri, path: installed.app.manifest.path },
    resource: { uri: installed.resource.uri, path: installed.resource.path },
    readResources: [],
    session: { schema: BUY_VIEWER_SESSION_SCHEMA, payload },
  };
}

export function isBuyProducer(artifact: ThreadArtifact): boolean {
  return artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === BUY_SEAL_CONFIGURATION_COST_TOOL;
}

export function isExactBuySealArtifact(artifact: ThreadArtifact): boolean {
  return artifact.id === `buy-cost-bundle-${extractBundleDigest(artifact)}` &&
    artifact.kind === "document" &&
    artifact.mediaType === "application/json" &&
    artifact.uri ===
      `${BUY_SEAL_CAPTURE_URI_PREFIX}${artifact.fingerprint.digest}`;
}

function extractBundleDigest(artifact: ThreadArtifact): string {
  return artifact.version;
}

async function reopenBuySealCapture(
  reader: BuyCaptureReader,
  artifact: ThreadArtifact,
): Promise<BuySealCapture> {
  const text = await reader.read(artifact.fingerprint);
  if (text === undefined) {
    throw new TypeError("The exact Buy seal capture is unavailable.");
  }
  const observed = await sha256Hex(new TextEncoder().encode(text));
  if (observed !== artifact.fingerprint.digest) {
    throw new TypeError("Buy seal capture digest does not match the artefact.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("The Buy seal capture is not JSON.");
  }
  const capture = await validateBuySealCapture(value);
  if (canonicalBuySealCaptureText(capture) !== text) {
    throw new TypeError("The Buy seal capture bytes are not canonical.");
  }
  const fingerprint = await fingerprintBuySealCapture(capture);
  if (fingerprint.digest !== artifact.fingerprint.digest) {
    throw new TypeError("The Buy seal capture fingerprint is not canonical.");
  }
  return capture;
}

function exactCompletedBuyRun(
  project: EngineeringProjectSnapshot,
  capture: BuySealCapture,
  artifact: ThreadArtifact,
  basis: { readonly subjectId: string },
) {
  const run = unique(
    project.agentRuns.filter((item) => item.id === capture.trustedRunId),
    "Buy viewer requires the exact completed seal run.",
  );
  if (
    run.status !== "completed" ||
    run.id !== artifact.producer.runId ||
    !run.resultSnapshot
  ) {
    throw new TypeError("Buy viewer requires the exact completed seal run.");
  }
  const workItem = unique(
    project.workItems.filter((item) => item.id === run.workItemId),
    "The Buy seal run is not bound to its work item.",
  );
  const operation = workItem.operation;
  if (
    operation?.id !== BUY_SEAL_CONFIGURATION_COST_OPERATION.id ||
    operation.version !== BUY_SEAL_CONFIGURATION_COST_OPERATION.version
  ) {
    throw new TypeError(
      "The completed run is not bound to buy.seal-configuration-cost@1.",
    );
  }
  const evidence = unique(
    run.evidenceRefs.filter((item) =>
      item.kind === "artifact" && item.id === artifact.id
    ),
    "The completed Buy seal run does not name the exact seal evidence.",
  );
  if (
    evidence.snapshotId !== run.resultSnapshot.snapshotId ||
    evidence.snapshotRevision !== run.resultSnapshot.revision
  ) {
    throw new TypeError(
      "The completed Buy seal run evidence does not match its result snapshot.",
    );
  }
  assertKnownSnapshot(project, run.resultSnapshot, basis.subjectId, "result");
  if (run.basis?.kind === "thread-snapshot") {
    assertKnownSnapshot(project, run.basis, basis.subjectId, "basis");
  }
  return { run, workItem, operation };
}

function recrossBuySealAuthority(
  project: EngineeringProjectSnapshot,
  binding: ReturnType<typeof exactCompletedBuyRun>,
  capture: BuySealCapture,
): { readonly status: "available" } | {
  readonly status: "unavailable";
  readonly reason: string;
} {
  const runBasis = threadSnapshotBasis(binding.run);
  if (!runBasis) {
    return {
      status: "unavailable",
      reason: BUY_VIEWER_AUTHORITY_MISSING_REASON,
    };
  }
  if (!binding.workItem.decisionIds.includes(capture.decisionId)) {
    return {
      status: "unavailable",
      reason: BUY_VIEWER_AUTHORITY_WRONG_DECISION_REASON,
    };
  }
  const decision = project.decisions.find((item) => item.id === capture.decisionId);
  const decisionBasis = decision?.proposal ? decision.baseSnapshot : undefined;
  if (
    !decision ||
    decision.status !== "approved" ||
    !decisionBasis ||
    !decision.inputFingerprint
  ) {
    return {
      status: "unavailable",
      reason: BUY_VIEWER_AUTHORITY_MISSING_REASON,
    };
  }
  if (!sameSnapshotRef(decisionBasis, runBasis)) {
    return {
      status: "unavailable",
      reason: BUY_VIEWER_AUTHORITY_DIVERGENT_REASON,
    };
  }
  const approvals = project.approvals.filter((approval) => {
    const approvalBasis = approval.baseSnapshot;
    return approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human" &&
      approvalBasis !== undefined &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) &&
      sameSnapshotRef(approvalBasis, decisionBasis) &&
      sameSnapshotRef(approvalBasis, runBasis);
  });
  if (approvals.length === 1) return { status: "available" };
  if (approvals.length > 1) {
    return {
      status: "unavailable",
      reason: BUY_VIEWER_AUTHORITY_AMBIGUOUS_REASON,
    };
  }
  return {
    status: "unavailable",
    reason: BUY_VIEWER_AUTHORITY_MISSING_REASON,
  };
}

function threadSnapshotBasis(
  run: EngineeringAgentRun,
): EngineeringThreadSnapshotRef | undefined {
  if (run.basis?.kind !== "thread-snapshot") return undefined;
  return {
    snapshotId: run.basis.snapshotId,
    revision: run.basis.revision,
    subjectId: run.basis.subjectId,
  };
}

function assertKnownSnapshot(
  project: EngineeringProjectSnapshot,
  reference: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
  subjectId: string,
  label: string,
): void {
  if (reference.subjectId !== subjectId) {
    throw new TypeError(
      `The completed Buy seal run ${label} snapshot is not this project subject.`,
    );
  }
  unique(
    project.threadSnapshots.filter((item) =>
      item.snapshotId === reference.snapshotId &&
      item.revision === reference.revision &&
      item.subjectId === reference.subjectId
    ),
    `The completed Buy seal run ${label} snapshot is unknown to this project.`,
  );
}

function unique<T>(items: readonly T[], message: string): T {
  if (items.length !== 1) throw new TypeError(message);
  return items[0]!;
}
