/** Exact browser-independent contract for the inspection-drone V4 architecture capture. */
import { EngineeringProjectCommandError } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT,
  INSPECTION_DRONE_V4_PART_USAGE_CONTRACT,
  INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT,
} from "../../../domain/inspection-drone/author/inspection-drone-v4-architecture.ts";

export const INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_SCHEMA =
  "inspection-drone-v4-architecture-capture/1.0" as const;
export const INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX =
  "casys://inspection-drone-v4-architecture-capture/sha256/" as const;

export type InspectionDroneV4Element = Readonly<{
  id: string;
  kind: string;
  label: string;
}>;

export type InspectionDroneV4ArchitectureCapture = Readonly<{
  editingContextId: string;
  package: InspectionDroneV4Element;
  recipeDigest: string;
  seed: Readonly<{
    artifactId: string;
    fingerprint: ContentFingerprint;
    rootPackageId: string;
  }>;
  declarationByLabel: ReadonlyMap<string, InspectionDroneV4Element>;
  rootUsages: readonly Readonly<{
    usage: InspectionDroneV4Element;
    type: InspectionDroneV4Element;
  }>[];
}>;

const FIXED_ARCHITECTURE_RECIPE_DIGEST =
  "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530" as const;
const REQUIRED_DECLARATIONS = [
  ...INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT.map((label) => ({
    label,
    kind: "PartDefinition",
  })),
  ...INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((requirement) => ({
    label: requirement.label,
    kind: "RequirementDefinition",
  })),
] as const;

