import type {
  ThreadProviderBindingProof,
  ThreadSnapshotExtension,
} from "./thread-snapshot-extension.ts";

export interface ThreadSubjectBinding extends ThreadProviderBindingProof {}

export interface ThreadSubjectManifest {
  schemaVersion: "1.0";
  authority: "workspace-declared";
  rationale: string;
  subject: {
    id: string;
    name: string;
    kind: "system" | "assembly" | "part" | "process";
  };
  bindings: ThreadSubjectBinding[];
}

export function validateThreadSubjectManifest(value: unknown): ThreadSubjectManifest {
  const root = record(value, "$"), subject = record(root.subject, "$.subject");
  literal(root.schemaVersion, "1.0", "$.schemaVersion");
  literal(root.authority, "workspace-declared", "$.authority");
  const bindings = array(root.bindings, "$.bindings").map((raw, index) => {
    const input = record(raw, `$.bindings[${index}]`);
    return {
      provider: nonEmpty(input.provider, `$.bindings[${index}].provider`),
      kind: nonEmpty(input.kind, `$.bindings[${index}].kind`),
      id: nonEmpty(input.id, `$.bindings[${index}].id`),
    };
  });
  const keys = bindings.map(bindingKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("$.bindings contains duplicate provider identities.");
  }
  const kind = nonEmpty(subject.kind, "$.subject.kind");
  if (!["system", "assembly", "part", "process"].includes(kind)) {
    throw new Error("$.subject.kind is unsupported.");
  }
  return {
    schemaVersion: "1.0",
    authority: "workspace-declared",
    rationale: nonEmpty(root.rationale, "$.rationale"),
    subject: {
      id: nonEmpty(subject.id, "$.subject.id"),
      name: nonEmpty(subject.name, "$.subject.name"),
      kind: kind as ThreadSubjectManifest["subject"]["kind"],
    },
    bindings,
  };
}

/**
 * Retarget provider evidence only through a reviewed, exact identity binding.
 * Labels and fuzzy names are never accepted as joins.
 */
export function bindThreadSnapshotExtension(
  extension: ThreadSnapshotExtension,
  manifest: ThreadSubjectManifest,
  binding: ThreadSubjectBinding,
): ThreadSnapshotExtension {
  const validated = validateThreadSubjectManifest(manifest);
  if (
    !validated.bindings.some((candidate) =>
      bindingKey(candidate) === bindingKey(binding)
    )
  ) {
    throw new Error(
      `No declared subject binding for ${binding.provider}:${binding.kind}:${binding.id}.`,
    );
  }
  if (!extensionProvesBinding(extension, binding)) {
    throw new Error(
      `Extension ${extension.id} does not structurally prove ` +
        `${binding.provider}:${binding.kind}:${binding.id}.`,
    );
  }
  return { ...structuredClone(extension), subjectId: validated.subject.id };
}

/**
 * A declared workspace join is necessary but insufficient: evidence must also
 * carry the exact provider identity that is being joined. This keeps subject
 * assignment from becoming a caller-controlled label rewrite.
 */
function extensionProvesBinding(
  extension: ThreadSnapshotExtension,
  binding: ThreadSubjectBinding,
): boolean {
  if (extension.bindingProofs?.some((proof) => sameBinding(proof, binding))) {
    return true;
  }
  if (binding.kind === "run") {
    return extension.artifacts.some((artifact) =>
      artifact.producer.serverId === binding.provider &&
      artifact.producer.runId === binding.id
    );
  }
  if (binding.kind === "artifact-path") {
    return extension.artifacts.some((artifact) =>
      artifact.producer.serverId === binding.provider && artifact.uri === binding.id
    );
  }
  return false;
}

function sameBinding(
  left: ThreadProviderBindingProof,
  right: ThreadSubjectBinding,
): boolean {
  return left.provider === right.provider && left.kind === right.kind &&
    left.id === right.id;
}

function bindingKey(binding: ThreadSubjectBinding): string {
  return `${binding.provider}\u0000${binding.kind}\u0000${binding.id}`;
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
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}.`);
}
