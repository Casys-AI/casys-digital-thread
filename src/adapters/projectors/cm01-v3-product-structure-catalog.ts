import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../../domain/thread/thread-component-catalog.ts";

/** The bounded product whose architecture capture this projection understands. */
export const COFFEE_MACHINE_CM01_V3_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

/**
 * Reviewed product-structure identities used by bounded CM-01 corrections.
 * These are workspace component ids, not provider labels or ERP identities.
 */
export const CM01_V3_PRODUCT_STRUCTURE_IDENTITIES = Object.freeze({
  dripTray: {
    componentId: "cm01-v3:drip-tray",
    provider: "syson" as const,
    bindingKind: "part-definition" as const,
  },
});

const CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA =
  "coffee-machine-cm01-v3-architecture-capture/1.1" as const;
const CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA_LEGACY =
  "coffee-machine-cm01-v3-architecture-capture/1.0" as const;
const CM01_V3_ARCHITECTURE_CAPTURE_KIND = "cm01-sysml-architecture" as const;
const CM01_V3_PART_DEFINITION_KIND =
  "siriusComponents://semantic?domain=sysml&entity=PartDefinition" as const;

/**
 * The immutable store verifies the capture bytes against the requested
 * fingerprint before returning them. This narrow reader keeps the BFF free of
 * storage paths and provider clients.
 */
export interface Cm01V3CaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

/**
 * The two capture namespaces are deliberately separate.  A part-definition
 * digest must never be looked up in the architecture store simply because
 * both records happen to be JSON.
 */
export interface Cm01V3ProductStructureCaptureReaders {
  readonly architecture: Cm01V3CaptureReader;
  readonly partDefinitions: Cm01V3CaptureReader;
}

/**
 * Resolve a small Product Structure only from the current V3 thread evidence.
 *
 * It deliberately does not merge labels with ERP, manufacture CAD child
 * identities, or reuse the unrelated historic CM-01 catalog. The SysON
 * identities come from the exact hashed architecture read-back; the optional
 * build123d facet names only the one fresh assembly STEP whose provenance
 * identifies it as the R2 successor.
 */