/** Parse and bind the exact reviewed inspection-drone V4 architecture capture. */
export function parseInspectionDroneV4ArchitectureCapture(
  text: string,
  artifact: ThreadArtifact,
): InspectionDroneV4ArchitectureCapture {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw denied("The exact architecture capture is not JSON.");
  }
  const record = closed(raw, [
    "architecturePackage",
    "authorization",
    "capturedAt",
    "declarations",
    "explicitTbd",
    "insertion",
    "kind",
    "operation",
    "readback",
    "recipe",
    "schemaVersion",
    "scope",
    "seed",
    "statement",
    "trustedRunId",
  ]);
  if (
    record.schemaVersion !== INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_SCHEMA ||
    record.kind !== "inspection-drone-v4-architecture" ||
    !same(record.operation, INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION)
  ) {
    throw denied(
      "The architecture capture does not attest the reviewed V4 architecture operation.",
    );
  }
  if (
    !artifact.uri ||
    artifact.uri !==
      `${INSPECTION_DRONE_V4_ARCHITECTURE_URI_PREFIX}${artifact.fingerprint.digest}` ||
    !artifact.id.endsWith(artifact.fingerprint.digest)
  ) throw denied("The architecture artifact is not canonically content-addressed.");
  const seed = closed(record.seed, [
    "artifactId",
    "editingContextId",
    "fingerprint",
    "rootPackageId",
  ]);
  const pkg = element(record.architecturePackage, "architecturePackage");
  const recipe = closed(record.recipe, ["textSha256"]);
  const recipeFingerprint = fingerprint(recipe.textSha256, "recipe.textSha256");
  const insertion = closed(record.insertion, ["parentId", "textSha256"]);
  if (
    typeof seed.editingContextId !== "string" || !seed.editingContextId ||
    !kind(pkg.kind, "Package") || pkg.label !== "InspectionDroneArchitecture" ||
    recipeFingerprint.digest !== FIXED_ARCHITECTURE_RECIPE_DIGEST ||
    insertion.parentId !== seed.rootPackageId ||
    insertion.textSha256 !== recipeFingerprint.digest
  ) {
    throw denied(
      "The architecture capture has no exact SysON context, package, or recipe identity.",
    );
  }
  if (
    !Array.isArray(record.declarations) ||
    !Array.isArray(
      closed(record.readback, [
        "inspectionDrone",
        "partUsages",
        "provider",
        "requirements",
      ]).partUsages,
    )
  ) throw denied("The architecture capture has no exact declaration/readback list.");
  const seedFingerprint = fingerprint(seed.fingerprint, "seed.fingerprint");
  if (
    typeof seed.artifactId !== "string" || !seed.artifactId ||
    typeof seed.rootPackageId !== "string" || !seed.rootPackageId
  ) throw denied("The architecture capture has an invalid seed identity.");
  const declarations = record.declarations.map((item, index) =>
    element(item, `declarations[${index}]`)
  );
  const byLabel = new Map(declarations.map((item) => [item.label, item]));
  if (
    declarations.length !== REQUIRED_DECLARATIONS.length ||
    byLabel.size !== REQUIRED_DECLARATIONS.length ||
    new Set(declarations.map((item) => item.id)).size !==
      REQUIRED_DECLARATIONS.length ||
    REQUIRED_DECLARATIONS.some((expected, index) =>
      declarations[index]?.label !== expected.label ||
      !kind(declarations[index]?.kind ?? "", expected.kind)
    )
  ) {
    throw denied(
      "The architecture capture does not contain exactly the six reviewed PartDefinition identities.",
    );
  }
  const readback = closed(record.readback, [
    "inspectionDrone",
    "partUsages",
    "provider",
    "requirements",
  ]);
  const root = element(readback.inspectionDrone, "readback.inspectionDrone");
  if (
    root.id !== byLabel.get("InspectionDrone")!.id ||
    root.label !== "InspectionDrone" || !kind(root.kind, "PartDefinition")
  ) {
    throw denied(
      "The architecture readback root does not match the captured InspectionDrone identity.",
    );
  }
  const rawUsages = readback.partUsages;
  if (!Array.isArray(rawUsages)) {
    throw denied("The architecture capture has no exact PartUsage readback list.");
  }
  const rootUsages = rawUsages.map((item, index) => {
    const itemRecord = closed(item, ["type", "usage"]);
    return {
      usage: element(itemRecord.usage, `partUsages[${index}].usage`),
      type: element(itemRecord.type, `partUsages[${index}].type`),
    };
  });
  if (
    rootUsages.length !== INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.length ||
    new Set(rootUsages.map((item) => item.usage.id)).size !== 5 ||
    new Set(rootUsages.map((item) => item.type.id)).size !== 5 ||
    INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.some((expected, index) => {
      const actual = rootUsages[index];
      const expectedType = byLabel.get(expected.type)!;
      return !actual ||
        actual.usage.label !== expected.label ||
        !kind(actual.usage.kind, "PartUsage") ||
        actual.type.id !== expectedType.id ||
        actual.type.label !== expectedType.label ||
        actual.type.kind !== expectedType.kind;
    })
  ) {
    throw denied(
      "The architecture readback does not bind the five exact PartUsage type identities.",
    );
  }
  const requirements = readback.requirements;
  if (
    !Array.isArray(requirements) ||
    requirements.length !== INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.length
  ) {
    throw denied(
      "The architecture capture does not contain the four reviewed requirement attestations.",
    );
  }
  for (let index = 0; index < requirements.length; index++) {
    const item = closed(requirements[index], ["documentation", "requirement"]);
    const requirement = element(item.requirement, `requirements[${index}].requirement`);
    const expected = INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT[index]!;
    if (
      requirement.label !== expected.label ||
      requirement.id !== byLabel.get(expected.label)!.id ||
      !kind(requirement.kind, "RequirementDefinition") ||
      item.documentation !== expected.documentation
    ) {
      throw denied(
        "The architecture capture requirement evidence differs from the fixed reviewed contract.",
      );
    }
  }
  return {
    editingContextId: seed.editingContextId,
    package: pkg,
    recipeDigest: recipeFingerprint.digest,
    seed: {
      artifactId: seed.artifactId,
      fingerprint: seedFingerprint,
      rootPackageId: seed.rootPackageId,
    },
    declarationByLabel: byLabel,
    rootUsages,
  };
}

function denied(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_input", message);
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const record = closed(value, ["algorithm", "digest"]);
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw denied(`${path} is not a SHA-256 content fingerprint.`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function element(value: unknown, path: string): InspectionDroneV4Element {
  const record = closed(value, ["id", "kind", "label"]);
  return {
    id: nonEmpty(record.id, `${path}.id`),
    kind: nonEmpty(record.kind, `${path}.kind`),
    label: nonEmpty(record.label, `${path}.label`),
  };
}

function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Capture/provider response must be an object.");
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) throw new Error("Capture/provider response has an unsupported shape.");
  return value as Record<string, unknown>;
}

function same(value: unknown, expected: unknown): boolean {
  return deterministicJson(value) === deterministicJson(expected);
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${path} must be non-empty.`);
  }
  return value;
}

function kind(value: string, expected: string): boolean {
  return value === `sysml::${expected}` || value.endsWith(`entity=${expected}`);
}
