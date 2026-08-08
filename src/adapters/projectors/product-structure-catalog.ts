/**
 * Generic product-structure catalog projector for any subject whose thread
 * carries an architecture artifact written by `model.write-architecture@1`.
 *
 * WHY GENERIC — this module must not name any specific product ("coffee",
 * "drone", …). The catalog is derived entirely from the architecture capture
 * whose URI starts with `ARCHITECTURE_CAPTURE_URI_PREFIX`. If a snapshot
 * carries no such artifact, the function returns `undefined`, which is the
 * caller's signal to try another projector (e.g., the CM-01 bounded one).
 *
 * Output contract:
 *  - System PartDef → one `assembly` component (id = `<subjectId>:system`).
 *  - Every other PartDef → one `part` component (id = `<subjectId>:<kebab-label>`).
 *  - Duplicate kebab labels in a valid capture are rejected → `unavailable`.
 *  - Unreadable / tampered captures → `unavailable`, never throws.
 *
 * The projector is read-only: it never writes, never calls MCP, and never
 * advances a revision.
 */

import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../../domain/thread/thread-component-catalog.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../captures/file-capture-store.ts";

// ── Capture schema ────────────────────────────────────────────────────────────

const ARCHITECTURE_CAPTURE_SCHEMA = "architecture-capture/1.0" as const;

// ── Narrow reader interface ───────────────────────────────────────────────────

/** Minimal surface needed by the projector. Satisfied by FileCaptureStore. */
export interface GenericArchitectureCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

// ── Internal capture shape ────────────────────────────────────────────────────

