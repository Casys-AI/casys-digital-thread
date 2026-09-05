/**
 * Provenance that lets `design.write-geometry@1` seal only an admitted CAD draft.
 *
 * A sandbox preview can still persist a draft. Promotion requires this stamp,
 * whose source fingerprint must equal the captured script hash, plus at least
 * one module-level named numeric lever in every sealed script.
 */

import { listNamedNumericLevers } from "../../compile/source/named-cad-levers.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const GEOMETRY_DRAFT_ADMISSION_SCHEMA = "geometry-draft-admission/1.0" as const;
/**
 * Target-bound admission stamp for a PartDefinition-only canonical draft.
 *
 * V1 predates targeted exports and intentionally remains readable for the
 * existing system-only bundle path. V2 adds the exact PartDefinition identity
 * so a later sealer cannot mistake a valid admitted source for authority to
 * seal it as a different part.
 */
export const GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA =
  "geometry-draft-admission/2.0" as const;

export interface GeometryDraftAdmission {
  readonly schemaVersion: typeof GEOMETRY_DRAFT_ADMISSION_SCHEMA;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly sourceFingerprint: ContentFingerprint;
}

export interface GeometryPartDraftAdmission {
  readonly schemaVersion: typeof GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA;
  /** Exact `compile.seal-admission@3` artifact identity. */
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  /** SHA-256 of the exact sealed Build123d source bytes. */
  readonly sourceFingerprint: ContentFingerprint;
  /** Server-derived PartDefinition identity; labels are re-crossed later. */
  readonly target: {
    readonly partDefinitionElementId: string;
    readonly label: string;
  };
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

/** Strict parser for the target-bound v2 draft stamp. */
export function parseGeometryPartDraftAdmission(
  value: unknown,
  path = "$geometryPartDraft.admission",
): GeometryPartDraftAdmission {
  const record = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint", "sourceFingerprint", "target"],
    path,
  );
  literalValue(
    record.schemaVersion,
    GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
    `${path}.schemaVersion`,
  );
  const fingerprint = parseFingerprint(record.fingerprint, `${path}.fingerprint`);
  const artifactId = safeId(record.artifactId, `${path}.artifactId`);
  if (artifactId !== `technical-compilation-admission-${fingerprint.digest}`) {
    throw new TypeError(
      `${path}.artifactId must derive from the admission fingerprint.`,
    );
  }
  const target = exactRecord(
    record.target,
    ["partDefinitionElementId", "label"],
    `${path}.target`,
  );
  const partDefinitionElementId = nonEmptyText(
    target.partDefinitionElementId,
    `${path}.target.partDefinitionElementId`,
  );
  const label = nonEmptyLabel(target.label, `${path}.target.label`);
  return {
    schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
    artifactId,
    fingerprint,
    sourceFingerprint: parseFingerprint(
      record.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
    target: { partDefinitionElementId, label },
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

export function assertPartDraftJoinsAdmission(
  scriptHash: ContentFingerprint,
  admission: GeometryPartDraftAdmission,
): void {
  if (!fingerprintsEqual(scriptHash, admission.sourceFingerprint)) {
    throw new TypeError(
      "The target geometry draft script hash does not equal the stamped admission source.",
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
 * compile.seal-admission@3 artefact and every sealed script must be coté.
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

/**
 * Fail-closed promotion predicate for the deliberately separate targeted
 * PartDefinition draft family.  The surrounding sealer still re-proves the
 * complete draft/export record; this domain guard owns the admission/source
 * join so a valid source can never be promoted for another PartDefinition.
 */
export function requireCanonicalGeometryPartDraftAdmission(
  draft: unknown,
): GeometryPartDraftAdmission {
  if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
    throw new TypeError("Target geometry draft capture must be an object.");
  }
  const record = draft as Record<string, unknown>;
  if (record.schemaVersion !== "geometry-part-draft-capture/1.1") {
    throw new TypeError(
      "Target geometry draft capture must use geometry-part-draft-capture/1.1.",
    );
  }
  const target = exactRecord(
    record.target,
    ["partDefinitionElementId", "label", "script", "scriptHash", "files"],
    "$geometryPartDraft.target",
  );
  const partDefinitionElementId = nonEmptyText(
    target.partDefinitionElementId,
    "$geometryPartDraft.target.partDefinitionElementId",
  );
  const label = nonEmptyLabel(target.label, "$geometryPartDraft.target.label");
  const script = nonEmptyScript(target.script, "$geometryPartDraft.target.script");
  const scriptHash = parseFingerprint(
    target.scriptHash,
    "$geometryPartDraft.target.scriptHash",
  );
  const admission = parseGeometryPartDraftAdmission(
    record.admission,
    "$geometryPartDraft.admission",
  );
  if (
    admission.target.partDefinitionElementId !== partDefinitionElementId ||
    admission.target.label !== label
  ) {
    throw new TypeError(
      "Target geometry draft admission does not name the exact captured PartDefinition.",
    );
  }
  assertPartDraftJoinsAdmission(scriptHash, admission);
  requireNamedCadLeverInDraftScript(script, "$geometryPartDraft.target.script");
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

function nonEmptyLabel(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty label.`);
  }
  return value;
}
