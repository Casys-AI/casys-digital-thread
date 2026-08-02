import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "./deterministic-json.ts";
import {
  parseSysonModelSeedCapture,
  type SysonModelSeedCapture,
} from "./syson-model-seed.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "./thread-snapshot-extension.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "./thread-snapshot.ts";
import { validateThreadSnapshot } from "./thread-snapshot-validation.ts";

/** Immutable normalized capture produced by the bounded r3 operation. */
export const INSPECTION_DRONE_ARCHITECTURE_CAPTURE_SCHEMA =
  "inspection-drone-architecture-capture/1.0" as const;

const CAPTURE_KIND = "inspection-drone-architecture" as const;
const CAPTURE_SCOPE = "bounded-sysml-architecture" as const;
const CAPTURE_STATEMENT =
  "Immutable normalized record of one reviewed inspection-drone SysML architecture insertion and its bounded read-back. It is not CAD, mass, propulsion, simulation, cost, compliance, flight, or verification evidence.";
const RECIPE_ID = "inspection-drone-architecture-sysml" as const;
const RECIPE_VERSION = "1" as const;

/**
 * The only SysML fragment this reviewed architecture operation may insert.
 *
 * It is intentionally a fixed UTF-8 recipe rather than a prompt, template,
 * or caller-provided string. It names high-level boundaries only: it makes no
 * claim about geometry, mass, propulsion layout, performance, or verification.
 */
export const INSPECTION_DRONE_ARCHITECTURE_SYSML = [
  "package InspectionDroneArchitecture {",
  "    part def InspectionDrone {",
  "        part airframe: Airframe;",
  "        part energy: EnergySystem;",
  "        part propulsion: PropulsionSystem;",
  "        part avionicsAndFlightControl: AvionicsAndFlightControl;",
  "        part cameraPayload: InspectionCameraPayload;",
  "    }",
  "",
  "    part def Airframe;",
  "    part def EnergySystem;",
  "    part def PropulsionSystem;",
  "    part def AvionicsAndFlightControl;",
  "    part def InspectionCameraPayload;",
  "",
  "    package Requirements {",
  "        requirement controlledVisualInspection {",
  "            doc /* The system shall support visual inspection in a controlled environment. */",
  "        }",
  "",
  "        requirement cameraPayloadProvision {",
  "            doc /* The system shall provide an integration location for one light inspection camera payload. */",
  "        }",
  "",
  "        requirement modifiableArchitecture {",
  "            doc /* The initial architecture shall preserve explicit airframe, energy, propulsion, avionics and camera-payload boundaries for later design changes. */",
  "        }",
  "",
  "        requirement evidenceDrivenVerification {",
  "            doc /* Later design decisions shall be evaluated against named, traceable engineering evidence before a verification claim is made. */",
  "        }",
  "    }",
  "}",
].join("\n");

/** The reviewed operation which owns the fixed recipe above. */
export const INSPECTION_DRONE_ARCHITECTURE_OPERATION = {
  id: "architecture.author-inspection-drone",
  version: "1",
} as const;

/** Direct names expected below the single inserted architecture package. */
export const INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS = [
  "InspectionDrone",
  "Airframe",
  "EnergySystem",
  "PropulsionSystem",
  "AvionicsAndFlightControl",
  "InspectionCameraPayload",
  "Requirements",
] as const;