export async function resolveCoffeeMachineCm01V3ProductStructureCatalog(
  snapshot: ThreadSnapshot,
  captures: Cm01V3ProductStructureCaptureReaders,
): Promise<ThreadComponentCatalog | undefined> {
  if (snapshot.subject.id !== COFFEE_MACHINE_CM01_V3_SUBJECT_ID) {
    return undefined;
  }

  const artifacts = snapshot.artifacts.filter((artifact) =>
    !archivedRefKeys(snapshot).has(`artifact:${artifact.id}`)
  );
  const architecture = oneFreshArchitecture(artifacts);
  if (!architecture) {
    return unavailable(
      snapshot.subject.id,
      "No single fresh CM-01 V3 SysON architecture capture is attached to this revision.",
    );
  }
  if (!canonicalArchitectureArtifact(architecture)) {
    return unavailable(
      snapshot.subject.id,
      "The CM-01 V3 architecture artifact does not carry its canonical content-addressed identity.",
    );
  }

  let capture: Cm01V3ArchitectureCapture;
  try {
    const text = await captures.architecture.read(architecture.fingerprint);
    if (!text) {
      return unavailable(
        snapshot.subject.id,
        "The exact CM-01 V3 SysON architecture capture is not readable for this revision.",
      );
    }
    capture = await parseArchitectureCapture(text, architecture.fingerprint);
  } catch {
    return unavailable(
      snapshot.subject.id,
      "The exact CM-01 V3 SysON architecture capture cannot be verified for this revision.",
    );
  }

  const root = capture.declarations.filter((declaration) =>
    declaration.label === "CoffeeMachine"
  );
  if (root.length !== 1) {
    return unavailable(
      snapshot.subject.id,
      "The verified CM-01 V3 architecture does not expose one CoffeeMachine root definition.",
    );
  }

  const componentDeclarations = capture.declarations.filter((declaration) =>
    declaration.id !== root[0]!.id
  );
  if (componentDeclarations.length === 0) {
    return unavailable(
      snapshot.subject.id,
      "The verified CM-01 V3 architecture does not expose any component definitions.",
    );
  }

  const semanticKeys = componentDeclarations.map((declaration) =>
    semanticKey(declaration.label)
  );
  if (new Set(semanticKeys).size !== semanticKeys.length) {
    return unavailable(
      snapshot.subject.id,
      "The verified CM-01 V3 architecture has ambiguous component-definition labels.",
    );
  }

  const assemblyStep = freshR2AssemblyStep(artifacts);
  const r3Meshes = freshR3MeshArtifactMap(artifacts);
  const assemblyMesh = r3Meshes.get("assembly");
  const r3WholeAssembly = freshR3WholeAssemblyArtifactMap(artifacts);
  const partDefMap = await buildPartDefinitionMap(
    artifacts,
    captures.partDefinitions,
    architecture,
    capture,
  );
  const rootDefinition = root[0]!;
  return validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: snapshot.subject.id,
    rationale:
      "This Product Structure is derived at read time from the exact hashed CM-01 V3 SysON architecture capture. It adds the one fresh R2 build123d assembly STEP when its explicit successor lineage is present; the @3 presentation-mesh artifacts when a fresh @3 export is present; and the @3 whole-assembly plan, script, and STEP when a consistent @3 run is identified. No ERPNext identity or individual CAD-child identity is inferred.",
    systemViews: {},
    components: [
      {
        id: "cm01-v3:coffee-machine",
        label: rootDefinition.label,
        kind: "assembly",
        quantity: 1,
        bindings: [
          sysonDefinitionBinding(
            rootDefinition,
            partDefMap.get(rootDefinition.label) ?? architecture.id,
          ),
          ...(assemblyStep ? [assemblyBinding(assemblyStep)] : []),
          ...(assemblyMesh ? [meshBinding(assemblyMesh)] : []),
          ...r3WholeAssemblyBindings(r3WholeAssembly),
        ],
        ...(assemblyMesh
          ? {
            preview: meshPreview(assemblyMesh, "assembly"),
          }
          : {}),
      },
      ...componentDeclarations.map((declaration) => {
        const key = semanticKey(declaration.label);
        const partMesh = r3Meshes.get(key);
        return {
          id: `cm01-v3:${key}`,
          label: declaration.label,
          kind: "part" as const,
          quantity: 1,
          parentId: "cm01-v3:coffee-machine",
          bindings: [
            sysonDefinitionBinding(
              declaration,
              partDefMap.get(declaration.label) ?? architecture.id,
            ),
            ...(partMesh ? [meshBinding(partMesh)] : []),
          ],
          ...(partMesh
            ? {
              preview: meshPreview(partMesh, key),
            }
            : {}),
        };
      }),
    ],
  });
}

function unavailable(
  subjectId: string,
  rationale: string,
): ThreadComponentCatalog {
  return {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId,
    rationale,
    systemViews: {},
    components: [],
  };
}

/**
 * The architecture capture's content-addressed URI namespace — the same store
 * identity the capture reader is wired to. Selecting by producer tool broke
 * the day the anchored oracle requirements were inserted through the very
 * same SysON tool: provenance stopped identifying the artifact, while the
 * store namespace still does.
 */
const CM01_V3_ARCHITECTURE_URI_PREFIX =
  "casys://coffee-machine-cm01-v3-architecture/" as const;

/**
 * URI namespace for part-definitions captures — mirrors the
 * CM01_PART_DEFINITIONS_CAPTURE_DESCRIPTOR uriNamespace in file-capture-store.
 * Used to identify part-definition artifacts in the snapshot without importing
 * the executor module (catalog layer must stay free of executor dependencies).
 */
const CM01_V3_PART_DEFINITIONS_URI_PREFIX =
  "casys://part-definitions-capture/" as const;

/**
 * Artifact name pattern written by the part-definitions executor:
 * "CM-01 <Label> part definition", where <Label> is the exact SysON label
 * ("CoffeeMachine", "DripTray", …).  Group 1 captures the label.
 */
