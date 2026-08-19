import type { ThreadArtifact, ThreadSnapshot } from "./thread-snapshot.ts";

/**
 * Recognised provider namespaces for catalog bindings.
 * "digital-thread" names the backend compiler that produces plan and script
 * artifacts — distinct from build123d which executes the export.
 */
export type ThreadComponentProvider =
  | "syson"
  | "erpnext"
  | "build123d"
  | "digital-thread";

export interface ThreadComponentBinding {
  provider: ThreadComponentProvider;
  /**
   * `part-definition` is intentionally distinct from SysML `part-usage`.
   * A catalog must not pretend an architecture declaration is an occurrence.
   */
  kind:
    | "part-definition"
    | "part-usage"
    | "item"
    | "artifact"
    | "assembly-child";
  /** Exact identity owned by the provider. */
  id: string;
  label: string;
  /** Immutable canonical artifact which captured or produced this identity. */
  evidenceArtifactId: string;
}

export interface ThreadComponentPreview {
  provider: "build123d";
  artifactId: string;
  mediaType: "model/stl" | "model/gltf-binary";
  url: string;
  /** Hash of the presentation asset. It is not the authoritative CAD hash. */
  sha256: string;
}

export interface ThreadComponentAttribute {
  id: string;
  kind: "AttributeUsage";
  label: string;
}

export interface ThreadComponentDefinition {
  id: string;
  label: string;
  kind: "assembly" | "part";
  quantity: number;
  parentId?: string;
  bindings: ThreadComponentBinding[];
  preview?: ThreadComponentPreview;
  /** Optional AttributeUsage rows owned by this component's PartDefinition. */
  attributes?: ThreadComponentAttribute[];
}

/**
 * Reviewed cross-provider identity declarations for one engineering subject.
 *
 * The catalog is necessary but not sufficient to call a binding verified: the
 * referenced evidence artifact must also exist in the current ThreadSnapshot
 * and must have been produced by the declared provider.
 */
export interface ThreadComponentCatalog {
  schemaVersion: "thread-components/1.0";
  authority: "workspace-declared";
  subjectId: string;
  rationale: string;
  systemViews: {
    syson?: {
      projectId: string;
      editingContextId: string;
      diagramId: string;
      diagramLabel: string;
    };
    erpnext?: { bomName: string };
  };
  components: ThreadComponentDefinition[];
}

export interface ResolvedThreadComponentBinding extends ThreadComponentBinding {
  status: "verified" | "unverified";
  reason?: string;
}

export interface ResolvedThreadComponent
  extends Omit<ThreadComponentDefinition, "bindings"> {
  bindings: ResolvedThreadComponentBinding[];
}

export interface ResolvedThreadComponentCatalog
  extends Omit<ThreadComponentCatalog, "components"> {
  components: ResolvedThreadComponent[];
}

export function validateThreadComponentCatalog(
  value: unknown,
): ThreadComponentCatalog {
  const root = record(value, "$"),
    views = record(root.systemViews, "$.systemViews");
  literal(root.schemaVersion, "thread-components/1.0", "$.schemaVersion");
  literal(root.authority, "workspace-declared", "$.authority");
  const components = array(root.components, "$.components").map(
    (value, index) => {
      const path = `$.components[${index}]`;
      const input = record(value, path);
      const kind = oneOf(input.kind, ["assembly", "part"], `${path}.kind`);
      const bindings = array(input.bindings, `${path}.bindings`).map(
        (value, bindingIndex) => binding(value, `${path}.bindings[${bindingIndex}]`),
      );
      const bindingKeys = bindings.map((item) =>
        `${item.provider}:${item.kind}:${item.id}`
      );
      if (new Set(bindingKeys).size !== bindingKeys.length) {
        throw new Error(
          `${path}.bindings contains duplicate provider identities.`,
        );
      }
      const preview = input.preview === undefined
        ? undefined
        : componentPreview(input.preview, `${path}.preview`);
      const attributes = input.attributes === undefined
        ? undefined
        : componentAttributes(input.attributes, `${path}.attributes`);
      return {
        id: nonEmpty(input.id, `${path}.id`),
        label: nonEmpty(input.label, `${path}.label`),
        kind,
        quantity: positiveNumber(input.quantity, `${path}.quantity`),
        ...(input.parentId === undefined
          ? {}
          : { parentId: nonEmpty(input.parentId, `${path}.parentId`) }),
        bindings,
        ...(preview ? { preview } : {}),
        ...(attributes ? { attributes } : {}),
      };
    },
  );
  const componentIds = components.map((component) => component.id);
  if (new Set(componentIds).size !== componentIds.length) {
    throw new Error("$.components contains duplicate component ids.");
  }
  const knownIds = new Set(componentIds);
  for (const [index, component] of components.entries()) {
    if (component.parentId && !knownIds.has(component.parentId)) {
      throw new Error(
        `$.components[${index}].parentId does not name a component.`,
      );
    }
    if (component.parentId === component.id) {
      throw new Error(
        `$.components[${index}].parentId cannot reference itself.`,
      );
    }
  }
  rejectParentCycles(components);

  return {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: nonEmpty(root.subjectId, "$.subjectId"),
    rationale: nonEmpty(root.rationale, "$.rationale"),
    systemViews: {
      ...(views.syson === undefined
        ? {}
        : { syson: sysonView(views.syson, "$.systemViews.syson") }),
      ...(views.erpnext === undefined
        ? {}
        : { erpnext: erpnextView(views.erpnext, "$.systemViews.erpnext") }),
    },
    components,
  };
}

