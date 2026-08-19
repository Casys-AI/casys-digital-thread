/**
 * Provenance that lets `design.write-geometry@1` seal only an admitted CAD draft.
 *
 * A sandbox preview can still persist a draft. Promotion requires this stamp,
 * whose source fingerprint must equal the captured script hash, plus at least
 * one module-level named numeric lever in every sealed script.
 */

import { listNamedNumericLevers } from "../../compile/source/named-cad-levers.ts";
import { exactRecord, literalValue, safeId } from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const GEOMETRY_DRAFT_ADMISSION_SCHEMA = "geometry-draft-admission/1.0" as const;

export interface GeometryDraftAdmission {
  readonly schemaVersion: typeof GEOMETRY_DRAFT_ADMISSION_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly sourceFingerprint: ContentFingerprint;
}

export function parseGeometryDraftAdmission(
  value: unknown,
  path = "$geometryDraft.admission",
): GeometryDraftAdmission {
  const record = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint", "sourceFingerprint"],
    path,
  );
  literalValue(
    record.schemaVersion,
    GEOMETRY_DRAFT_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const fingerprint = parseFingerprint(record.fingerprint, `${path}.fingerprint`);
  const artifactId = safeId(record.artifactId, `${path}.artifactId`);
  if (artifactId !== `technical-compilation-admission-${fingerprint.digest}`) {
    throw new TypeError(
      `${path}.artifactId must derive from the admission fingerprint.`,
    );
  }
  return {
    schemaVersion: GEOMETRY_DRAFT_ADMISSION_SCHEMA,
    artifactId,
    fingerprint,
    sourceFingerprint: parseFingerprint(
      record.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
  };
}

export function assertDraftJoinsAdmission(
  scriptHash: ContentFingerprint,
  admission: GeometryDraftAdmission,
): void {
  if (!fingerprintsEqual(scriptHash, admission.sourceFingerprint)) {
    throw new TypeError(
      "The geometry draft script hash does not equal the stamped admission source.",
    );
  }
}

export function requireNamedCadLeverInDraftScript(
  script: string,
  path = "$geometryDraft.script",
): void {
  if (listNamedNumericLevers(script).length === 0) {
    throw new TypeError(
      `${path} has no module-level named numeric lever.`,
    );
  }
}

/**
 * Fail-closed promotion predicate: the persisted draft must name the exact
 * compile.seal-admission@1 artefact and every sealed script must be coté.
 */
export function requireCanonicalGeometryDraftAdmission(
  draft: unknown,
): GeometryDraftAdmission {
  if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
    throw new TypeError("Geometry draft capture must be an object.");
  }
  const record = draft as Record<string, unknown>;
  const admission = parseGeometryDraftAdmission(
    record.admission,
    "$geometryDraft.admission",
  );
  const scripts = draftScriptIdentities(record);
  if (scripts.length === 0) {
    throw new TypeError("Geometry draft capture has no sealed CAD script.");
  }
  assertDraftJoinsAdmission(scripts[0]!.hash, admission);
  for (const script of scripts) {
    requireNamedCadLeverInDraftScript(script.text, script.path);
  }
  return admission;
}

function draftScriptIdentities(
  draft: Record<string, unknown>,
): readonly {
  readonly text: string;
  readonly hash: ContentFingerprint;
  readonly path: string;
}[] {
  if (typeof draft.script === "string") {
    return [{
      text: draft.script,
      hash: parseFingerprint(draft.scriptHash, "$geometryDraft.scriptHash"),
      path: "$geometryDraft.script",
    }];
  }
  const assembly = exactRecord(
    draft.assembly,
    ["script", "scriptHash", "exportFormats", "files"],
    "$geometryDraft.assembly",
  );
  const scripts = [{
    text: nonEmptyScript(assembly.script, "$geometryDraft.assembly.script"),
    hash: parseFingerprint(
      assembly.scriptHash,
      "$geometryDraft.assembly.scriptHash",
    ),
    path: "$geometryDraft.assembly.script",
  }];
  if (!Array.isArray(draft.partDefinitions)) return scripts;
  for (const [index, raw] of draft.partDefinitions.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError(
        `$geometryDraft.partDefinitions[${index}] must be an object.`,
      );
    }
    const definition = raw as Record<string, unknown>;
    scripts.push({
      text: nonEmptyScript(
        definition.script,
        `$geometryDraft.partDefinitions[${index}].script`,
      ),
      hash: parseFingerprint(
        definition.scriptHash,
        `$geometryDraft.partDefinitions[${index}].scriptHash`,
      ),
      path: `$geometryDraft.partDefinitions[${index}].script`,
    });
  }
  return scripts;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const record = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(record.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof record.digest === "string" ? record.digest : "";
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}

function nonEmptyScript(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be non-empty CAD source.`);
  }
  return value;
}