const CM01_V3_PART_DEF_NAME_RE = /^CM-01 (.+) part definition$/;

/**
 * Pattern that identifies a fresh @3 presentation mesh artifact.
 * Group 1 captures the semantic key ("assembly" for the whole model,
 * or the part semantic key such as "drip-tray").
 *
 * The naming contract is server-fixed: executors write exactly these IDs
 * and the catalog recognises them — no agent can forge this prefix.
 */
const CM01_V3_CAD_R3_MESH_ID_RE =
  /^coffee-machine-cm01-v3-cad-r3-[a-f0-9]{64}-mesh-(.+)$/;

/**
 * Pattern that identifies a fresh @3 whole-assembly artifact: the CAD plan,
 * the deterministic build123d script, or the assembly STEP export.
 * Group 1 captures the role suffix: "plan" | "script" | "step".
 *
 * These share the same capture-digest prefix as the @3 mesh artifacts.
 * The naming contract is server-fixed by the @3 run executor.
 */
const CM01_V3_CAD_R3_WHOLE_ASSEMBLY_ID_RE =
  /^coffee-machine-cm01-v3-cad-r3-[a-f0-9]{64}-(plan|script|step)$/;

type R3WholeAssemblySuffix = "plan" | "script" | "step";

/** Expected artifact kind for each @3 whole-assembly role. */
const R3_WHOLE_ASSEMBLY_ARTIFACT_KIND: Record<R3WholeAssemblySuffix, string> = {
  plan: "document",
  script: "script",
  step: "step",
};

/**
 * Collect all fresh @3 presentation-mesh artifacts from the snapshot and
 * return them keyed by semantic key ("assembly" or a part key such as
 * "drip-tray").
 *
 * Fail-closed rules:
 *  - Only fresh build123d mesh artifacts produced by build123d_export qualify.
 *  - All matching artifacts must share the same capture prefix (same run).
 *    Two live captures with different digests is an anomaly: return empty.
 *  - Duplicate keys for the same prefix are rejected.
 *
 * Returns an empty map when no @3 evidence is present, so callers need not
 * distinguish "no run yet" from "unrecognised run" — both yield no preview.
 */
function freshR3MeshArtifactMap(
  artifacts: readonly ThreadArtifact[],
): ReadonlyMap<string, ThreadArtifact> {
  const byKey = new Map<string, ThreadArtifact>();
  let capturePrefix: string | undefined;

  for (const artifact of artifacts) {
    if (
      artifact.kind !== "mesh" ||
      artifact.freshness.status !== "fresh" ||
      artifact.producer.serverId !== "build123d" ||
      artifact.producer.tool !== "build123d_export"
    ) continue;
    const match = CM01_V3_CAD_R3_MESH_ID_RE.exec(artifact.id);
    if (!match) continue;
    const prefix = artifact.id.slice(0, artifact.id.lastIndexOf("-mesh-"));
    if (capturePrefix === undefined) {
      capturePrefix = prefix;
    } else if (capturePrefix !== prefix) {
      // Two distinct @3 captures are both fresh — ambiguous; ignore.
      return new Map();
    }
    const key = match[1]!;
    if (byKey.has(key)) return new Map(); // duplicate key — reject
    byKey.set(key, artifact);
  }
  return byKey;
}

/**
 * Collect all fresh @3 whole-assembly artifacts from the snapshot: the CAD
 * plan, the deterministic build123d script, and the assembly STEP export.
 *
 * Fail-closed rules (mirror of freshR3MeshArtifactMap):
 *  - Only fresh artifacts whose id matches the server-fixed pattern qualify.
 *  - The artifact kind must match the declared role exactly.
 *  - All matching artifacts must share the same capture prefix (same run).
 *    Two concurrent @3 captures with different digests → return empty.
 *  - Duplicate keys for the same prefix are rejected.
 *
 * Returns an empty map when no @3 whole-assembly evidence is present.
 */
