/**
 * Provider-free resolver for an exact Thread/SysML technical-compilation basis.
 *
 * This adapter never calls SysON. It reopens the current project record, one
 * exact immutable Thread revision, and the content-addressed captures already
 * attached to that revision. Display labels are parsed for capture integrity
 * only; identities are always provider IDs recorded by the captures.
 */

import type { TechnicalCompilationBasisResolver } from "../../../application/ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalSysmlAnchor,
  type TechnicalCompilationBasis,
  type TechnicalSysmlElementProvenance,
  type TechnicalSysmlElementRef,
} from "../../../domain/compile/admission/technical-compilation.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import { parseSysonModelSeedCapture } from "../../../domain/architecture/seed/syson-model-seed.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  parseExactArchitectureCapture,
} from "../../architecture/renderer/architecture-capture.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  type FileCaptureStore,
  REQUIREMENTS_CAPTURE_URI_PREFIX,
} from "../../shared/cas/file-capture-store.ts";
import {
  type ExactRequirementsCapture,
  parseExactRequirementsCapture,
} from "../../architecture/requirements/requirements-capture.ts";
import {
  assertThreadSnapshotLineageIntact,
  threadSnapshotDescendsFrom,
} from "../../shared/stores/thread-snapshot-lineage.ts";

const SEED_CAPTURE_URI_PREFIX = "casys://syson-model-seed-capture/sha256/";

export interface TechnicalCompilationBasisResolverDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly architectureCaptures: Pick<
    FileCaptureStore<"architecture-capture">,
    "read"
  >;
  readonly seedCaptures: Pick<FileCaptureStore<"syson-model-seed">, "read">;
  readonly requirementsCaptures: Pick<
    FileCaptureStore<"requirements-capture">,
    "read"
  >;
}

export class TechnicalCompilationBasisResolutionError extends Error {
  constructor(detail: string) {
    super(`Technical compilation basis is not exact: ${detail}`);
    this.name = "TechnicalCompilationBasisResolutionError";
  }
}

/**
 * Resolve the unique active architecture tip declared by one exact project
 * Thread revision. Missing records return `undefined`; present-but-conflicting
 * evidence raises an integrity error so corruption cannot look like absence.
 */