interface GenericArchitectureCapture {
  readonly packageName: string;
  readonly systemName: string;
  readonly packageId: string;
  readonly declarations: readonly { readonly id: string; readonly label: string }[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the generic product-structure catalog from a ThreadSnapshot that
 * carries an architecture artifact written by `model.write-architecture@1`.
 *
 * Returns `undefined` if the snapshot has no architecture artifact — the
 * caller must chain to another projector.
 *
 * Returns an `unavailable` catalog (empty components, explicit rationale) when
 * the capture is present but unreadable, tampered, or structurally invalid.
 *
 * Never throws.
 */
export async function resolveGenericProductStructureCatalog(
  snapshot: ThreadSnapshot,
  captures: GenericArchitectureCaptureReader,
): Promise<ThreadComponentCatalog | undefined> {
  const architecture = findFreshArchitectureArtifact(snapshot.artifacts);
  if (!architecture) return undefined;

  let capture: GenericArchitectureCapture;
  try {
    const text = await captures.read(architecture.fingerprint);
    if (!text) {
      return unavailable(
        snapshot.subject.id,
        "The architecture capture is not readable for this snapshot revision.",
      );
    }
    capture = await parseAndVerifyCapture(text, architecture.fingerprint);
  } catch {
    return unavailable(
      snapshot.subject.id,
      "The architecture capture could not be verified for this snapshot revision.",
    );
  }

  return buildCatalog(snapshot.subject.id, architecture.id, capture);
}

// ── Private: artifact finder ──────────────────────────────────────────────────

function findFreshArchitectureArtifact(
  artifacts: readonly ThreadArtifact[],
): ThreadArtifact | undefined {
  const matches = artifacts.filter(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX) &&
      a.freshness.status === "fresh",
  );
  // Only one fresh architecture artifact is valid; two is ambiguous.
  return matches.length === 1 ? matches[0] : undefined;
}

// ── Private: catalog builder ──────────────────────────────────────────────────

function buildCatalog(
  subjectId: string,
  evidenceArtifactId: string,
  capture: GenericArchitectureCapture,
): ThreadComponentCatalog | undefined {
  // Find the system declaration.
  const systemDecl = capture.declarations.find(
    (d) => d.label === capture.systemName,
  );
  if (!systemDecl) {
    return unavailable(
      subjectId,
      `The architecture capture declares system "${capture.systemName}" but no declaration with that label was found.`,
    );
  }

  // All other declarations are components.
  const componentDecls = capture.declarations.filter(
    (d) => d.id !== systemDecl.id,
  );
  if (componentDecls.length === 0) {
    return unavailable(
      subjectId,
      "The architecture capture has no component declarations beyond the system itself.",
    );
  }

  // Compute semantic keys — must be unique.
  const keys = componentDecls.map((d) => kebabLabel(d.label));
  if (new Set(keys).size !== keys.length) {
    return unavailable(
      subjectId,
      "The architecture capture has duplicate component labels (after kebab normalization).",
    );
  }

  const systemId = `${subjectId}:system`;
  try {
    return validateThreadComponentCatalog({
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId,
      rationale:
        "This Product Structure is derived at read time from the exact hashed " +
        "architecture capture produced by the generic model.write-architecture@1 run. " +
        "The system PartDef is the assembly root; each additional PartDef is a part. " +
        "No ERP identity, no CAD child path, and no inferred binding is included.",
      systemViews: {},
      components: [
        {
          id: systemId,
          label: systemDecl.label,
          kind: "assembly",
          quantity: 1,
          bindings: [
            {
              provider: "syson",
              kind: "part-definition",
              id: systemDecl.id,
              label: systemDecl.label,
              evidenceArtifactId,
            },
          ],
        },
        ...componentDecls.map((decl, index) => ({
          id: `${subjectId}:${keys[index]}`,
          label: decl.label,
          kind: "part" as const,
          quantity: 1,
          parentId: systemId,
          bindings: [
            {
              provider: "syson" as const,
              kind: "part-definition" as const,
              id: decl.id,
              label: decl.label,
              evidenceArtifactId,
            },
          ],
        })),
      ],
    });
  } catch {
    return unavailable(
      subjectId,
      "The catalog derived from the architecture capture failed validation.",
    );
  }
}

// ── Private: unavailable catalog ──────────────────────────────────────────────

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

// ── Private: capture parser ───────────────────────────────────────────────────

/**
 * Parse and verify an architecture capture.
 *
 * FAIL-CLOSED — any unexpected shape, tampered fingerprint, or unsupported
 * schema version throws. The caller wraps all exceptions in `unavailable`.
 */
async function parseAndVerifyCapture(
  text: string,
  expectedFingerprint: ContentFingerprint,
): Promise<GenericArchitectureCapture> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Architecture capture is not valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Architecture capture is not a JSON object.");
  }
  const record = value as Record<string, unknown>;

  if (record.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA) {
    throw new Error(
      `Architecture capture has unsupported schema version: ${
        String(record.schemaVersion)
      }`,
    );
  }

  // Verify the fingerprint against the deterministic JSON representation.
  // sha256Fingerprint accepts a JSON-safe value and sorts keys deterministically.
  const actualFp = await sha256Fingerprint(record);
  if (
    actualFp.algorithm !== expectedFingerprint.algorithm ||
    actualFp.digest !== expectedFingerprint.digest
  ) {
    throw new Error(
      "Architecture capture fingerprint does not match the artifact evidence.",
    );
  }

  const packageName = nonEmptyString(record.packageName, "packageName");
  const systemName = nonEmptyString(record.systemName, "systemName");
  const packageId = nonEmptyString(record.packageId, "packageId");

  if (!Array.isArray(record.declarations)) {
    throw new Error("Architecture capture has no 'declarations' array.");
  }

  const declarations = record.declarations.map((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Architecture capture declaration[${i}] is not an object.`);
    }
    const decl = raw as Record<string, unknown>;
    return {
      id: nonEmptyString(decl.id, `declaration[${i}].id`),
      label: nonEmptyString(decl.label, `declaration[${i}].label`),
    };
  });

  // Duplicate IDs are a tamper/corruption indicator.
  const ids = new Set(declarations.map((d) => d.id));
  if (ids.size !== declarations.length) {
    throw new Error("Architecture capture has duplicate declaration IDs.");
  }

  return { packageName, systemName, packageId, declarations };
}

// ── Private: label normalization ──────────────────────────────────────────────

/**
 * Convert a PascalCase or mixed SysML label to a kebab-case semantic key.
 *
 * Examples: "Wing" → "wing", "DripTray" → "drip-tray",
 * "BodyFrame" → "body-frame", "ACMotor" → "ac-motor".
 *
 * Mirrors the same normalization used in the CM-01 bounded projector.
 */
function kebabLabel(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Architecture capture field "${field}" must be a non-empty string.`,
    );
  }
  return value;
}