export interface InspectionDroneArchitectureElement {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

export interface InspectionDroneArchitectureInsertion {
  readonly inserted: true;
  readonly parentId: string;
  /** SHA-256 of the exact UTF-8 SysML string acknowledged by SysON. */
  readonly textSha256: ContentFingerprint;
}

export interface InspectionDroneArchitectureReadback {
  readonly insertion: InspectionDroneArchitectureInsertion;
  readonly architecturePackage: InspectionDroneArchitectureElement;
  readonly declarations: readonly InspectionDroneArchitectureElement[];
}

/**
 * The exact r2 SysON model-container identity consumed by r3. This is a
 * closed projection of the re-read seed capture, not a provider request.
 */
export interface InspectionDroneArchitectureSeed {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly normalizedResults: SysonModelSeedCapture["normalizedResults"];
}

/** The only recipe identity this operation may record. */
export interface InspectionDroneArchitectureRecipe {
  readonly id: typeof RECIPE_ID;
  readonly version: typeof RECIPE_VERSION;
  readonly textSha256: ContentFingerprint;
}

/**
 * Closed r3 evidence bytes. It contains normalized SysON identities and
 * read-back only; raw provider payloads, the source recipe text and caller
 * input are deliberately excluded.
 */
export interface InspectionDroneArchitectureCapture {
  readonly schemaVersion: typeof INSPECTION_DRONE_ARCHITECTURE_CAPTURE_SCHEMA;
  readonly kind: typeof CAPTURE_KIND;
  readonly scope: typeof CAPTURE_SCOPE;
  readonly statement: typeof CAPTURE_STATEMENT;
  readonly capturedAt: string;
  readonly trustedRunId: string;
  readonly operation: {
    readonly id: typeof INSPECTION_DRONE_ARCHITECTURE_OPERATION.id;
    readonly version: typeof INSPECTION_DRONE_ARCHITECTURE_OPERATION.version;
  };
  readonly seed: InspectionDroneArchitectureSeed;
  readonly recipe: InspectionDroneArchitectureRecipe;
  readonly insertion: InspectionDroneArchitectureInsertion;
  readonly architecturePackage: InspectionDroneArchitectureElement;
  readonly declarations: readonly InspectionDroneArchitectureElement[];
}

export interface MaterializeInspectionDroneArchitectureInput {
  /** Exact r2 SysON model-container ThreadSnapshot bound to the queued run. */
  readonly base: ThreadSnapshot;
  /** Re-read, hash-checked bytes of the r2 SysON model-seed capture. */
  readonly seedCapture: unknown;
  readonly trustedRunId: string;
  readonly capturedAt: string;
  /** Normalized acknowledgement retained by the write-ahead journal. */
  readonly insertion: InspectionDroneArchitectureInsertion;
  /** Raw structured result from the post-write root children read. */
  readonly rootChildrenResult: unknown;
  /** Raw structured result from the architecture-package children read. */
  readonly architectureChildrenResult: unknown;
  /** Logical content-addressed URI allocated by the persistence adapter. */
  readonly captureUri?: string;
}

export interface InspectionDroneArchitectureMaterialization {
  readonly capture: InspectionDroneArchitectureCapture;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly sha256: ContentFingerprint;
  readonly extension: ThreadSnapshotExtension;
  /** Deterministic r3 descendant of the exact r2 SysON model-container. */
  readonly snapshot: ThreadSnapshot;
}

export type InspectionDroneArchitectureMaterializationErrorCode =
  | "invalid_input"
  | "invalid_seed"
  | "invalid_readback";

export class InspectionDroneArchitectureMaterializationError extends Error {
  constructor(
    readonly code: InspectionDroneArchitectureMaterializationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InspectionDroneArchitectureMaterializationError";
  }
}

export interface ValidateInspectionDroneArchitectureReadbackInput {
  /** Normalized root-package coordinate read from the reviewed r2 seed. */
  readonly rootPackageId: string;
  /** Raw structuredContent from syson_element_insert_sysml. */
  readonly insertionResult: unknown;
  /** Raw structuredContent from syson_element_children(root package) after insert. */
  readonly rootChildrenResult: unknown;
  /** Raw structuredContent from syson_element_children(InspectionDroneArchitecture). */
  readonly architectureChildrenResult: unknown;
}

export class InspectionDroneArchitectureReadbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionDroneArchitectureReadbackError";
  }
}

/**
 * Close the provider boundary after the one permitted SysON insertion.
 *
 * The executor supplies only structured MCP results. This function rejects
 * text-only results, a changed parent or recipe, ambiguous root children, and
 * missing/extra direct declarations. It performs no I/O and does not infer
 * physical evidence from the named SysML elements.
 */
export async function validateInspectionDroneArchitectureReadback(
  input: ValidateInspectionDroneArchitectureReadbackInput,
): Promise<InspectionDroneArchitectureReadback> {
  const rootPackageId = identifier(input.rootPackageId, "rootPackageId");
  const insertion = await validateInspectionDroneArchitectureInsertion({
    rootPackageId,
    insertionResult: input.insertionResult,
  });
  return validateReadbackAfterInsertion({
    rootPackageId,
    insertion,
    rootChildrenResult: input.rootChildrenResult,
    architectureChildrenResult: input.architectureChildrenResult,
  });
}