export class CaptureBackedTechnicalCompilationBasisResolver
  implements TechnicalCompilationBasisResolver {
  constructor(
    private readonly dependencies: TechnicalCompilationBasisResolverDependencies,
  ) {}

  async resolve(
    value: unknown,
  ): Promise<TechnicalCompilationBasis | undefined> {
    const request = parseRequest(value);
    const rawProject = await this.dependencies.projects.get(request.projectId);
    if (!rawProject) return undefined;

    const project = integrity(
      "the engineering project record is invalid",
      () => validateEngineeringProjectSnapshot(rawProject),
    );
    if (project.project.id !== request.projectId) {
      throw new TechnicalCompilationBasisResolutionError(
        `project reader returned ${project.project.id} for ${request.projectId}`,
      );
    }
    if (project.project.subjectId !== request.basis.subjectId) {
      throw new TechnicalCompilationBasisResolutionError(
        "the requested Thread subject belongs to another engineering project",
      );
    }
    const declared = project.threadSnapshots.filter((candidate) =>
      candidate.snapshotId === request.basis.snapshotId &&
      candidate.revision === request.basis.revision &&
      candidate.subjectId === request.basis.subjectId
    );
    if (declared.length !== 1) {
      throw new TechnicalCompilationBasisResolutionError(
        "the exact Thread revision is not declared exactly once by the current project record",
      );
    }

    const rawSnapshot = await this.dependencies.snapshots.get(
      request.basis.snapshotId,
    );
    if (!rawSnapshot) return undefined;
    const snapshot = integrity(
      "the requested Thread snapshot is invalid",
      () => validateThreadSnapshot(rawSnapshot),
    );
    assertExactSnapshot(snapshot, request.basis);
    try {
      await assertThreadSnapshotLineageIntact(
        snapshot,
        this.dependencies.snapshots,
      );
    } catch (error) {
      throw new TechnicalCompilationBasisResolutionError(
        `the Thread predecessor lineage is not intact: ${message(error)}`,
      );
    }

    const artifact = selectUniqueActiveArchitectureTip(snapshot);
    if (!artifact) return undefined;
    assertExactArchitectureArtifact(artifact);

    const architectureText = await this.dependencies.architectureCaptures.read(
      artifact.fingerprint,
    );
    if (architectureText === undefined) return undefined;
    const architectureRecord = await exactCanonicalCapture(
      architectureText,
      artifact.fingerprint,
      "architecture",
    );
    const capture = integrity(
      "the architecture capture is invalid",
      () => parseExactArchitectureCapture(architectureRecord),
    );
    if (capture.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA) {
      throw new TechnicalCompilationBasisResolutionError(
        "only parser-backed architecture-capture/4.0 evidence is admissible",
      );
    }
    if (capture.trustedRunId !== artifact.producer.runId) {
      throw new TechnicalCompilationBasisResolutionError(
        "the architecture capture names another producer run",
      );
    }
    if (artifact.freshness.changedAt !== capture.insertedAt) {
      throw new TechnicalCompilationBasisResolutionError(
        "the architecture artifact freshness timestamp differs from its capture",
      );
    }

    const seedArtifact = exactArtifactById(snapshot, capture.seed.artifactId);
    assertExactSeedArtifact(
      seedArtifact,
      capture.seed.fingerprint,
      capture.seed.producerRunId,
    );
    assertArchitectureInputs(
      snapshot,
      artifact,
      seedArtifact,
      capture.predecessor,
      capture.insertedAt,
    );

    const seedText = await this.dependencies.seedCaptures.read(
      seedArtifact.fingerprint,
    );
    if (seedText === undefined) return undefined;
    const seedRecord = await exactCanonicalCapture(
      seedText,
      seedArtifact.fingerprint,
      "SysON seed",
    );
    const seedCapture = integrity(
      "the SysON seed capture is invalid",
      () => parseSysonModelSeedCapture(seedRecord),
    );
    if (seedCapture.trustedRunId !== seedArtifact.producer.runId) {
      throw new TechnicalCompilationBasisResolutionError(
        "the SysON seed capture names another producer run",
      );
    }
    const seedBase = seedCapture.lineage.baseSnapshot;
    const seedBaseDeclarations = project.threadSnapshots.filter((candidate) =>
      candidate.snapshotId === seedBase.snapshotId &&
      candidate.revision === seedBase.revision &&
      candidate.subjectId === seedBase.subjectId
    );
    const documentary = exactArtifactById(
      snapshot,
      seedCapture.lineage.documentaryArtifact.id,
    );
    if (archivedRefKeys(snapshot).has(`artifact:${documentary.id}`)) {
      throw new TechnicalCompilationBasisResolutionError(
        "the SysON seed documentary project lineage is archived",
      );
    }
    if (
      seedCapture.lineage.approvedBriefBasis.projectId !== request.projectId ||
      seedBase.subjectId !== snapshot.subject.id ||
      seedBaseDeclarations.length !== 1 ||
      !fingerprintsEqual(
        documentary.fingerprint,
        seedCapture.lineage.documentaryArtifact.fingerprint,
      ) ||
      documentary.uri !== seedCapture.lineage.documentaryArtifact.uri ||
      documentary.producer.runId !==
        seedCapture.lineage.documentaryArtifact.producerRunId
    ) {
      throw new TechnicalCompilationBasisResolutionError(
        "the SysON seed capture has a foreign documentary project lineage",
      );
    }

    const architectureProvenance = elementProvenance(artifact);
    const elements = [
      ...architectureElements(capture, architectureProvenance),
      ...await requirementsElements(
        snapshot,
        artifact,
        capture,
        seedArtifact,
        this.dependencies.requirementsCaptures,
        this.dependencies.snapshots,
        project.threadSnapshots,
      ),
    ].sort((left, right) =>
      compareText(left.id, right.id) || compareText(left.kind, right.kind)
    );
    const sysmlAnchor = deepFreeze({
      artifactId: artifact.id,
      artifactFingerprint: artifact.fingerprint,
      // architecture-capture/4.0 has no separate capture UUID. Its exact
      // content digest is therefore the only non-fabricated capture identity.
      captureId: artifact.fingerprint.digest,
      editingContextId: seedCapture.normalizedResults.project.editingContextId,
      rootElementId: capture.scopeRoot.id,
      rootElementKind: "Package" as const,
      elements,
    });
    const sysmlAnchorFingerprint = await fingerprintTechnicalSysmlAnchor(
      sysmlAnchor,
    );
    const basis = deepFreeze({
      thread: {
        projectId: request.projectId,
        subjectId: snapshot.subject.id,
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        snapshotFingerprint: await sha256Fingerprint(snapshot),
      },
      sysmlAnchor,
      sysmlAnchorFingerprint,
    });
    // Exercise the same closed parser/hash boundary as the pure compiler before
    // returning anything to the application layer.
    await fingerprintTechnicalCompilationBasis(basis);
    return basis;
  }
}

