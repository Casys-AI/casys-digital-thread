import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  parseExactArchitectureCapture,
} from "../architecture/renderer/architecture-capture.ts";
import { assertArchitectureCaptureSeedAndInputs } from "../architecture/renderer/exact-architecture-capture-inputs.ts";
import {
  parseExactPartDefinitionsCapture,
  PART_DEFINITIONS_CAPTURE_SCHEMA,
} from "../architecture/part-definitions/part-definitions-capture.ts";
import {
  parseExactRequirementsCapture,
  REQUIREMENTS_CAPTURE_SCHEMA,
  REQUIREMENTS_RECAPTURE_SCHEMA,
  REQUIREMENTS_TRACED_CAPTURE_SCHEMA,
  REQUIREMENTS_TRACED_RECAPTURE_SCHEMA,
  requirementsCaptureObservedAt,
  requirementsCaptureProducerTool,
} from "../architecture/requirements/requirements-capture.ts";
import {
  requirementsArtifactId,
  requirementsUriFor,
} from "../architecture/requirements/requirements-identities.ts";
import { PART_DEFINITIONS_CAPTURE_URI_PREFIX } from "../shared/cas/file-capture-store.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadViewerAppMaterializationCatalogBinding } from "./thread-viewer-app-materializer.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";

const SYSON_APP_ID = "io.casys.mcp-syson";
const MODEL_URI = "ui://mcp-syson/model-explorer-viewer";
const REQUIREMENTS_URI = "ui://mcp-syson/requirements-viewer";
const MODEL_SESSION = "io.casys.mcp-syson.recorded-model-children-session/1.0";
const REQUIREMENTS_SESSION =
  "io.casys.mcp-syson.recorded-authored-requirements-session/1.0";

export async function buildSysonViewerBinding(request: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly artifactId: string;
  readonly captureText: string;
  readonly packages: readonly InstalledThreadViewerAppPackage[];
}): Promise<ThreadViewerAppMaterializationCatalogBinding | undefined> {
  const project = validateEngineeringProjectSnapshot(request.project);
  const thread = validateThreadSnapshot(request.thread);
  if (!nonEmpty(request.artifactId) || typeof request.captureText !== "string") {
    throw new TypeError("SysON viewer binding input is invalid.");
  }
  assertCurrentBasis(project, thread);
  const artifact = thread.artifacts.find((item) => item.id === request.artifactId);
  if (!artifact || archivedRefKeys(thread).has(`artifact:${request.artifactId}`)) {
    throw new TypeError("SysON viewer anchor is absent or archived.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(request.captureText);
  } catch {
    throw new TypeError("SysON capture is not JSON.");
  }
  const kind = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).schemaVersion
    : undefined;
  const route = kind === ARCHITECTURE_CAPTURE_SCHEMA ||
      kind === PART_DEFINITIONS_CAPTURE_SCHEMA
    ? { uri: MODEL_URI, session: MODEL_SESSION }
    : kind === REQUIREMENTS_CAPTURE_SCHEMA || kind === REQUIREMENTS_RECAPTURE_SCHEMA ||
        kind === REQUIREMENTS_TRACED_CAPTURE_SCHEMA ||
        kind === REQUIREMENTS_TRACED_RECAPTURE_SCHEMA
    ? { uri: REQUIREMENTS_URI, session: REQUIREMENTS_SESSION }
    : undefined;
  if (!route) return undefined;
  let capture: unknown;
  if (kind === ARCHITECTURE_CAPTURE_SCHEMA) {
    const parsed = parseExactArchitectureCapture(raw);
    assertArchitectureArtifact(artifact, parsed.trustedRunId);
    const seed = assertReference(
      thread,
      parsed.seed.artifactId,
      parsed.seed.fingerprint,
      parsed.seed.producerRunId,
    );
    assertArchitectureCaptureSeedAndInputs(thread, artifact, parsed, seed);
    capture = parsed;
  } else if (kind === PART_DEFINITIONS_CAPTURE_SCHEMA) {
    const parsed = parseExactPartDefinitionsCapture(raw);
    assertPartDefinitionsArtifact(
      artifact,
      parsed.trustedRunId,
      parsed.architecture.artifactId,
    );
    assertReference(
      thread,
      parsed.architecture.artifactId,
      parsed.architecture.fingerprint,
      parsed.architecture.producerRunId,
    );
    assertReference(
      thread,
      parsed.seed.artifactId,
      parsed.seed.fingerprint,
      parsed.seed.producerRunId,
    );
    capture = parsed;
  } else {
    const parsed = parseExactRequirementsCapture(raw);
    assertRequirementsArtifact(artifact, parsed);
    assertReference(
      thread,
      parsed.architecture.artifactId,
      parsed.architecture.fingerprint,
      parsed.architecture.producerRunId,
    );
    assertReference(
      thread,
      parsed.seed.artifactId,
      parsed.seed.fingerprint,
      parsed.seed.producerRunId,
    );
    if ("predecessor" in parsed) {
      assertReference(
        thread,
        parsed.predecessor.artifactId,
        parsed.predecessor.fingerprint,
        parsed.predecessor.producerRunId,
      );
    }
    assertCaptureInputs(artifact, [
      parsed.architecture.artifactId,
      ...("predecessor" in parsed ? [parsed.predecessor.artifactId] : []),
    ]);
    capture = parsed;
  }
  if (typeof kind !== "string") throw new TypeError("SysON capture schema is invalid.");
  if (
    deterministicJson(capture) !== request.captureText ||
    !fingerprintsEqual(await sha256Fingerprint(capture), artifact.fingerprint)
  ) {
    throw new TypeError(
      "SysON capture bytes are not canonical evidence for its anchor.",
    );
  }
  const pkg = request.packages.find((candidate) => candidate.app.id === SYSON_APP_ID);
  const resource = pkg?.resources.find((candidate) => candidate.uri === route.uri);
  if (
    !pkg || !resource || !resource.resultSchemas.includes(kind) ||
    !resource.sessionSchemas.includes(route.session) ||
    !resource.acceptedActions.includes("viewer.session.apply")
  ) return undefined;
  const basis = {
    projectId: project.project.id,
    projectRevision: project.revision,
    subjectId: project.project.subjectId,
    thread: { id: thread.id, revision: thread.revision },
    artifact: { id: artifact.id, fingerprint: `sha256:${artifact.fingerprint.digest}` },
  };
  const unsigned = {
    schemaVersion: route.session,
    resourceUri: route.uri,
    resultSchema: kind,
    readOnly: true,
    basis,
    structuredContent: capture as Readonly<Record<string, unknown>>,
  };
  const projection = await sha256Fingerprint(unsigned);
  const payload = Object.freeze({
    ...unsigned,
    projectionFingerprint: `sha256:${projection.digest}`,
  });
  return Object.freeze({
    basis: {
      projectId: basis.projectId,
      projectRevision: basis.projectRevision,
      subjectId: basis.subjectId,
      thread: basis.thread,
    },
    anchor: { kind: "artifact", id: artifact.id },
    app: pkg.app,
    manifest: { uri: pkg.manifest.uri, path: pkg.manifest.path },
    resource: { uri: resource.uri, path: resource.path },
    readResources: [],
    session: { schema: route.session, payload },
  });
}

