import type { ContentFingerprint } from "./thread-snapshot.ts";

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
  const insertion = await normalizeInsertion(input.insertionResult, rootPackageId);
  const rootChildren = normalizeChildren(
    input.rootChildrenResult,
    rootPackageId,
    "rootChildrenResult",
  );
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

  return {
    insertion,
    architecturePackage: structuredClone(architecturePackage),
    declarations: declarations.map((item) => structuredClone(item)),
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