function freshR3WholeAssemblyArtifactMap(
  artifacts: readonly ThreadArtifact[],
): ReadonlyMap<R3WholeAssemblySuffix, ThreadArtifact> {
  const byKey = new Map<R3WholeAssemblySuffix, ThreadArtifact>();
  let capturePrefix: string | undefined;

  for (const artifact of artifacts) {
    if (artifact.freshness.status !== "fresh") continue;
    const match = CM01_V3_CAD_R3_WHOLE_ASSEMBLY_ID_RE.exec(artifact.id);
    if (!match) continue;
    const suffix = match[1] as R3WholeAssemblySuffix;
    if (artifact.kind !== R3_WHOLE_ASSEMBLY_ARTIFACT_KIND[suffix]) continue;
    const prefix = artifact.id.slice(0, artifact.id.length - suffix.length - 1);
    if (capturePrefix === undefined) {
      capturePrefix = prefix;
    } else if (capturePrefix !== prefix) {
      // Two distinct @3 captures are both fresh — ambiguous; ignore.
      return new Map();
    }
    if (byKey.has(suffix)) return new Map(); // duplicate key — reject
    byKey.set(suffix, artifact);
  }
  return byKey;
}

/**
 * Asset URL at which the BFF serves the given @3 part STL.
 * The BFF validates that the filename ends in ".stl" and contains only
 * safe characters before forwarding the bytes to the browser.
 */
function r3AssetUrl(semanticKey: string): string {
  return `/api/thread/assets/coffee-machine-cm01-v3-r3-${semanticKey}.stl`;
}

/**
 * Scan the snapshot artifacts for part-definition captures and return a map
 * from SysON label to artifact id.
 *
 * Only `sysml-model` artifacts whose URI starts with
 * CM01_V3_PART_DEFINITIONS_URI_PREFIX and whose name matches
 * "CM-01 <Label> part definition" are included.  Any other artifact —
 * regardless of kind or producer — is ignored, keeping the selector
 * fail-closed: an artifact with an ambiguous or missing name produces no entry
 * rather than a best-effort guess.
 *
 * When no part-definition artifacts are present the returned map is empty and
 * callers fall back to the architecture artifact id, preserving the
 * pre-US-3 behaviour.
 */
async function buildPartDefinitionMap(
  artifacts: readonly ThreadArtifact[],
  captures: Cm01V3CaptureReader,
  architecture: ThreadArtifact,
  context: Cm01V3ArchitectureCapture,
): Promise<ReadonlyMap<string, string>> {
  const map = new Map<string, string>();
  for (const a of artifacts) {
    if (
      a.kind !== "sysml-model" ||
      typeof a.uri !== "string" ||
      !a.uri.startsWith(CM01_V3_PART_DEFINITIONS_URI_PREFIX)
    ) continue;
    if (
      a.freshness.status !== "fresh" ||
      a.producer.serverId !== "syson" ||
      a.producer.tool !== "syson_part_structure" ||
      a.inputArtifactIds.length !== 1 ||
      a.inputArtifactIds[0] !== architecture.id ||
      typeof a.name !== "string"
    ) return new Map();
    const m = CM01_V3_PART_DEF_NAME_RE.exec(a.name);
    if (!m) return new Map();
    const label = m[1]!;
    const expected = context.declarations.find((declaration) =>
      declaration.label === label
    );
    if (!expected || map.has(label)) return new Map();
    try {
      const text = await captures.read(a.fingerprint);
      if (
        !text || !(await partDefinitionCaptureMatches(text, a, expected, context))
      ) {
        return new Map();
      }
    } catch {
      return new Map();
    }
    map.set(label, a.id);
  }
  return map;
}

/**
 * A label is presentation only.  A part-definition capture is eligible for a
 * catalog binding only when its hashed provider record repeats the exact SysON
 * element id and the same architecture context.  This stays in the adapter:
 * the domain catalog receives already verified metadata and performs no I/O.
 */