/**
 * Validate only the fixed write acknowledgement before it is entered into the
 * durable write-ahead journal. This lets a resumed run use the normalized
 * acknowledgement without storing raw SysML text.
 */
export async function validateInspectionDroneArchitectureInsertion(input: {
  readonly rootPackageId: string;
  readonly insertionResult: unknown;
}): Promise<InspectionDroneArchitectureInsertion> {
  return await normalizeInsertion(
    input.insertionResult,
    identifier(input.rootPackageId, "rootPackageId"),
  );
}

/** Reject a non-empty r2 root before the sole bounded provider mutation. */
export function requireEmptyInspectionDroneArchitectureRoot(input: {
  readonly rootPackageId: string;
  readonly rootChildrenResult: unknown;
}): void {
  const rootPackageId = identifier(input.rootPackageId, "rootPackageId");
  const children = normalizeChildren(
    input.rootChildrenResult,
    rootPackageId,
    "rootChildrenResult",
  );
  if (children.length !== 0) {
    throw invalid(
      "rootChildrenResult must contain no direct children before insertion.",
    );
  }
}

/**
 * Materialize the only allowed r3 evidence branch. It is pure: it neither
 * calls SysON nor persists content. The executor must have separately read and
 * hash-checked `seedCapture` before dispatching its write.
 */
export async function materializeInspectionDroneArchitecture(
  input: MaterializeInspectionDroneArchitectureInput,
): Promise<InspectionDroneArchitectureMaterialization> {
  const seed = await requireInspectionDroneArchitectureSeed(
    input.base,
    input.seedCapture,
  );
  const trustedRunId = stableIdentifier(input.trustedRunId, "trustedRunId");
  const capturedAt = canonicalUtcInstant(input.capturedAt, "capturedAt");
  const captureUri = optionalCaptureUri(input.captureUri);
  const insertion = normalizedInsertion(
    input.insertion,
    seed.normalizedResults.rootPackage.id,
  );
  const readback = validateReadbackAfterInsertion({
    rootPackageId: seed.normalizedResults.rootPackage.id,
    insertion,
    rootChildrenResult: input.rootChildrenResult,
    architectureChildrenResult: input.architectureChildrenResult,
  });
  const recipe: InspectionDroneArchitectureRecipe = {
    id: RECIPE_ID,
    version: RECIPE_VERSION,
    textSha256: await inspectionDroneArchitectureSysmlFingerprint(),
  };
  if (!fingerprintsEqual(recipe.textSha256, readback.insertion.textSha256)) {
    throw materializationInvalid(
      "invalid_readback",
      "The normalized insertion acknowledgement does not match the reviewed SysML recipe fingerprint.",
    );
  }

  const capture: InspectionDroneArchitectureCapture = {
    schemaVersion: INSPECTION_DRONE_ARCHITECTURE_CAPTURE_SCHEMA,
    kind: CAPTURE_KIND,
    scope: CAPTURE_SCOPE,
    statement: CAPTURE_STATEMENT,
    capturedAt,
    trustedRunId,
    operation: INSPECTION_DRONE_ARCHITECTURE_OPERATION,
    seed,
    recipe,
    insertion: readback.insertion,
    architecturePackage: readback.architecturePackage,
    declarations: readback.declarations,
  };
  const text = deterministicJson(capture);
  const bytes = new TextEncoder().encode(text);
  const sha256 = await sha256Fingerprint(capture);
  const extension = inspectionDroneArchitectureExtension(
    input.base.subject.id,
    capture,
    sha256,
    captureUri,
  );
  const applied = applyThreadSnapshotExtensionIfNew(input.base, extension, {
    appliedAt: capturedAt,
  });
  if (!applied.applied || applied.snapshot.revision !== 3) {
    throw materializationInvalid(
      "invalid_seed",
      "The inspection-drone architecture must create exactly revision 3 from an r2 SysON model seed.",
    );
  }

  return {
    capture: structuredClone(capture),
    text,
    bytes: bytes.slice(),
    sha256: structuredClone(sha256),
    extension: structuredClone(extension),
    snapshot: structuredClone(applied.snapshot),
  };
}

/**
 * Validate an exact r2 base plus the separately re-read seed capture. The
 * executor calls this before every provider call; materialization calls it
 * again so capture evidence cannot drift from its authorized container.
 */