function parseRequest(value: unknown): {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
} {
  const request = exactRecord(value, ["projectId", "basis"], "$request");
  const projectId = safeId(request.projectId, "$request.projectId");
  const rawBasis = exactRecord(
    request.basis,
    ["kind", "snapshotId", "revision", "subjectId"],
    "$request.basis",
  );
  literalValue(rawBasis.kind, "thread-snapshot", "$request.basis.kind");
  const snapshotId = safeId(rawBasis.snapshotId, "$request.basis.snapshotId");
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(
      "$request.basis.snapshotId must not be a latest alias.",
    );
  }
  return {
    projectId,
    basis: {
      kind: "thread-snapshot",
      snapshotId,
      revision: positiveInteger(rawBasis.revision, "$request.basis.revision"),
      subjectId: safeId(rawBasis.subjectId, "$request.basis.subjectId"),
    },
  };
}

function assertExactSnapshot(
  snapshot: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): void {
  if (
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      "the snapshot reader returned a stale or foreign Thread identity",
    );
  }
}

function selectUniqueActiveArchitectureTip(
  snapshot: ThreadSnapshot,
): ThreadArtifact | undefined {
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
  );
  if (candidates.length === 0) return undefined;
  for (const candidate of candidates) {
    assertExactArchitectureArtifact(candidate);
  }

  const consumed = new Set(
    candidates.flatMap((artifact) => artifact.inputArtifactIds),
  );
  const tips = candidates.filter((artifact) => !consumed.has(artifact.id));
  if (tips.length !== 1) {
    throw new TechnicalCompilationBasisResolutionError(
      "the architecture lineage has no unique exact tip",
    );
  }
  const tip = tips[0]!;
  if (archivedRefKeys(snapshot).has(`artifact:${tip.id}`)) {
    throw new TechnicalCompilationBasisResolutionError(
      "the unique architecture tip is archived",
    );
  }
  if (tip.freshness.status !== "fresh") {
    throw new TechnicalCompilationBasisResolutionError(
      "the unique architecture tip is stale or failed",
    );
  }
  return tip;
}

function assertExactArchitectureArtifact(artifact: ThreadArtifact): void {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.fingerprint.algorithm !== "sha256" ||
    artifact.id !== `architecture-${digest}` || artifact.version !== digest ||
    artifact.uri !== `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== "syson_element_insert_sysml"
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      `architecture artifact ${artifact.id} has a non-exact identity or URI`,
    );
  }
}

function assertExactSeedArtifact(
  artifact: ThreadArtifact,
  fingerprint: ContentFingerprint,
  producerRunId: string,
): void {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.kind !== "sysml-model" ||
    artifact.id !== `syson-model-seed-${digest}` ||
    artifact.version !== digest ||
    artifact.uri !== `${SEED_CAPTURE_URI_PREFIX}${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== "syson_model_create" ||
    artifact.inputArtifactIds.length !== 0 ||
    artifact.freshness.status !== "fresh" ||
    artifact.producer.runId !== producerRunId ||
    !fingerprintsEqual(artifact.fingerprint, fingerprint)
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      "the architecture capture does not name its exact SysON seed artifact",
    );
  }
}

