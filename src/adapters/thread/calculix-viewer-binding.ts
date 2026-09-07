/**
 * Exact, read-only whole-App binding for a completed isolated CalculiX @3
 * proof. The provider owns the session schema; this adapter only reopens the
 * recorded evidence and proves its identities against the current Thread.
 */
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import type { CalculixIsolatedExecutionEvidence } from "../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  isExactStaticProofEvidenceArtifactId,
  isExactStaticProofOutputArtifactId,
  staticProofEvidenceArtifactLegacyId,
  staticProofOutputArtifactLegacyId,
  type StaticProofPublicationLayout,
  staticProofPublicationLayout,
} from "../../domain/fea/isolated-v3/static-proof-publication-identity.ts";
import type { ThreadViewerAppMaterializationCatalogBinding } from "./thread-viewer-app-materializer.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";
import {
  currentViewerRegistrationBasis,
  exactViewerArtifact,
  installedViewerResource,
} from "./thread-viewer-registration-context.ts";

export const CALCULIX_VIEWER_APP_ID = "io.casys.mcp-calculix.results";
export const CALCULIX_VIEWER_RESOURCE_URI = "ui://mcp-calculix/results-viewer";
export const CALCULIX_VIEWER_SESSION_SCHEMA =
  "io.casys.mcp-calculix.recorded-static-proof-session/1.0";
const CALCULIX_OPERATION = "verify.run-fea-static-proof@3";

export interface CalculixExecutionEvidenceReader {
  read(
    fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  ): Promise<CalculixIsolatedExecutionEvidence | undefined>;
}

/** Builds a provider payload only from the exact durable @3 proof successor. */
export async function buildCalculixViewerBinding(request: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly artifactId: string;
  readonly packages: readonly InstalledThreadViewerAppPackage[];
  readonly evidence: CalculixExecutionEvidenceReader;
}): Promise<ThreadViewerAppMaterializationCatalogBinding | undefined> {
  const basis = currentViewerRegistrationBasis(request.project, request.thread);
  const resultArtifact = exactViewerArtifact(request.thread, request.artifactId);
  if (!isCalculixResultArtifact(resultArtifact)) return undefined;
  const installed = installedViewerResource(
    request.packages,
    CALCULIX_VIEWER_APP_ID,
    CALCULIX_VIEWER_RESOURCE_URI,
    CALCULIX_VIEWER_SESSION_SCHEMA,
  );
  if (!installed) return undefined;

  const layout = calculixResultPublicationLayout(resultArtifact);
  if (layout === undefined) return undefined;
  const evidenceArtifact = unique(
    request.thread.artifacts.filter((artifact) =>
      artifact.kind === "evidence" &&
      sameProducer(artifact, resultArtifact) &&
      artifact.inputArtifactIds.includes(resultArtifact.id) &&
      exactEvidenceArtifactIdentity(artifact, resultArtifact.producer.runId, layout) &&
      !archivedRefKeys(request.thread).has(`artifact:${artifact.id}`)
    ),
    "CalculiX viewer requires one exact unarchived execution-evidence artifact.",
  );
  const evidence = await request.evidence.read(evidenceArtifact.fingerprint);
  if (!evidence) {
    throw new TypeError(
      "The exact isolated CalculiX execution evidence is unavailable.",
    );
  }
  if (
    evidence.projectId !== request.project.project.id ||
    evidence.agentRunId !== resultArtifact.producer.runId ||
    evidence.fingerprint.digest !== evidenceArtifact.fingerprint.digest
  ) {
    throw new TypeError(
      "The isolated CalculiX evidence does not match its Thread producer.",
    );
  }

  const outputs = new Map(evidence.outputs.map((output) => [output.role, output]));
  const result = requiredOutput(outputs, "result.json");
  const input = requiredOutput(outputs, "input.step");
  if (
    result.sha256 !== resultArtifact.fingerprint.digest ||
    result.casUri !== resultArtifact.uri ||
    result.mediaType !== resultArtifact.mediaType ||
    !isExactStaticProofOutputArtifactId(
      resultArtifact.id,
      "result.json",
      result.sha256,
      resultArtifact.producer.runId,
    ) ||
    staticProofPublicationLayout(
        resultArtifact.id,
        staticProofOutputArtifactLegacyId("result.json", result.sha256),
        resultArtifact.producer.runId,
      ) !== layout
  ) {
    throw new TypeError(
      "The CalculiX result artifact is not the evidence's exact result.json.",
    );
  }
  const inputArtifact = unique(
    request.thread.artifacts.filter((artifact) =>
      artifact.kind === "solver-input" &&
      sameProducer(artifact, resultArtifact) &&
      artifact.fingerprint.digest === input.sha256 &&
      artifact.uri === input.casUri && artifact.mediaType === "model/step" &&
      artifact.version === input.sha256 &&
      artifact.freshness.status === "fresh" &&
      staticProofPublicationLayout(
          artifact.id,
          staticProofOutputArtifactLegacyId("input.step", input.sha256),
          resultArtifact.producer.runId,
        ) === layout &&
      !archivedRefKeys(request.thread).has(`artifact:${artifact.id}`)
    ),
    "The CalculiX evidence has no exact input.step Thread artifact.",
  );
  if (
    evidence.result.inputArtifact.sha256 !== input.sha256 ||
    evidence.result.inputArtifact.byteCount !== input.byteCount
  ) {
    throw new TypeError(
      "The isolated CalculiX result does not match input.step evidence.",
    );
  }

  const unsigned = {
    schemaVersion: CALCULIX_VIEWER_SESSION_SCHEMA,
    kind: "calculix.static-proof",
    basis: { ...basis },
    anchor: viewerAnchor(resultArtifact),
    provenance: {
      kind: "digital-thread-operation",
      operation: CALCULIX_OPERATION,
      runId: resultArtifact.producer.runId,
      inputArtifact: {
        uri: inputArtifact.uri,
        mediaType: "model/step",
        fingerprint: `sha256:${inputArtifact.fingerprint.digest}`,
        bytes: input.byteCount,
      },
      resultArtifact: providerArtifact(resultArtifact),
      evidenceArtifact: providerArtifact(evidenceArtifact),
    },
    projection: { status: "available", result: evidence.result },
  } as const;
  // mcp-calculix fingerprints the complete session after omitting only this
  // self-referential field; deterministicJson has the same sorted JSON rules.
  const sessionFingerprint = await sha256Fingerprint(unsigned);
  const payload = {
    ...unsigned,
    basis: {
      ...unsigned.basis,
      sessionFingerprint: `sha256:${sessionFingerprint.digest}`,
    },
  };
  return {
    basis: { ...basis },
    anchor: { kind: "artifact", id: resultArtifact.id },
    app: { ...installed.app.app },
    manifest: { uri: installed.app.manifest.uri, path: installed.app.manifest.path },
    resource: { uri: installed.resource.uri, path: installed.resource.path },
    readResources: [],
    session: { schema: CALCULIX_VIEWER_SESSION_SCHEMA, payload },
  };
}