function assertCurrentBasis(
  project: EngineeringProjectSnapshot,
  thread: ThreadSnapshot,
): void {
  const declared = project.threadSnapshots.filter((ref) =>
    ref.subjectId === project.project.subjectId
  );
  const headRevision = Math.max(...declared.map((ref) => ref.revision));
  if (
    thread.subject.id !== project.project.subjectId ||
    !declared.some((ref) =>
      ref.snapshotId === thread.id && ref.revision === thread.revision &&
      ref.subjectId === thread.subject.id
    ) || thread.revision !== headRevision
  ) {
    throw new TypeError(
      "SysON viewer basis is not the current declared project Thread.",
    );
  }
}
function assertArchitectureArtifact(artifact: ThreadArtifact, runId: string): void {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.id !== `architecture-${digest}` || artifact.kind !== "sysml-model" ||
    artifact.version !== digest ||
    artifact.uri !== `casys://architecture-capture/sha256/${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== "syson_element_insert_sysml" ||
    artifact.producer.runId !== runId
  ) {
    throw new TypeError("Architecture capture anchor is not exact.");
  }
}
function assertPartDefinitionsArtifact(
  artifact: ThreadArtifact,
  runId: string,
  architectureId: string,
): void {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.id !== `part-definitions-${digest}` || artifact.kind !== "sysml-model" ||
    artifact.version !== digest ||
    artifact.uri !== `${PART_DEFINITIONS_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== "syson_element_children" ||
    artifact.producer.runId !== runId ||
    artifact.inputArtifactIds.length !== 1 ||
    artifact.inputArtifactIds[0] !== architectureId
  ) {
    throw new TypeError("PartDefinitions capture anchor is not exact.");
  }
}
function assertCaptureInputs(
  artifact: ThreadArtifact,
  expected: readonly string[],
): void {
  if (
    artifact.inputArtifactIds.length !== expected.length ||
    new Set(artifact.inputArtifactIds).size !== expected.length ||
    expected.some((id) => !artifact.inputArtifactIds.includes(id))
  ) {
    throw new TypeError("Capture artifact inputs do not match its signed references.");
  }
}
function assertRequirementsArtifact(
  artifact: ThreadArtifact,
  capture: ReturnType<typeof parseExactRequirementsCapture>,
): void {
  const observedAt = requirementsCaptureObservedAt(capture);
  if (
    artifact.id !==
      requirementsArtifactId(capture.containerComponent, artifact.fingerprint.digest) ||
    artifact.kind !== "sysml-model" ||
    artifact.version !== artifact.fingerprint.digest ||
    artifact.uri !==
      requirementsUriFor(capture.containerComponent, artifact.fingerprint) ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== requirementsCaptureProducerTool(capture) ||
    artifact.producer.runId !== capture.trustedRunId ||
    artifact.freshness.changedAt !== observedAt
  ) throw new TypeError("Requirements capture anchor is not exact.");
}
function assertReference(
  thread: ThreadSnapshot,
  id: string,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  runId: string,
): ThreadArtifact {
  const artifact = thread.artifacts.find((item) => item.id === id);
  if (
    !artifact || !fingerprintsEqual(artifact.fingerprint, fingerprint) ||
    artifact.producer.runId !== runId
  ) {
    throw new TypeError("SysON capture reference is absent or mismatched.");
  }
  return artifact;
}
function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