async function partDefinitionCaptureMatches(
  text: string,
  artifact: ThreadArtifact,
  expected: Cm01V3PartDefinition,
  context: Cm01V3ArchitectureCapture,
): Promise<boolean> {
  try {
    const value = JSON.parse(text);
    const capture = record(value, "CM-01 part-definition capture");
    exactKeys(capture, [
      "architecturePackageId",
      "capturedAt",
      "editingContextId",
      "elementId",
      "label",
      "schemaVersion",
      "structure",
    ], "CM-01 part-definition capture");
    const fingerprint = await sha256Fingerprint(capture);
    const digest = fingerprint.digest;
    return fingerprint.algorithm === artifact.fingerprint.algorithm &&
      digest === artifact.fingerprint.digest &&
      artifact.version === digest &&
      artifact.id === canonicalPartDefinitionArtifactId(expected.label, digest) &&
      artifact.uri === `${CM01_V3_PART_DEFINITIONS_URI_PREFIX}sha256/${digest}` &&
      capture.schemaVersion === "cm01-part-definitions/1.0" &&
      capture.elementId === expected.id &&
      capture.label === expected.label &&
      capture.architecturePackageId === context.architecturePackageId &&
      context.editingContextId !== undefined &&
      capture.editingContextId === context.editingContextId &&
      validPartStructure(capture.structure, expected);
  } catch {
    return false;
  }
}

function canonicalPartDefinitionArtifactId(label: string, digest: string): string {
  return `part-definition-${semanticKey(label)}-${digest}`;
}

function validPartStructure(
  value: unknown,
  expected: Cm01V3PartDefinition,
): boolean {
  try {
    const structure = record(value, "CM-01 part-definition structure");
    exactKeys(
      structure,
      ["maxDepthReached", "partCount", "root", "tree"],
      "CM-01 part-definition structure",
    );
    if (
      structure.maxDepthReached !== false || !Number.isInteger(structure.partCount) ||
      (structure.partCount as number) < 0 || !Array.isArray(structure.tree)
    ) return false;
    const root = record(structure.root, "CM-01 part-definition root");
    exactKeys(root, ["id", "kind", "label"], "CM-01 part-definition root");
    if (
      root.id !== expected.id || root.label !== expected.label ||
      typeof root.kind !== "string" || !root.kind.trim()
    ) return false;
    return countPartTree(structure.tree, "CM-01 part-definition tree") ===
      structure.partCount;
  } catch {
    return false;
  }
}

function countPartTree(nodes: readonly unknown[], context: string): number {
  let count = 0;
  for (const [index, candidate] of nodes.entries()) {
    const node = record(candidate, `${context}[${index}]`);
    exactKeys(
      node,
      ["children", "id", "kind", "label", "quantity", "quantitySource"],
      `${context}[${index}]`,
    );
    if (
      typeof node.id !== "string" || !node.id.trim() ||
      typeof node.label !== "string" || typeof node.kind !== "string" ||
      !node.kind.trim() ||
      (typeof node.quantity !== "number" && typeof node.quantity !== "string") ||
      typeof node.quantitySource !== "string" || !node.quantitySource.trim() ||
      !Array.isArray(node.children)
    ) {
      throw new Error(`${context}[${index}] has an invalid node.`);
    }
    count += 1 + countPartTree(node.children, `${context}[${index}].children`);
  }
  return count;
}