function isCalculixResultArtifact(artifact: ThreadArtifact): boolean {
  return calculixResultPublicationLayout(artifact) !== undefined &&
    artifact.kind === "solver-result" &&
    artifact.version === artifact.fingerprint.digest &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === CALCULIX_OPERATION &&
    artifact.uri === `casys://isolated-output/sha256/${artifact.fingerprint.digest}` &&
    artifact.mediaType === "application/json" && artifact.freshness.status === "fresh";
}

function calculixResultPublicationLayout(
  artifact: ThreadArtifact,
): StaticProofPublicationLayout | undefined {
  return staticProofPublicationLayout(
    artifact.id,
    staticProofOutputArtifactLegacyId("result.json", artifact.fingerprint.digest),
    artifact.producer.runId,
  );
}

function exactEvidenceArtifactIdentity(
  artifact: ThreadArtifact,
  runId: string,
  layout: StaticProofPublicationLayout,
): boolean {
  return isExactStaticProofEvidenceArtifactId(
    artifact.id,
    artifact.fingerprint.digest,
    runId,
  ) &&
    staticProofPublicationLayout(
        artifact.id,
        staticProofEvidenceArtifactLegacyId(artifact.fingerprint.digest),
        runId,
      ) === layout &&
    artifact.version === artifact.fingerprint.digest &&
    artifact.uri ===
      `casys://calculix-isolated-execution-evidence/sha256/${artifact.fingerprint.digest}` &&
    artifact.mediaType === "application/json" && artifact.freshness.status === "fresh";
}

function sameProducer(left: ThreadArtifact, right: ThreadArtifact): boolean {
  return deterministicJson(left.producer) === deterministicJson(right.producer);
}

function requiredOutput(
  outputs: ReadonlyMap<string, CalculixIsolatedExecutionEvidence["outputs"][number]>,
  role: "input.step" | "result.json",
): CalculixIsolatedExecutionEvidence["outputs"][number] {
  const output = outputs.get(role);
  if (!output) throw new TypeError(`The isolated CalculiX evidence lacks ${role}.`);
  return output;
}

function viewerAnchor(artifact: ThreadArtifact) {
  return {
    kind: "artifact",
    id: artifact.id,
    uri: artifact.uri,
    fingerprint: `sha256:${artifact.fingerprint.digest}`,
  } as const;
}

function providerArtifact(artifact: ThreadArtifact) {
  return {
    uri: artifact.uri,
    fingerprint: `sha256:${artifact.fingerprint.digest}`,
  } as const;
}

function unique<T>(items: readonly T[], message: string): T {
  if (items.length !== 1) throw new TypeError(message);
  return items[0]!;
}