export async function requireInspectionDroneArchitectureSeed(
  value: ThreadSnapshot,
  seedCaptureValue: unknown,
): Promise<InspectionDroneArchitectureSeed> {
  let base: ThreadSnapshot;
  try {
    base = validateThreadSnapshot(value);
  } catch (error) {
    throw materializationInvalid(
      "invalid_seed",
      `base must be a valid immutable ThreadSnapshot: ${errorMessage(error)}`,
    );
  }
  if (
    base.revision !== 2 || !base.previous || base.previous.revision !== 1 ||
    base.artifacts.length !== 2 || base.consumptions.length !== 0 ||
    base.observations.length !== 0 || base.requirements.length !== 0 ||
    base.evaluations.length !== 0 || base.violations.length !== 0 ||
    base.proposedActions.length !== 0
  ) {
    throw materializationInvalid(
      "invalid_seed",
      "The inspection-drone architecture requires the exact r2 SysON model-container snapshot.",
    );
  }
  const seedArtifact = base.artifacts.find((artifact) =>
    artifact.kind === "sysml-model"
  );
  if (
    !seedArtifact || seedArtifact.producer.serverId !== "syson" ||
    seedArtifact.producer.tool !== "syson_model_create" ||
    seedArtifact.inputArtifactIds.length !== 0
  ) {
    throw materializationInvalid(
      "invalid_seed",
      "The r2 basis must expose one unmodified SysON model-container artifact.",
    );
  }

  let seedCapture: SysonModelSeedCapture;
  try {
    seedCapture = parseSysonModelSeedCapture(seedCaptureValue);
  } catch (error) {
    throw materializationInvalid(
      "invalid_seed",
      `The r2 SysON model-seed capture is invalid: ${errorMessage(error)}`,
    );
  }
  if (
    !fingerprintsEqual(
      seedArtifact.fingerprint,
      await sha256Fingerprint(seedCapture),
    ) ||
    seedArtifact.producer.runId !== seedCapture.trustedRunId ||
    seedArtifact.id !== `syson-model-seed-${seedArtifact.fingerprint.digest}`
  ) {
    throw materializationInvalid(
      "invalid_seed",
      "The r2 SysON model-seed capture does not exactly match its model-container artifact.",
    );
  }
  return {
    artifactId: seedArtifact.id,
    fingerprint: structuredClone(seedArtifact.fingerprint),
    normalizedResults: structuredClone(seedCapture.normalizedResults),
  };
}

function validateReadbackAfterInsertion(input: {
  readonly rootPackageId: string;
  readonly insertion: InspectionDroneArchitectureInsertion;
  readonly rootChildrenResult: unknown;
  readonly architectureChildrenResult: unknown;
}): InspectionDroneArchitectureReadback {
  const rootPackageId = identifier(input.rootPackageId, "rootPackageId");
  const insertion = normalizedInsertion(input.insertion, rootPackageId);
  const rootChildren = normalizeChildren(
    input.rootChildrenResult,
    rootPackageId,
    "rootChildrenResult",
  );
  const architecturePackage = inspectionDroneArchitecturePackage(rootChildren);

  const declarations = normalizeChildren(
    input.architectureChildrenResult,
    architecturePackage.id,
    "architectureChildrenResult",
  );
  const expected = [...INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS];
  const labels = declarations.map((item) => item.label);
  if (
    labels.length !== expected.length ||
    new Set(labels).size !== labels.length ||
    expected.some((label) => !labels.includes(label))
  ) {
    throw invalid(
      `architectureChildrenResult must contain exactly: ${expected.join(", ")}.`,
    );
  }
  for (const declaration of declarations) {
    requireSemanticKind(
      declaration,
      declaration.label === "Requirements" ? "Package" : "PartDefinition",
      `architectureChildrenResult ${declaration.label}`,
    );
  }

  return {
    insertion,
    architecturePackage: structuredClone(architecturePackage),
    declarations: declarations.map((item) => structuredClone(item)),
  };
}

/**
 * Bound the provider-issued package identifier before it is used for the final
 * read. No label-only or multi-child result can become a later tool argument.
 */
export function requireInspectionDroneArchitecturePackage(input: {
  readonly rootPackageId: string;
  readonly rootChildrenResult: unknown;
}): InspectionDroneArchitectureElement {
  const rootPackageId = identifier(input.rootPackageId, "rootPackageId");
  return structuredClone(
    inspectionDroneArchitecturePackage(
      normalizeChildren(input.rootChildrenResult, rootPackageId, "rootChildrenResult"),
    ),
  );
}