function oneFreshArchitecture(
  artifacts: readonly ThreadArtifact[],
): ThreadArtifact | undefined {
  const matches = artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(CM01_V3_ARCHITECTURE_URI_PREFIX) === true &&
    artifact.freshness.status === "fresh"
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function canonicalArchitectureArtifact(artifact: ThreadArtifact): boolean {
  const digest = artifact.fingerprint.digest;
  return artifact.fingerprint.algorithm === "sha256" &&
    /^[a-f0-9]{64}$/.test(digest) &&
    artifact.version === digest &&
    artifact.id === `coffee-machine-cm01-v3-architecture-${digest}` &&
    artifact.uri === `${CM01_V3_ARCHITECTURE_URI_PREFIX}sha256/${digest}`;
}

function freshR2AssemblyStep(
  artifacts: readonly ThreadArtifact[],
): ThreadArtifact | undefined {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const matches = artifacts.filter((step) => {
    if (
      step.kind !== "step" || step.freshness.status !== "fresh" ||
      step.producer.serverId !== "build123d" ||
      step.producer.tool !== "build123d_export"
    ) return false;
    return step.inputArtifactIds.some((scriptId) => {
      const script = byId.get(scriptId);
      if (
        !script || script.kind !== "script" ||
        script.freshness.status !== "fresh" ||
        script.producer.serverId !== "digital-thread" ||
        script.producer.tool !==
          "compile_coffee_machine_cm01_semantic_cad_plan_r2"
      ) return false;
      return script.inputArtifactIds.some((planId) => {
        const plan = byId.get(planId);
        return plan?.kind === "document" && plan.freshness.status === "fresh" &&
          plan.producer.serverId === "digital-thread" &&
          plan.producer.tool ===
            "compile_coffee_machine_cm01_semantic_cad_plan_r2";
      });
    });
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function sysonDefinitionBinding(
  definition: Cm01V3PartDefinition,
  evidenceArtifactId: string,
) {
  return {
    provider: "syson" as const,
    kind: "part-definition" as const,
    id: definition.id,
    label: definition.label,
    evidenceArtifactId,
  };
}

function assemblyBinding(step: ThreadArtifact) {
  return {
    provider: "build123d" as const,
    kind: "artifact" as const,
    // This is the exact immutable thread artifact emitted by build123d, not a
    // guessed provider path or a claimed child shape.
    id: step.id,
    label: step.name,
    evidenceArtifactId: step.id,
  };
}

/**
 * Binding for a @3 presentation-mesh artifact (assembly or per-part).
 * The `id` is the canonical artifact id in the thread snapshot — not a
 * provider-side path and not the asset-serving URL.
 */
function meshBinding(mesh: ThreadArtifact) {
  return {
    provider: "build123d" as const,
    kind: "artifact" as const,
    id: mesh.id,
    label: mesh.name,
    evidenceArtifactId: mesh.id,
  };
}

/**
 * Preview descriptor that wires the STL viewer to the BFF asset endpoint.
 * `semanticKey` is "assembly" for the full model or the part key such as
 * "drip-tray".  The sha256 field is the presentation mesh hash, distinct from
 * the authoritative CAD hash stored in the evidence artifact.
 */
function meshPreview(
  mesh: ThreadArtifact,
  meshKey: string,
): {
  provider: "build123d";
  artifactId: string;
  mediaType: "model/stl";
  url: string;
  sha256: string;
} {
  return {
    provider: "build123d",
    artifactId: mesh.id,
    mediaType: "model/stl",
    url: r3AssetUrl(meshKey),
    sha256: mesh.fingerprint.digest,
  };
}

/**
 * Bindings for the @3 whole-assembly artifacts in canonical role order:
 * plan → script → step.  The provider is read from the artifact's producer,
 * not guessed: plan/script are compiled by "digital-thread", step exported by
 * "build123d".  An empty map produces an empty array (no @3 run yet).
 */
function r3WholeAssemblyBindings(
  artifacts: ReadonlyMap<R3WholeAssemblySuffix, ThreadArtifact>,
): Array<ReturnType<typeof wholeAssemblyArtifactBinding>> {
  const order: R3WholeAssemblySuffix[] = ["plan", "script", "step"];
  return order.flatMap((key) => {
    const artifact = artifacts.get(key);
    return artifact ? [wholeAssemblyArtifactBinding(artifact)] : [];
  });
}

/**
 * Binding for a @3 whole-assembly artifact (plan, script, or STEP).
 * Provider is derived from the artifact's producer so that the catalog
 * remains an accurate mirror of the server-fixed run contract.
 */
function wholeAssemblyArtifactBinding(artifact: ThreadArtifact) {
  // The R3 run has two distinct producers: digital-thread compiles the plan
  // and script; build123d exports the STEP.  We derive the provider from
  // the artifact's actual producer so that resolveBinding can verify it.
  const provider = artifact.producer.serverId === "build123d"
    ? "build123d" as const
    : "digital-thread" as const;
  return {
    provider,
    kind: "artifact" as const,
    id: artifact.id,
    label: artifact.name,
    evidenceArtifactId: artifact.id,
  };
}

interface Cm01V3PartDefinition {
  readonly id: string;
  readonly label: string;
}

interface Cm01V3ArchitectureCapture {
  readonly declarations: readonly Cm01V3PartDefinition[];
  readonly architecturePackageId: string;
  /** Legacy 1.0 captures do not contain this context, so cannot anchor PartDefs. */
  readonly editingContextId: string | undefined;
}

async function parseArchitectureCapture(
  text: string,
  expectedFingerprint: ContentFingerprint,
): Promise<Cm01V3ArchitectureCapture> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("CM-01 V3 architecture capture is not JSON.");
  }
  const root = record(value, "CM-01 V3 architecture capture");
  exactKeys(root, [
    "architecturePackage",
    "capturedAt",
    "declarations",
    "insertion",
    "kind",
    "operation",
    "recipe",
    "schemaVersion",
    "scope",
    "seed",
    "semanticArtifactRole",
    "statement",
    "trustedRunId",
  ], "CM-01 V3 architecture capture");
  if (
    (root.schemaVersion !== CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA &&
      root.schemaVersion !== CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA_LEGACY) ||
    root.kind !== CM01_V3_ARCHITECTURE_CAPTURE_KIND ||
    root.semanticArtifactRole !== "architecture-model"
  ) {
    throw new Error(
      "CM-01 V3 architecture capture has an unsupported contract.",
    );
  }
  const actualFingerprint = await sha256Fingerprint(root);
  if (
    actualFingerprint.algorithm !== expectedFingerprint.algorithm ||
    actualFingerprint.digest !== expectedFingerprint.digest
  ) {
    throw new Error(
      "CM-01 V3 architecture capture fingerprint does not match evidence.",
    );
  }
  if (!Array.isArray(root.declarations)) {
    throw new Error("CM-01 V3 architecture capture has no declarations.");
  }
  const declarations = root.declarations.map((value, index) => {
    const declaration = record(value, `CM-01 V3 declaration ${index}`);
    exactKeys(
      declaration,
      ["id", "kind", "label"],
      `CM-01 V3 declaration ${index}`,
    );
    if (declaration.kind !== CM01_V3_PART_DEFINITION_KIND) {
      throw new Error(
        "CM-01 V3 architecture capture includes an unsupported declaration.",
      );
    }
    return {
      id: nonEmpty(declaration.id, `CM-01 V3 declaration ${index} id`),
      label: nonEmpty(declaration.label, `CM-01 V3 declaration ${index} label`),
    };
  });
  if (
    new Set(declarations.map((declaration) => declaration.id)).size !==
      declarations.length
  ) {
    throw new Error(
      "CM-01 V3 architecture capture has duplicate SysON definition ids.",
    );
  }
  const architecturePackage = record(
    root.architecturePackage,
    "CM-01 V3 architecture package",
  );
  exactKeys(
    architecturePackage,
    ["id", "kind", "label"],
    "CM-01 V3 architecture package",
  );
  const architecturePackageId = nonEmpty(
    architecturePackage.id,
    "CM-01 V3 architecture package id",
  );
  const seed = record(root.seed, "CM-01 V3 architecture seed");
  const editingContextId = root.schemaVersion === CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA
    ? (() => {
      exactKeys(
        seed,
        ["artifactId", "editingContextId", "fingerprint", "projectId", "rootPackageId"],
        "CM-01 V3 architecture seed",
      );
      return nonEmpty(
        seed.editingContextId,
        "CM-01 V3 architecture seed editing context id",
      );
    })()
    : (() => {
      exactKeys(
        seed,
        ["artifactId", "fingerprint", "projectId", "rootPackageId"],
        "CM-01 V3 architecture seed",
      );
      return undefined;
    })();
  return { declarations, architecturePackageId, editingContextId };
}

function semanticKey(label: string): string {
  const normalized = label
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      `CM-01 V3 SysON definition label ${label} has no stable semantic key.`,
    );
  }
  return normalized;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${context} has unsupported fields.`);
  }
}

function nonEmpty(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${context} must be a non-empty string.`);
  }
  return value;
}