function assertArchitectureInputs(
  snapshot: ThreadSnapshot,
  architecture: ThreadArtifact,
  seed: ThreadArtifact,
  predecessor: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  } | undefined,
  verifiedAt: string,
): void {
  const archived = archivedRefKeys(snapshot);
  if (archived.has(`artifact:${seed.id}`)) {
    throw new TechnicalCompilationBasisResolutionError(
      "the active architecture depends on an archived SysON seed artifact",
    );
  }
  let predecessorArtifact: ThreadArtifact | undefined;
  if (predecessor) {
    predecessorArtifact = exactArtifactById(snapshot, predecessor.artifactId);
    assertExactArchitectureArtifact(predecessorArtifact);
    if (archived.has(`artifact:${predecessorArtifact.id}`)) {
      throw new TechnicalCompilationBasisResolutionError(
        "the active architecture depends on an archived predecessor artifact",
      );
    }
    if (
      predecessorArtifact.producer.runId !== predecessor.producerRunId ||
      !fingerprintsEqual(
        predecessorArtifact.fingerprint,
        predecessor.fingerprint,
      )
    ) {
      throw new TechnicalCompilationBasisResolutionError(
        "the architecture predecessor capture reference is foreign",
      );
    }
  }
  const expected = [
    seed.id,
    ...(predecessorArtifact ? [predecessorArtifact.id] : []),
  ];
  if (
    architecture.inputArtifactIds.length !== expected.length ||
    new Set(architecture.inputArtifactIds).size !== expected.length ||
    expected.some((id) => !architecture.inputArtifactIds.includes(id))
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      "architecture inputs are not bijective with its seed and predecessor captures",
    );
  }
  for (
    const input of [seed, ...(predecessorArtifact ? [predecessorArtifact] : [])]
  ) {
    const attestations = snapshot.consumptions.filter((consumption) =>
      consumption.artifactId === input.id &&
      consumption.consumer.serverId === architecture.producer.serverId &&
      consumption.consumer.tool === architecture.producer.tool &&
      consumption.consumer.runId === architecture.producer.runId &&
      consumption.status === "verified" &&
      consumption.verifiedAt === verifiedAt &&
      fingerprintsEqual(consumption.observedFingerprint, input.fingerprint)
    );
    if (attestations.length !== 1) {
      throw new TechnicalCompilationBasisResolutionError(
        `architecture input ${input.id} has no unique exact byte-consumption attestation`,
      );
    }
  }
}

function exactArtifactById(
  snapshot: ThreadSnapshot,
  artifactId: string,
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === artifactId);
  if (matches.length !== 1) {
    throw new TechnicalCompilationBasisResolutionError(
      `artifact ${artifactId} is not present exactly once`,
    );
  }
  return matches[0]!;
}

