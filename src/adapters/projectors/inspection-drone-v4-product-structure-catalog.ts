import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../../domain/thread/thread-component-catalog.ts";
import {
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_SCHEMA,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_URI_PREFIX,
} from "../executors/inspection-drone-v4-part-definitions-run-executor.ts";

export const INSPECTION_DRONE_V4_SUBJECT_ID = "project:inspection-drone-v4" as const;

export interface InspectionDroneV4CaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

/**
 * The Workbench view has no provider access. It reconstructs only the six
 * exact identities recorded in the immutable, content-addressed capture.
 */
export async function resolveInspectionDroneV4ProductStructureCatalog(
  snapshot: ThreadSnapshot,
  captures: InspectionDroneV4CaptureReader,
): Promise<ThreadComponentCatalog | undefined> {
  if (snapshot.subject.id !== INSPECTION_DRONE_V4_SUBJECT_ID) return undefined;
  const archived = archivedRefKeys(snapshot);
  const matches = snapshot.artifacts.filter((artifact) =>
    !archived.has(`artifact:${artifact.id}`) &&
    artifact.kind === "sysml-model" &&
    artifact.id.startsWith("inspection-drone-v4-part-definitions-") &&
    artifact.uri?.startsWith(INSPECTION_DRONE_V4_PART_DEFINITIONS_URI_PREFIX) &&
    artifact.uri ===
      `${INSPECTION_DRONE_V4_PART_DEFINITIONS_URI_PREFIX}${artifact.fingerprint.digest}`
  );
  if (matches.length !== 1) {
    return unavailable(
      snapshot.subject.id,
      "No single current, canonically content-addressed inspection-drone PartDefinitions bundle is attached to this revision.",
    );
  }
  const artifact = matches[0]!;
  try {
    const text = await captures.read(artifact.fingerprint);
    if (!text) {
      return unavailable(
        snapshot.subject.id,
        "The exact inspection-drone PartDefinitions bundle is not readable from its dedicated store.",
      );
    }
    const bundle = parseBundle(text, artifact.id, artifact.fingerprint.digest);
    return catalog(snapshot.subject.id, artifact.id, bundle);
  } catch {
    return unavailable(
      snapshot.subject.id,
      "The inspection-drone PartDefinitions bundle cannot be verified for this revision.",
    );
  }
}

type Bundle = Readonly<{
  editingContextId: string;
  definitions: readonly Readonly<
    { id: string; label: string; kind: string; tree: readonly Usage[] }
  >[];
  rootUsageTypes: readonly Readonly<{ usageId: string; typeId: string }>[];
}>;
type Usage = Readonly<
  {
    id: string;
    label: string;
    kind: string;
    quantity: number | string;
    quantitySource: string;
    children: readonly Usage[];
  }
>;
const LABELS = [
  "InspectionDrone",
  "Airframe",
  "EnergySystem",
  "PropulsionSystem",
  "AvionicsAndFlightControl",
  "InspectionCameraPayload",
] as const;

function catalog(
  subjectId: string,
  evidenceArtifactId: string,
  bundle: Bundle,
): ThreadComponentCatalog {
  const definitions = new Map(
    bundle.definitions.map((definition) => [definition.label, definition]),
  );
  const root = definitions.get("InspectionDrone")!;
  const usages = new Map(root.tree.map((usage) => [usage.label, usage]));
  const children = LABELS.slice(1).map((label) => {
    const definition = definitions.get(label)!;
    const usage = one(
      [...usages.values()].filter((candidate) =>
        candidate.id === usageForType(bundle, definition.id)
      ),
      `${label} usage`,
    );
    const quantity = exactOne(usage);
    return {
      id: `inspection-drone-v4:${slug(label)}`,
      label,
      kind: "part" as const,
      quantity,
      parentId: "inspection-drone-v4:inspection-drone",
      bindings: [
        {
          provider: "syson" as const,
          kind: "part-definition" as const,
          id: definition.id,
          label,
          evidenceArtifactId,
        },
        {
          provider: "syson" as const,
          kind: "part-usage" as const,
          id: usage.id,
          label: usage.label,
          evidenceArtifactId,
        },
      ],
    };
  });
  return validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId,
    rationale:
      "The Product Structure is derived only from the current content-addressed inspection-drone PartDefinitions bundle. The root is the single selected system definition; each child quantity is retained only where the provider-attested PartUsage explicitly reports one. No CAD, physics, BOM, cost, or invented quantity is shown.",
    systemViews: {},
    components: [{
      id: "inspection-drone-v4:inspection-drone",
      label: "InspectionDrone",
      kind: "assembly",
      quantity: 1,
      bindings: [{
        provider: "syson",
        kind: "part-definition",
        id: root.id,
        label: root.label,
        evidenceArtifactId,
      }],
    }, ...children],
  });
}

/** Return the usage identity matched to a captured PartDefinition type id. */
function usageForType(bundle: Bundle, typeId: string): string {
  // The bundle is deliberately small. Its root capture stores the PartUsage
  // identity while the definition records preserve strict ordering: types are
  // the five labels in the reviewed architecture recipe, not labels guessed at runtime.
  const index = LABELS.slice(1).findIndex((label) =>
    bundle.definitions.find((definition) => definition.label === label)?.id === typeId
  );
  if (index < 0) {
    throw new Error("The product-structure bundle lost a reviewed type identity.");
  }
  const typed = one(
    bundle.rootUsageTypes.filter((item) => item.typeId === typeId),
    "typed usage",
  );
  return typed.usageId;
}

