/** Exact whole-App binding for an admitted Modelica execution capture/2.0. */
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import {
  type ModelicaAdmittedExecutionCapture,
  validateModelicaAdmittedExecutionCapture,
} from "../../domain/modelica/admitted/execution-evidence.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ImmutableBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import type { ThreadViewerAppMaterializationCatalogBinding } from "./thread-viewer-app-materializer.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";
import {
  currentViewerRegistrationBasis,
  exactViewerArtifact,
  installedViewerResource,
} from "./thread-viewer-registration-context.ts";

export const MODELICA_VIEWER_APP_ID = "io.casys.mcp-modelica.results";
export const MODELICA_VIEWER_RESOURCE_URI = "ui://mcp-modelica/results-viewer";
export const MODELICA_VIEWER_SESSION_SCHEMA =
  "io.casys.mcp-modelica.recorded-admitted-execution-session/1.0";
const MODELICA_OPERATION = "simulate.run-admitted-modelica@1";

export interface ModelicaExecutionCaptureReader {
  read(
    fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  ): Promise<ImmutableBytes | undefined>;
}

export async function buildModelicaViewerBinding(request: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly artifactId: string;
  readonly packages: readonly InstalledThreadViewerAppPackage[];
  readonly captures: ModelicaExecutionCaptureReader;
}): Promise<ThreadViewerAppMaterializationCatalogBinding | undefined> {
  const basis = currentViewerRegistrationBasis(request.project, request.thread);
  if (basis.subjectId !== `project:${basis.projectId}`) {
    throw new TypeError(
      "Admitted Modelica viewer registration requires project:<projectId> subject identity.",
    );
  }
  const resultArtifact = exactViewerArtifact(request.thread, request.artifactId);
  if (!isResultArtifact(resultArtifact)) return undefined;
  const installed = installedViewerResource(
    request.packages,
    MODELICA_VIEWER_APP_ID,
    MODELICA_VIEWER_RESOURCE_URI,
    MODELICA_VIEWER_SESSION_SCHEMA,
  );
  if (!installed) return undefined;
  const captureArtifact = unique(
    request.thread.artifacts.filter((artifact) =>
      artifact.id === `modelica-admitted-capture-${artifact.fingerprint.digest}` &&
      artifact.kind === "document" && sameProducer(artifact, resultArtifact) &&
      artifact.uri ===
        `casys://modelica-admitted-execution-capture/sha256/${artifact.fingerprint.digest}` &&
      artifact.mediaType === "application/json" &&
      artifact.freshness.status === "fresh" &&
      !archivedRefKeys(request.thread).has(`artifact:${artifact.id}`)
    ),
    "The admitted Modelica result has no exact unarchived capture artifact.",
  );
  const bytes = await request.captures.read(captureArtifact.fingerprint);
  if (!bytes) {
    throw new TypeError(
      "The exact admitted Modelica execution capture is unavailable.",
    );
  }
  const rawBytes = bytes.copy();
  if (await sha256Hex(rawBytes) !== captureArtifact.fingerprint.digest) {
    throw new TypeError(
      "The admitted Modelica capture bytes do not match the Thread fingerprint.",
    );
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  let captureValue: unknown;
  try {
    captureValue = JSON.parse(text);
  } catch {
    throw new TypeError("The admitted Modelica capture is not JSON.");
  }
  const capture = await validateModelicaAdmittedExecutionCapture(captureValue);
  if (deterministicJson(capture) !== text) {
    throw new TypeError("The admitted Modelica capture bytes are not canonical.");
  }
  const captureFingerprint = await sha256Fingerprint(capture);
  if (captureFingerprint.digest !== captureArtifact.fingerprint.digest) {
    throw new TypeError("The admitted Modelica capture fingerprint is not canonical.");
  }
  if (
    capture.projectId !== basis.projectId ||
    capture.agentRunId !== resultArtifact.producer.runId ||
    capture.operation.id !== "simulate.run-admitted-modelica" ||
    capture.operation.version !== "1"
  ) {
    throw new TypeError(
      "The admitted Modelica capture does not match its current project or producer.",
    );
  }
  const admission = exactAdmissionArtifact(request.thread, capture, resultArtifact);
  if (
    captureArtifact.inputArtifactIds.length !== 1 ||
    captureArtifact.inputArtifactIds[0] !== admission.id
  ) {
    throw new TypeError(
      "The admitted Modelica capture does not consume its exact Thread admission artifact.",
    );
  }
  const evidence = exactOutputArtifact(
    request.thread,
    capture.receipt.outputs[0],
    "modelica-admitted-evidence",
    resultArtifact,
    admission,
  );
  const result = exactOutputArtifact(
    request.thread,
    capture.receipt.outputs[1],
    "modelica-admitted-result",
    resultArtifact,
    admission,
  );
  if (result.id !== resultArtifact.id) {
    throw new TypeError(
      "The admitted Modelica viewer anchor is not the capture's exact result artifact.",
    );
  }
  const payload = {
    schemaVersion: MODELICA_VIEWER_SESSION_SCHEMA,
    kind: "modelica.admitted-execution",
    basis: { ...basis },
    anchor: providerArtifact(resultArtifact),
    provenance: {
      kind: "digital-thread-operation",
      serverId: "digital-thread",
      operation: MODELICA_OPERATION,
      runId: capture.agentRunId,
      admissionArtifact: providerArtifact(admission),
      captureArtifact: providerArtifact(captureArtifact),
      evidenceArtifact: providerArtifact(evidence),
      resultArtifact: providerArtifact(result),
    },
    projection: { status: "available", capture },
  } as const;
  return {
    basis: { ...basis },
    anchor: { kind: "artifact", id: resultArtifact.id },
    app: { ...installed.app.app },
    manifest: { uri: installed.app.manifest.uri, path: installed.app.manifest.path },
    resource: { uri: installed.resource.uri, path: installed.resource.path },
    readResources: [],
    session: { schema: MODELICA_VIEWER_SESSION_SCHEMA, payload },
  };
}

function isResultArtifact(artifact: ThreadArtifact): boolean {
  return artifact.id === `modelica-admitted-result-${artifact.fingerprint.digest}` &&
    artifact.kind === "solver-result" &&
    artifact.version === artifact.fingerprint.digest &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === MODELICA_OPERATION &&
    artifact.uri === `casys://isolated-output/sha256/${artifact.fingerprint.digest}` &&
    artifact.mediaType === "text/csv" && artifact.freshness.status === "fresh";
}

function exactAdmissionArtifact(
  thread: ThreadSnapshot,
  capture: ModelicaAdmittedExecutionCapture,
  result: ThreadArtifact,
): ThreadArtifact {
  const identity = capture.admission.admissionArtifact;
  return unique(
    thread.artifacts.filter((artifact) =>
      artifact.id === identity.id &&
      artifact.id ===
        `technical-compilation-admission-${identity.fingerprint.digest}` &&
      artifact.kind === "document" &&
      artifact.version === identity.fingerprint.digest &&
      artifact.fingerprint.digest === identity.fingerprint.digest &&
      artifact.uri ===
        `casys://technical-compilation-admission-capture/sha256/${identity.fingerprint.digest}` &&
      artifact.mediaType === "application/json" &&
      artifact.producer.serverId === "digital-thread" &&
      ["compile.seal-admission@1", "compile.seal-admission@3"].includes(
        artifact.producer.tool,
      ) &&
      artifact.freshness.status === "fresh" &&
      !archivedRefKeys(thread).has(`artifact:${artifact.id}`) &&
      result.inputArtifactIds.includes(artifact.id)
    ),
    "The admitted Modelica capture has no exact fresh Thread admission artifact.",
  );
}

function exactOutputArtifact(
  thread: ThreadSnapshot,
  output: ModelicaAdmittedExecutionCapture["receipt"]["outputs"][number],
  prefix: "modelica-admitted-evidence" | "modelica-admitted-result",
  result: ThreadArtifact,
  admission: ThreadArtifact,
): ThreadArtifact {
  return unique(
    thread.artifacts.filter((artifact) =>
      artifact.id === `${prefix}-${output.sha256}` &&
      artifact.version === output.sha256 &&
      artifact.fingerprint.digest === output.sha256 && artifact.uri === output.casUri &&
      artifact.mediaType === output.mediaType &&
      artifact.producer.serverId === "digital-thread" &&
      artifact.producer.tool === MODELICA_OPERATION &&
      artifact.producer.runId === result.producer.runId &&
      (prefix === "modelica-admitted-evidence"
        ? artifact.kind === "evidence" && artifact.mediaType === "application/json"
        : artifact.kind === "solver-result" && artifact.mediaType === "text/csv") &&
      artifact.freshness.status === "fresh" &&
      !archivedRefKeys(thread).has(`artifact:${artifact.id}`) &&
      artifact.inputArtifactIds.length === 1 &&
      artifact.inputArtifactIds[0] === admission.id
    ),
    `The admitted Modelica capture has no exact ${prefix} Thread artifact.`,
  );
}

function providerArtifact(artifact: ThreadArtifact) {
  return {
    artifactId: artifact.id,
    uri: artifact.uri,
    fingerprint: { algorithm: "sha256", digest: artifact.fingerprint.digest },
  } as const;
}

function sameProducer(left: ThreadArtifact, right: ThreadArtifact): boolean {
  return deterministicJson(left.producer) === deterministicJson(right.producer);
}

function unique<T>(items: readonly T[], message: string): T {
  if (items.length !== 1) throw new TypeError(message);
  return items[0]!;
}