export function resolveThreadComponentCatalog(
  snapshot: ThreadSnapshot,
  catalog?: ThreadComponentCatalog,
): ResolvedThreadComponentCatalog {
  const validated = catalog
    ? validateThreadComponentCatalog(catalog)
    : emptyThreadComponentCatalog(snapshot.subject.id);
  if (validated.subjectId !== snapshot.subject.id) {
    throw new Error(
      `Component catalog subject ${validated.subjectId} does not match snapshot subject ${snapshot.subject.id}.`,
    );
  }
  const artifacts = new Map(
    snapshot.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  return {
    ...validated,
    components: validated.components.map((component) => ({
      ...component,
      bindings: component.bindings.map((item) => resolveBinding(item, artifacts)),
    })),
  };
}

export function emptyThreadComponentCatalog(
  subjectId: string,
): ThreadComponentCatalog {
  return {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId,
    rationale: "No reviewed component identity catalog is attached to this subject.",
    systemViews: {},
    components: [],
  };
}

function resolveBinding(
  binding: ThreadComponentBinding,
  artifacts: Map<string, ThreadArtifact>,
): ResolvedThreadComponentBinding {
  const evidence = artifacts.get(binding.evidenceArtifactId);
  if (!evidence) {
    return {
      ...binding,
      status: "unverified",
      reason: "The declared evidence artifact is absent from this snapshot revision.",
    };
  }
  if (evidence.producer.serverId !== binding.provider) {
    return {
      ...binding,
      status: "unverified",
      reason:
        `Evidence belongs to ${evidence.producer.serverId}, not ${binding.provider}.`,
    };
  }
  return { ...binding, status: "verified" };
}

function binding(value: unknown, path: string): ThreadComponentBinding {
  const input = record(value, path);
  return {
    provider: oneOf(
      input.provider,
      ["syson", "erpnext", "build123d", "digital-thread"],
      `${path}.provider`,
    ),
    kind: oneOf(
      input.kind,
      ["part-definition", "part-usage", "item", "artifact", "assembly-child"],
      `${path}.kind`,
    ),
    id: nonEmpty(input.id, `${path}.id`),
    label: nonEmpty(input.label, `${path}.label`),
    evidenceArtifactId: nonEmpty(
      input.evidenceArtifactId,
      `${path}.evidenceArtifactId`,
    ),
  };
}

function componentAttributes(
  value: unknown,
  path: string,
): ThreadComponentAttribute[] {
  const attributes = array(value, path).map((entry, index) => {
    const input = record(entry, `${path}[${index}]`);
    return {
      id: nonEmpty(input.id, `${path}[${index}].id`),
      kind: oneOf(input.kind, ["AttributeUsage"], `${path}[${index}].kind`),
      label: nonEmpty(input.label, `${path}[${index}].label`),
    };
  });
  const ids = attributes.map((attribute) => attribute.id);
  const labels = attributes.map((attribute) => attribute.label);
  if (new Set(ids).size !== ids.length || new Set(labels).size !== labels.length) {
    throw new Error(`${path} contains duplicate AttributeUsage identities.`);
  }
  return attributes;
}

function componentPreview(
  value: unknown,
  path: string,
): ThreadComponentPreview {
  const input = record(value, path);
  literal(input.provider, "build123d", `${path}.provider`);
  const mediaType = oneOf(
    input.mediaType,
    ["model/stl", "model/gltf-binary"],
    `${path}.mediaType`,
  );
  const sha256 = nonEmpty(input.sha256, `${path}.sha256`);
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`${path}.sha256 must be a lowercase SHA-256 digest.`);
  }
  const url = nonEmpty(input.url, `${path}.url`);
  if (!url.startsWith("/api/thread/assets/")) {
    throw new Error(`${path}.url must use the Workbench asset route.`);
  }
  return {
    provider: "build123d",
    artifactId: nonEmpty(input.artifactId, `${path}.artifactId`),
    mediaType,
    url,
    sha256,
  };
}

function sysonView(value: unknown, path: string) {
  const input = record(value, path);
  return {
    projectId: nonEmpty(input.projectId, `${path}.projectId`),
    editingContextId: nonEmpty(
      input.editingContextId,
      `${path}.editingContextId`,
    ),
    diagramId: nonEmpty(input.diagramId, `${path}.diagramId`),
    diagramLabel: nonEmpty(input.diagramLabel, `${path}.diagramLabel`),
  };
}

function erpnextView(value: unknown, path: string) {
  const input = record(value, path);
  return { bomName: nonEmpty(input.bomName, `${path}.bomName`) };
}

function rejectParentCycles(components: ThreadComponentDefinition[]): void {
  const parents = new Map(
    components.flatMap((component) =>
      component.parentId ? [[component.id, component.parentId] as const] : []
    ),
  );
  for (const component of components) {
    const seen = new Set<string>();
    let current: string | undefined = component.id;
    while (current) {
      if (seen.has(current)) {
        throw new Error(`$.components contains a parent cycle at ${current}.`);
      }
      seen.add(current);
      current = parents.get(current);
    }
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new Error(`${path} must equal ${String(expected)}.`);
  }
}

function oneOf<const T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${path} must be one of ${values.join(", ")}.`);
  }
  return value as T;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive finite number.`);
  }
  return value;
}