async function exactCanonicalCapture(
  text: string,
  expected: ContentFingerprint,
  label: string,
): Promise<unknown> {
  const actualDigest = await fingerprintResourceBytes(
    new TextEncoder().encode(text),
  );
  if (expected.algorithm !== "sha256" || actualDigest !== expected.digest) {
    throw new TechnicalCompilationBasisResolutionError(
      `${label} CAS bytes do not match the Thread fingerprint`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TechnicalCompilationBasisResolutionError(
      `${label} CAS bytes are not JSON: ${message(error)}`,
    );
  }
  if (deterministicJson(parsed) !== text) {
    throw new TechnicalCompilationBasisResolutionError(
      `${label} CAS bytes are not canonical deterministic JSON`,
    );
  }
  return parsed;
}

function architectureElements(
  capture: ReturnType<typeof parseExactArchitectureCapture>,
  provenance: TechnicalSysmlElementProvenance,
): readonly TechnicalSysmlElementRef[] {
  const elements: TechnicalSysmlElementRef[] = [
    {
      id: capture.scopeRoot.id,
      kind: "Package",
      name: capture.scopeRoot.label ?? capture.packageName,
      provenance,
    },
  ];
  for (const definition of capture.partDefinitions) {
    elements.push({
      id: definition.id,
      kind: definition.kind,
      name: definition.label,
      provenance,
    });
    for (const usage of definition.usages) {
      elements.push({
        id: usage.id,
        kind: usage.kind,
        name: usage.label,
        provenance,
      });
    }
    for (const attribute of definition.attributes ?? []) {
      elements.push({
        id: attribute.id,
        kind: attribute.kind,
        name: attribute.label,
        parentElementId: definition.id,
        provenance,
      });
    }
  }
  elements.sort((left, right) =>
    compareText(left.id, right.id) || compareText(left.kind, right.kind)
  );
  return Object.freeze(elements.map((element) => Object.freeze(element)));
}

async function requirementsElements(
  snapshot: ThreadSnapshot,
  architecture: ThreadArtifact,
  architectureCapture: ReturnType<typeof parseExactArchitectureCapture>,
  seed: ThreadArtifact,
  captures: Pick<FileCaptureStore<"requirements-capture">, "read">,
  snapshots: Pick<ThreadSnapshotStore, "get">,
  projectThreadSnapshots: readonly {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  }[],
): Promise<readonly TechnicalSysmlElementRef[]> {
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(REQUIREMENTS_CAPTURE_URI_PREFIX)
  );
  const consumed = new Set(
    candidates.flatMap((artifact) => artifact.inputArtifactIds),
  );
  const archived = archivedRefKeys(snapshot);
  const activeTips = candidates.filter((artifact) =>
    !consumed.has(artifact.id) && !archived.has(`artifact:${artifact.id}`)
  );
  const elements: TechnicalSysmlElementRef[] = [];
  const components = new Set<string>();
  for (const artifact of activeTips) {
    assertBasicRequirementsArtifact(artifact);
    if (artifact.freshness.status !== "fresh") {
      throw new TechnicalCompilationBasisResolutionError(
        `requirements artifact ${artifact.id} is stale or failed`,
      );
    }
    const text = await captures.read(artifact.fingerprint);
    if (text === undefined) {
      throw new TechnicalCompilationBasisResolutionError(
        `requirements capture ${artifact.id} is not durably readable`,
      );
    }
    const record = await exactCanonicalCapture(
      text,
      artifact.fingerprint,
      "requirements",
    );
    const capture = integrity(
      `requirements capture ${artifact.id} is invalid`,
      () => parseExactRequirementsCapture(record),
    );
    assertExactRequirementsArtifact(artifact, capture.containerComponent);
    if (
      capture.trustedRunId !== artifact.producer.runId ||
      capture.insertedAt !== artifact.freshness.changedAt
    ) {
      throw new TechnicalCompilationBasisResolutionError(
        `requirements capture ${artifact.id} has foreign producer or freshness provenance`,
      );
    }
    if (components.has(capture.containerComponent)) {
      throw new TechnicalCompilationBasisResolutionError(
        `requirements lineage for ${capture.containerComponent} has multiple active tips`,
      );
    }
    components.add(capture.containerComponent);
    assertRequirementsInputs(
      snapshot,
      artifact,
      architecture,
      capture.containerComponent,
      capture.insertedAt,
    );
    if (
      capture.architecture.artifactId !== architecture.id ||
      capture.architecture.producerRunId !== architecture.producer.runId ||
      !fingerprintsEqual(
        capture.architecture.fingerprint,
        architecture.fingerprint,
      ) ||
      capture.architectureBasis.fingerprint !==
        architecture.fingerprint.digest ||
      capture.seed.artifactId !== seed.id ||
      capture.seed.producerRunId !== seed.producer.runId ||
      !fingerprintsEqual(capture.seed.fingerprint, seed.fingerprint)
    ) {
      throw new TechnicalCompilationBasisResolutionError(
        `requirements capture ${artifact.id} does not bind the exact active architecture and seed`,
      );
    }
    if (
      !architectureCapture.partDefinitions.some((definition) =>
        definition.id === capture.target.elementId &&
        definition.kind === "PartDefinition"
      )
    ) {
      throw new TechnicalCompilationBasisResolutionError(
        `requirements capture ${artifact.id} targets no exact active PartDefinition`,
      );
    }
    await assertRequirementsArchitectureBasis(
      snapshot,
      architecture,
      capture,
      snapshots,
      projectThreadSnapshots,
    );

    const provenance = elementProvenance(artifact);
    elements.push({
      id: capture.requirementUsage.id,
      kind: capture.requirementUsage.kind,
      provenance,
    });
    for (const constraint of capture.constraintUsages) {
      elements.push({ id: constraint.id, kind: constraint.kind, provenance });
    }
  }
  return elements;
}

function assertBasicRequirementsArtifact(artifact: ThreadArtifact): void {
  if (
    artifact.fingerprint.algorithm !== "sha256" ||
    artifact.version !== artifact.fingerprint.digest ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== "syson_element_insert_sysml"
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      `requirements artifact ${artifact.id} has a non-exact identity`,
    );
  }
}

function assertExactRequirementsArtifact(
  artifact: ThreadArtifact,
  component: string,
): void {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.id !== `requirements-${component}-${digest}` ||
    artifact.uri !==
      `${REQUIREMENTS_CAPTURE_URI_PREFIX}${component}/sha256/${digest}`
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      `requirements artifact ${artifact.id} does not match its exact captured component`,
    );
  }
}

