import type { ThreadSnapshotExtension } from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  type ThreadSubjectManifest,
  validateThreadSubjectManifest,
} from "../../domain/thread/thread-subject-manifest.ts";

export interface CapturedSysonModelInventory {
  schemaVersion: "captured-syson-model-inventory/1.0";
  capturedAt: string;
  source: "observed-live-read-only";
  project: {
    id: string;
    name: string;
    editingContextId: string;
  };
  provider: {
    endpoint: string;
    tool: "syson_search";
  };
  inventory: {
    query: string;
    count: number;
    results: Array<{ id: string; kind: string; label: string }>;
  };
}

/** Project a read-only SysON inventory into one independently composable branch. */
export async function sysonModelInventoryExtension(
  value: unknown,
  sourceUri: string,
  subjectId: string,
): Promise<ThreadSnapshotExtension> {
  const capture = parseCapturedSysonModelInventory(value);
  const fingerprint = await sha256(canonicalJson(capture.inventory));
  const constraintCount =
    capture.inventory.results.filter((item) =>
      entityName(item.kind) === "ConstraintUsage"
    ).length;
  const requirementCount =
    capture.inventory.results.filter((item) =>
      entityName(item.kind) === "RequirementUsage"
    ).length;
  const artifactId = `syson-inventory-${fingerprint.slice(0, 12)}`;
  const operation = {
    serverId: "syson",
    tool: capture.provider.tool,
    runId: `observed-${compactTimestamp(capture.capturedAt)}`,
  };

  return {
    id: `capture-syson-inventory-${fingerprint.slice(0, 12)}`,
    name: "Capture the reviewed SysON model inventory",
    subjectId,
    capturedAt: capture.capturedAt,
    artifacts: [{
      id: artifactId,
      name:
        `SysON model inventory · ${requirementCount} requirements · ${constraintCount} constraints`,
      kind: "evidence",
      version: fingerprint.slice(0, 12),
      fingerprint: { algorithm: "sha256", digest: fingerprint },
      uri: sourceUri,
      mediaType: "application/json",
      producer: operation,
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: capture.capturedAt,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

/** Use the captured model inventory as the root evidence of a system thread. */
export async function materializeSysonInventorySubject(
  value: unknown,
  sourceUri: string,
  manifest: ThreadSubjectManifest,
): Promise<ThreadSnapshot> {
  const capture = parseCapturedSysonModelInventory(value);
  const validatedManifest = validateThreadSubjectManifest(manifest);
  if (
    !validatedManifest.bindings.some((binding) =>
      binding.provider === "syson" && binding.kind === "project" &&
      binding.id === capture.project.id
    )
  ) {
    throw new Error(
      `No declared SysON project binding for ${capture.project.id}.`,
    );
  }
  const extension = await sysonModelInventoryExtension(
    capture,
    sourceUri,
    validatedManifest.subject.id,
  );
  const artifact = extension.artifacts[0];
  const changeId = `${extension.id}:created:${artifact.id}`;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${manifest.subject.id}:r1:${extension.id}`,
    revision: 1,
    generatedAt: extension.capturedAt,
    subject: {
      ...validatedManifest.subject,
      version: artifact.version,
      modelArtifactId: artifact.id,
    },
    freshness: {
      status: "fresh",
      changedAt: extension.capturedAt,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: extension.id,
      name: extension.name,
      status: "applied",
      createdAt: extension.capturedAt,
      appliedAt: extension.capturedAt,
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: artifact.id },
        summary: `Captured ${artifact.name}.`,
        afterFingerprint: artifact.fingerprint,
      }],
    },
    artifacts: extension.artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `${extension.id}:changes:${artifact.id}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifact.id },
      rationale: "This capture established the system model inventory evidence.",
    }],
    proposedActions: [],
  });
}

export function parseCapturedSysonModelInventory(
  value: unknown,
): CapturedSysonModelInventory {
  const root = record(value, "$"), project = record(root.project, "$.project");
  const provider = record(root.provider, "$.provider");
  const inventory = record(root.inventory, "$.inventory");
  literal(root.schemaVersion, "captured-syson-model-inventory/1.0", "$.schemaVersion");
  literal(root.source, "observed-live-read-only", "$.source");
  literal(provider.tool, "syson_search", "$.provider.tool");
  const capturedAt = nonEmpty(root.capturedAt, "$.capturedAt");
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new Error("$.capturedAt must be ISO-8601.");
  }
  const rawResults = inventory.results;
  if (!Array.isArray(rawResults)) {
    throw new Error("$.inventory.results must be an array.");
  }
  const results = rawResults.map((raw, index) => {
    const item = record(raw, `$.inventory.results[${index}]`);
    return {
      id: nonEmpty(item.id, `$.inventory.results[${index}].id`),
      kind: string(item.kind, `$.inventory.results[${index}].kind`),
      label: string(item.label, `$.inventory.results[${index}].label`),
    };
  });
  const count = nonNegativeInteger(inventory.count, "$.inventory.count");
  if (count !== results.length) {
    throw new Error("$.inventory.count must equal the captured result count.");
  }
  if (new Set(results.map((item) => item.id)).size !== results.length) {
    throw new Error("$.inventory.results contains duplicate element ids.");
  }
  return {
    schemaVersion: "captured-syson-model-inventory/1.0",
    capturedAt,
    source: "observed-live-read-only",
    project: {
      id: nonEmpty(project.id, "$.project.id"),
      name: nonEmpty(project.name, "$.project.name"),
      editingContextId: nonEmpty(
        project.editingContextId,
        "$.project.editingContextId",
      ),
    },
    provider: {
      endpoint: nonEmpty(provider.endpoint, "$.provider.endpoint"),
      tool: "syson_search",
    },
    inventory: {
      query: nonEmpty(inventory.query, "$.inventory.query"),
      count,
      results,
    },
  };
}

function entityName(kind: string): string {
  return kind.match(/entity=([^&]+)/)?.[1] ?? "";
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:.]/g, "");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${
      Object.keys(input).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(input[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, path: string): string {
  const result = string(value, path);
  if (!result.trim()) throw new Error(`${path} must be non-empty.`);
  return result;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  return value;
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}.`);
}