function parseBundle(text: string, artifactId: string, digest: string): Bundle {
  const raw = JSON.parse(text) as unknown;
  const record = closed(raw, [
    "architecture",
    "capturedAt",
    "definitions",
    "kind",
    "operation",
    "schemaVersion",
    "scope",
    "statement",
    "trustedRunId",
  ]);
  if (
    record.schemaVersion !== INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_SCHEMA ||
    record.kind !== "inspection-drone-v4-part-definitions" ||
    !Array.isArray(record.definitions)
  ) throw new Error("Unexpected PartDefinitions capture schema.");
  const architecture = closed(record.architecture, [
    "architecturePackage",
    "artifactId",
    "editingContextId",
    "fingerprint",
    "recipe",
    "rootUsageTypes",
    "uri",
  ]);
  if (
    typeof architecture.editingContextId !== "string" || !architecture.editingContextId
  ) throw new Error("The PartDefinitions capture has no SysON editing context.");
  const definitions = record.definitions.map((candidate, index) => {
    const item = closed(candidate, ["definition", "structure"]);
    const definition = element(item.definition, `definitions[${index}].definition`);
    const structure = closed(item.structure, [
      "maxDepthReached",
      "partCount",
      "root",
      "tree",
    ]);
    const root = element(structure.root, `definitions[${index}].structure.root`);
    if (
      root.id !== definition.id || root.label !== definition.label ||
      structure.maxDepthReached !== false || !Array.isArray(structure.tree)
    ) {
      throw new Error(
        "The PartDefinitions structure does not match its exact definition identity.",
      );
    }
    const tree = structure.tree.map((usage, usageIndex) =>
      parseUsage(usage, `definitions[${index}].tree[${usageIndex}]`)
    );
    if (
      typeof structure.partCount !== "number" ||
      !Number.isSafeInteger(structure.partCount) || count(tree) !== structure.partCount
    ) throw new Error("The PartDefinitions structure count is not exact.");
    return { ...definition, tree };
  });
  if (
    definitions.length !== LABELS.length ||
    definitions.some((definition, index) => definition.label !== LABELS[index]) ||
    new Set(definitions.map((definition) => definition.id)).size !== LABELS.length ||
    !artifactId.endsWith(digest)
  ) {
    throw new Error(
      "The bundle does not expose the six reviewed PartDefinition identities in deterministic order.",
    );
  }
  if (!Array.isArray(architecture.rootUsageTypes)) {
    throw new Error("The bundle has no exact PartUsage type bindings.");
  }
  const rootUsageTypes = architecture.rootUsageTypes.map((candidate, index) => {
    const item = closed(candidate, ["type", "usage"]);
    return {
      usageId: element(item.usage, `rootUsageTypes[${index}].usage`).id,
      typeId: element(item.type, `rootUsageTypes[${index}].type`).id,
    };
  });
  const root = definitions[0]!;
  if (
    root.tree.length !== 5 || root.tree.some((usage) => usage.children.length !== 0) ||
    new Set(root.tree.map((usage) => usage.id)).size !== 5
  ) {
    throw new Error(
      "The InspectionDrone root no longer has five direct usage anchors.",
    );
  }
  if (
    rootUsageTypes.length !== 5 ||
    new Set(rootUsageTypes.map((item) => item.usageId)).size !== 5 ||
    new Set(rootUsageTypes.map((item) => item.typeId)).size !== 5 ||
    rootUsageTypes.some((item) =>
      !root.tree.some((usage) => usage.id === item.usageId) ||
      !definitions.slice(1).some((definition) => definition.id === item.typeId)
    )
  ) {
    throw new Error(
      "The exact PartUsage to PartDefinition binding set is incomplete or ambiguous.",
    );
  }
  return {
    editingContextId: architecture.editingContextId,
    definitions,
    rootUsageTypes,
  };
}

function exactOne(usage: Usage): number {
  if ((usage.quantity !== 1 && usage.quantity !== "1") || !usage.quantitySource) {
    throw new Error(
      "A Product catalog quantity is exposed only when SysON explicitly attested one.",
    );
  }
  return 1;
}
function unavailable(subjectId: string, rationale: string): ThreadComponentCatalog {
  return {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId,
    rationale,
    systemViews: {},
    components: [],
  };
}
function parseUsage(value: unknown, path: string): Usage {
  const record = closed(value, [
    "children",
    "id",
    "kind",
    "label",
    "quantity",
    "quantitySource",
  ]);
  if (
    !Array.isArray(record.children) ||
    (typeof record.quantity !== "number" && typeof record.quantity !== "string") ||
    typeof record.quantitySource !== "string" || !record.quantitySource
  ) throw new Error(`${path} lacks an attested quantity.`);
  return {
    id: text(record.id, `${path}.id`),
    label: text(record.label, `${path}.label`),
    kind: text(record.kind, `${path}.kind`),
    quantity: record.quantity,
    quantitySource: record.quantitySource,
    children: record.children.map((child, index) =>
      parseUsage(child, `${path}.children[${index}]`)
    ),
  };
}
function element(
  value: unknown,
  path: string,
): { id: string; label: string; kind: string } {
  const record = closed(value, ["id", "kind", "label"]);
  return {
    id: text(record.id, `${path}.id`),
    kind: text(record.kind, `${path}.kind`),
    label: text(record.label, `${path}.label`),
  };
}
function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Capture is not an object.");
  }
  const actual = Object.keys(value as Record<string, unknown>).sort(),
    expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new Error("Capture has an unsupported shape.");
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${path} must be non-empty.`);
  }
  return value;
}
function count(usages: readonly Usage[]): number {
  return usages.reduce((total, usage) => total + 1 + count(usage.children), 0);
}
function one<T>(values: readonly T[], name: string): T {
  if (values.length !== 1) throw new Error(`Expected one ${name}.`);
  return values[0]!;
}
function slug(value: string): string {
  return value.replace(
    /[A-Z]/g,
    (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`,
  );
}