function assertRequirementsInputs(
  snapshot: ThreadSnapshot,
  requirements: ThreadArtifact,
  architecture: ThreadArtifact,
  component: string,
  verifiedAt: string,
): void {
  if (
    !requirements.inputArtifactIds.includes(architecture.id) ||
    new Set(requirements.inputArtifactIds).size !==
      requirements.inputArtifactIds.length ||
    requirements.inputArtifactIds.length < 1 ||
    requirements.inputArtifactIds.length > 2
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      `requirements artifact ${requirements.id} inputs are not exact`,
    );
  }
  for (const inputId of requirements.inputArtifactIds) {
    const input = exactArtifactById(snapshot, inputId);
    if (inputId !== architecture.id) {
      assertBasicRequirementsArtifact(input);
      assertExactRequirementsArtifact(input, component);
    }
    const attestations = snapshot.consumptions.filter((consumption) =>
      consumption.artifactId === input.id &&
      consumption.consumer.serverId === requirements.producer.serverId &&
      consumption.consumer.tool === requirements.producer.tool &&
      consumption.consumer.runId === requirements.producer.runId &&
      consumption.status === "verified" &&
      consumption.verifiedAt === verifiedAt &&
      fingerprintsEqual(consumption.observedFingerprint, input.fingerprint)
    );
    if (attestations.length !== 1) {
      throw new TechnicalCompilationBasisResolutionError(
        `requirements input ${input.id} has no unique exact byte-consumption attestation`,
      );
    }
  }
  const derivedInputIds = snapshot.provenance.filter((link) =>
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === requirements.id && link.to.kind === "artifact"
  ).map((link) => link.to.id);
  if (
    derivedInputIds.length !== requirements.inputArtifactIds.length ||
    new Set(derivedInputIds).size !== derivedInputIds.length ||
    requirements.inputArtifactIds.some((id) => !derivedInputIds.includes(id))
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      `requirements artifact ${requirements.id} has non-bijective derived_from lineage`,
    );
  }
}

async function assertRequirementsArchitectureBasis(
  current: ThreadSnapshot,
  architecture: ThreadArtifact,
  capture: ExactRequirementsCapture,
  snapshots: Pick<ThreadSnapshotStore, "get">,
  projectThreadSnapshots: readonly {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  }[],
): Promise<void> {
  const basis = capture.architectureBasis;
  const declarations = projectThreadSnapshots.filter((reference) =>
    reference.snapshotId === basis.snapshotId &&
    reference.revision === basis.revision &&
    reference.subjectId === current.subject.id
  );
  let historical: ThreadSnapshot | undefined;
  try {
    historical = await snapshots.get(basis.snapshotId);
  } catch (error) {
    throw new TechnicalCompilationBasisResolutionError(
      `requirements architecture basis ${basis.snapshotId}@${basis.revision} is unreadable: ${
        message(error)
      }`,
    );
  }
  if (
    declarations.length !== 1 || !historical ||
    historical.id !== basis.snapshotId ||
    historical.revision !== basis.revision ||
    historical.subject.id !== current.subject.id
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      "the requirements capture architecture basis is not an exact project Thread revision",
    );
  }
  const validated = integrity(
    "the requirements capture architecture basis snapshot is invalid",
    () => validateThreadSnapshot(historical),
  );
  const historicalArchitectures = validated.artifacts.filter((artifact) =>
    artifact.id === architecture.id &&
    deterministicJson(artifact) === deterministicJson(architecture)
  );
  if (
    historicalArchitectures.length !== 1 ||
    !await threadSnapshotDescendsFrom(current, validated, snapshots)
  ) {
    throw new TechnicalCompilationBasisResolutionError(
      "the requirements capture architecture basis is not an exact ancestor carrying the active architecture",
    );
  }
}

function elementProvenance(
  artifact: ThreadArtifact,
): TechnicalSysmlElementProvenance {
  return Object.freeze({
    artifactId: artifact.id,
    artifactFingerprint: artifact.fingerprint,
    captureId: artifact.fingerprint.digest,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function integrity<T>(detail: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw new TechnicalCompilationBasisResolutionError(
      `${detail}: ${message(error)}`,
    );
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
