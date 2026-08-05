import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../domain/thread-snapshot.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../domain/thread-component-catalog.ts";

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
  "coffee-machine-cm01-v3-architecture-capture/1.0" as const;
const CM01_V3_ARCHITECTURE_CAPTURE_KIND = "cm01-sysml-architecture" as const;
const CM01_V3_PART_DEFINITION_KIND =
  "siriusComponents://semantic?domain=sysml&entity=PartDefinition" as const;

/**
 * The immutable store verifies the capture bytes against the requested
 * fingerprint before returning them. This narrow reader keeps the BFF free of
 * storage paths and provider clients.
 */
export interface Cm01V3ArchitectureCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
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
  captures: Cm01V3ArchitectureCaptureReader,
): Promise<ThreadComponentCatalog | undefined> {
  if (snapshot.subject.id !== COFFEE_MACHINE_CM01_V3_SUBJECT_ID) {
    return undefined;
  }

  const architecture = oneFreshArchitecture(snapshot.artifacts);
  if (!architecture) {
    return unavailable(
      snapshot.subject.id,
      "No single fresh CM-01 V3 SysON architecture capture is attached to this revision.",
    );
  }

  let capture: Cm01V3ArchitectureCapture;
  try {
    const text = await captures.read(architecture.fingerprint);
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

  const assemblyStep = freshR2AssemblyStep(snapshot.artifacts);
  const rootDefinition = root[0]!;
  return validateThreadComponentCatalog({
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: snapshot.subject.id,
    rationale:
      "This Product Structure is derived at read time from the exact hashed CM-01 V3 SysON architecture capture. It adds the one fresh R2 build123d assembly STEP when its explicit successor lineage is present; no ERPNext identity or individual CAD-child identity is inferred.",
    systemViews: {},
    components: [
      {
        id: "cm01-v3:coffee-machine",
        label: rootDefinition.label,
        kind: "assembly",
        quantity: 1,
        bindings: [
          sysonDefinitionBinding(rootDefinition, architecture.id),
          ...(assemblyStep ? [assemblyBinding(assemblyStep)] : []),
        ],
      },
      ...componentDeclarations.map((declaration) => ({
        id: `cm01-v3:${semanticKey(declaration.label)}`,
        label: declaration.label,
        kind: "part" as const,
        quantity: 1,
        parentId: "cm01-v3:coffee-machine",
        bindings: [sysonDefinitionBinding(declaration, architecture.id)],
      })),
    ],
  });
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

/**
 * The architecture capture's content-addressed URI namespace — the same store
 * identity the capture reader is wired to. Selecting by producer tool broke
 * the day the anchored oracle requirements were inserted through the very
 * same SysON tool: provenance stopped identifying the artifact, while the
 * store namespace still does.
 */
const CM01_V3_ARCHITECTURE_URI_PREFIX =
  "casys://coffee-machine-cm01-v3-architecture/" as const;

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
        !script || script.kind !== "script" || script.freshness.status !== "fresh" ||
        script.producer.serverId !== "digital-thread" ||
        script.producer.tool !== "compile_coffee_machine_cm01_semantic_cad_plan_r2"
      ) return false;
      return script.inputArtifactIds.some((planId) => {
        const plan = byId.get(planId);
        return plan?.kind === "document" && plan.freshness.status === "fresh" &&
          plan.producer.serverId === "digital-thread" &&
          plan.producer.tool === "compile_coffee_machine_cm01_semantic_cad_plan_r2";
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

interface Cm01V3PartDefinition {
  readonly id: string;
  readonly label: string;
}

interface Cm01V3ArchitectureCapture {
  readonly declarations: readonly Cm01V3PartDefinition[];
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
    root.schemaVersion !== CM01_V3_ARCHITECTURE_CAPTURE_SCHEMA ||
    root.kind !== CM01_V3_ARCHITECTURE_CAPTURE_KIND ||
    root.semanticArtifactRole !== "architecture-model"
  ) {
    throw new Error("CM-01 V3 architecture capture has an unsupported contract.");
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
    exactKeys(declaration, ["id", "kind", "label"], `CM-01 V3 declaration ${index}`);
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
  return { declarations };
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