function inspectionDroneArchitecturePackage(
  rootChildren: readonly InspectionDroneArchitectureElement[],
): InspectionDroneArchitectureElement {
  if (rootChildren.length !== 1) {
    throw invalid(
      "rootChildrenResult must contain exactly one post-insert architecture package.",
    );
  }
  const architecturePackage = rootChildren[0]!;
  if (architecturePackage.label !== "InspectionDroneArchitecture") {
    throw invalid(
      "rootChildrenResult must contain InspectionDroneArchitecture as its sole child.",
    );
  }
  requireSemanticKind(
    architecturePackage,
    "Package",
    "rootChildrenResult architecture package",
  );
  return architecturePackage;
}

function normalizedInsertion(
  value: InspectionDroneArchitectureInsertion,
  rootPackageId: string,
): InspectionDroneArchitectureInsertion {
  const root = closedRecord(
    value,
    ["inserted", "parentId", "textSha256"],
    "insertion",
  );
  if (root.inserted !== true) {
    throw materializationInvalid(
      "invalid_readback",
      "insertion.inserted must be true.",
    );
  }
  if (root.parentId !== rootPackageId) {
    throw materializationInvalid(
      "invalid_readback",
      "insertion.parentId must exactly match the seeded root package.",
    );
  }
  const fingerprint = closedRecord(
    root.textSha256,
    ["algorithm", "digest"],
    "insertion.textSha256",
  );
  if (
    fingerprint.algorithm !== "sha256" || typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw materializationInvalid(
      "invalid_readback",
      "insertion.textSha256 must be a lowercase SHA-256 fingerprint.",
    );
  }
  return {
    inserted: true,
    parentId: rootPackageId,
    textSha256: { algorithm: "sha256", digest: fingerprint.digest },
  };
}

function inspectionDroneArchitectureExtension(
  subjectId: string,
  capture: InspectionDroneArchitectureCapture,
  fingerprint: ContentFingerprint,
  captureUri: string | undefined,
): ThreadSnapshotExtension {
  const artifactId = `inspection-drone-architecture-${fingerprint.digest}`;
  const operation: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_element_insert_sysml",
    runId: capture.trustedRunId,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "SysON inspection-drone architecture (bounded high-level model)",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint: structuredClone(fingerprint),
    ...(captureUri === undefined ? {} : { uri: captureUri }),
    mediaType: "application/json",
    producer: operation,
    inputArtifactIds: [capture.seed.artifactId],
    freshness,
  };
  const consumption: ThreadArtifactConsumption = {
    id: `consume-${capture.seed.artifactId}-by-${artifactId}`,
    artifactId: capture.seed.artifactId,
    consumer: operation,
    observedFingerprint: structuredClone(capture.seed.fingerprint),
    verifiedAt: capture.capturedAt,
    status: "verified",
  };
  return {
    id: `capture-inspection-drone-architecture-${fingerprint.digest}`,
    name: "Capture the bounded inspection-drone SysML architecture",
    subjectId,
    capturedAt: capture.capturedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `link-${artifactId}-derived-from-${capture.seed.artifactId}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifactId },
        to: { kind: "artifact", id: capture.seed.artifactId },
        rationale:
          "The bounded architecture was authored only inside the exact SysON model container captured by r2.",
      },
      {
        id: `link-${consumption.id}-uses-${capture.seed.artifactId}`,
        relation: "uses",
        from: { kind: "consumption", id: consumption.id },
        to: { kind: "artifact", id: capture.seed.artifactId },
        rationale:
          "The r3 executor re-read and fingerprint-verified the r2 model-container capture before authoring the bounded architecture.",
      },
    ],
    proposedActions: [],
    bindingProofs: [{
      provider: "syson",
      kind: "project",
      id: capture.seed.normalizedResults.project.id,
    }],
  };
}

/** Hash the exact UTF-8 bytes, not JSON serialization of the text. */
export async function inspectionDroneArchitectureSysmlFingerprint(): Promise<
  ContentFingerprint
> {
  return await sha256Utf8(INSPECTION_DRONE_ARCHITECTURE_SYSML);
}

async function normalizeInsertion(
  value: unknown,
  rootPackageId: string,
): Promise<InspectionDroneArchitectureInsertion> {
  const root = closedRecord(value, ["inserted", "parentId", "text"], "insertionResult");
  if (root.inserted !== true) {
    throw invalid("insertionResult.inserted must be true.");
  }
  if (root.parentId !== rootPackageId) {
    throw invalid("insertionResult.parentId must exactly match rootPackageId.");
  }
  if (root.text !== INSPECTION_DRONE_ARCHITECTURE_SYSML) {
    throw invalid("insertionResult.text must exactly match the reviewed SysML recipe.");
  }
  return {
    inserted: true,
    parentId: rootPackageId,
    textSha256: await inspectionDroneArchitectureSysmlFingerprint(),
  };
}

function normalizeChildren(
  value: unknown,
  expectedParentId: string,
  path: string,
): InspectionDroneArchitectureElement[] {
  const root = closedRecord(value, ["parentId", "children", "count"], path);
  if (root.parentId !== expectedParentId) {
    throw invalid(`${path}.parentId must exactly match the queried parent.`);
  }
  if (!Array.isArray(root.children)) {
    throw invalid(`${path}.children must be an array.`);
  }
  if (!Number.isSafeInteger(root.count) || root.count !== root.children.length) {
    throw invalid(`${path}.count must exactly equal children.length.`);
  }
  const children = root.children.map((child, index) => {
    const element = closedRecord(
      child,
      ["id", "kind", "label"],
      `${path}.children[${index}]`,
    );
    return {
      id: identifier(element.id, `${path}.children[${index}].id`),
      kind: identifier(element.kind, `${path}.children[${index}].kind`),
      label: identifier(element.label, `${path}.children[${index}].label`),
    };
  });
  if (new Set(children.map((child) => child.id)).size !== children.length) {
    throw invalid(`${path}.children must not contain duplicate ids.`);
  }
  return children;
}

function requireSemanticKind(
  element: InspectionDroneArchitectureElement,
  expected: "Package" | "PartDefinition",
  path: string,
): void {
  if (semanticKind(element.kind) !== expected) {
    throw invalid(`${path}.kind must identify a SysML ${expected}.`);
  }
}

/**
 * SysON has emitted both its source-style `sysml::Kind` identifiers and
 * Sirius semantic URIs. Accept only the two exact representations needed by
 * this bounded recipe; a familiar label never substitutes for semantic kind.
 */
function semanticKind(value: string): "Package" | "PartDefinition" | undefined {
  if (value === "sysml::Package") return "Package";
  if (value === "sysml::PartDefinition") return "PartDefinition";
  try {
    const uri = new URL(value);
    if (uri.protocol !== "siriuscomponents:") return undefined;
    const entity = uri.searchParams.get("entity");
    return entity === "Package" || entity === "PartDefinition" ? entity : undefined;
  } catch {
    return undefined;
  }
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${path} must be an object.`);
  }
  const root = value as Record<string, unknown>;
  const actual = Object.keys(root).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalid(`${path} must contain exactly: ${expected.join(", ")}.`);
  }
  return root;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`${path} must be a non-empty string.`);
  }
  return value;
}

function stableIdentifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    throw materializationInvalid(
      "invalid_input",
      `${path} must be a stable non-empty identifier containing only letters, digits, dot, underscore, colon, or hyphen.`,
    );
  }
  return value;
}

function canonicalUtcInstant(value: unknown, path: string): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  const normalized = Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  const expectedNormalized = typeof value === "string"
    ? value.includes(".") ? value : value.replace("Z", ".000Z")
    : undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    normalized !== expectedNormalized
  ) {
    throw materializationInvalid(
      "invalid_input",
      `${path} must be a canonical UTC ISO-8601 instant ending in Z.`,
    );
  }
  return value;
}

function optionalCaptureUri(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw materializationInvalid(
      "invalid_input",
      "captureUri must be a non-empty immutable storage reference when supplied.",
    );
  }
  return value;
}

async function sha256Utf8(text: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(new TextEncoder().encode(text)),
  );
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

function invalid(message: string): InspectionDroneArchitectureReadbackError {
  return new InspectionDroneArchitectureReadbackError(message);
}

function materializationInvalid(
  code: InspectionDroneArchitectureMaterializationErrorCode,
  message: string,
): InspectionDroneArchitectureMaterializationError {
  return new InspectionDroneArchitectureMaterializationError(code, message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
