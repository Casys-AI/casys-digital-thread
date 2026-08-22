/**
 * Closed agent-authored mechanical proof-case source.
 *
 * This document carries only engineering intent for the current linear-static
 * tetrahedral isotropic capability. Server-owned Thread, CAD, solver, provider,
 * authorization, and STEP identities are compiled later and must not appear here.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  MECHANICAL_PROOF_CASE_SCHEMA,
  type MechanicalCadArtifactIdentity,
  type MechanicalCadSource,
  type MechanicalProofCase,
  parseMechanicalProofAnalysis,
  parseMechanicalProofRequirements,
  validateMechanicalProofCase,
} from "./mechanical-proof-case.ts";

export const MECHANICAL_PROOF_CASE_SOURCE_SCHEMA =
  "mechanical-proof-case-source/1.0" as const;

export const MECHANICAL_PROOF_CASE_SOURCE_MAX_CHARS = 262_144;

/** Fixed current CalculiX proof capability. Not agent-selected. */
export const MECHANICAL_PROOF_CALCULIX_CONTRACT = {
  provider: "calculix",
  tool: "calculix_solve_static",
  resultSchemaVersion: "2.0",
} as const;

/** Fixed current parametric CAD generator identity. Not agent-selected. */
export const MECHANICAL_PROOF_PARAMETRIC_CAD_GENERATOR = {
  provider: "build123d",
  tool: "build123d_export",
  mediaType: "text/x-python",
} as const;

/** Fixed linear-static part-proof CAD engineering boundary. Not project prose. */
export const MECHANICAL_PROOF_LINEAR_STATIC_CAD_BOUNDARY = {
  designIntent: "partial",
  editableCad: "absent",
  manufacturability: "not-established",
  limitations: [
    "The proof geometry is the unique canonical PartDefinition STEP on the current Thread tip, not an assembly claim.",
    "Supports and loads are closed AABB selections declared in the captured source.",
    "The declaration carries no tolerances, interfaces, manufacturing features or process evidence.",
  ],
} as const;

export interface MechanicalProofCaseSource {
  readonly schemaVersion: typeof MECHANICAL_PROOF_CASE_SOURCE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
  };
  readonly target: {
    readonly id: string;
    readonly modelElementId: string;
  };
  readonly requirementsSource: {
    readonly editingContextId: string;
    readonly elementId: string;
  };
  readonly analysis: MechanicalProofCase["analysis"];
  readonly requirements: MechanicalProofCase["requirements"];
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "target",
  "requirementsSource",
  "analysis",
  "requirements",
] as const;

const FORBIDDEN_ROOT_KEYS = [
  "authorization",
  "solver",
  "cadSource",
  "expectedCadArtifact",
  "fingerprint",
  "provider",
  "tool",
  "args",
  "runtime",
  "image",
  "profile",
  "timeout",
  "elementOrder",
  "baseThreadSnapshot",
] as const;

/**
 * Derive server-owned append identities from already-validated id/revision.
 * Does not re-enter source validation.
 */
function deriveMechanicalProofSealIdentities(
  id: string,
  revision: number,
  path = "$source",
): {
  readonly workItemId: string;
  readonly decisionId: string;
} {
  return {
    workItemId: safeId(
      `wi-proof-seal-${id}-r${revision}`,
      `${path}.authorization.workItemId`,
    ),
    decisionId: safeId(
      `dec-proof-seal-${id}-r${revision}`,
      `${path}.authorization.decisionId`,
    ),
  };
}

/** Validate untrusted JSON and return an immutable canonical source document. */
export function validateMechanicalProofCaseSource(
  value: unknown,
  path = "$source",
): MechanicalProofCaseSource {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of FORBIDDEN_ROOT_KEYS) {
      if (Object.hasOwn(value, key)) {
        throw new TypeError(`${path} has unsupported field ${key}.`);
      }
    }
  }
  const root = exactRecord(value, ROOT_KEYS, path);
  literalValue(
    root.schemaVersion,
    MECHANICAL_PROOF_CASE_SOURCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const projectInput = exactRecord(
    root.project,
    ["id", "subjectId"],
    `${path}.project`,
  );
  const targetInput = exactRecord(
    root.target,
    ["id", "modelElementId"],
    `${path}.target`,
  );
  const requirementsSourceInput = exactRecord(
    root.requirementsSource,
    ["editingContextId", "elementId"],
    `${path}.requirementsSource`,
  );
  const analysis = parseMechanicalProofAnalysis(
    root.analysis,
    `${path}.analysis`,
  );
  const requirements = parseMechanicalProofRequirements(
    root.requirements,
    `${path}.requirements`,
  );
  const id = safeId(root.id, `${path}.id`);
  const revision = positiveInteger(root.revision, `${path}.revision`);
  deriveMechanicalProofSealIdentities(id, revision, path);
  return deepFreeze({
    schemaVersion: MECHANICAL_PROOF_CASE_SOURCE_SCHEMA,
    id,
    revision,
    scope: nonEmptyText(root.scope, `${path}.scope`),
    evidenceBoundary: nonEmptyText(
      root.evidenceBoundary,
      `${path}.evidenceBoundary`,
    ),
    project: {
      id: safeId(projectInput.id, `${path}.project.id`),
      subjectId: safeId(projectInput.subjectId, `${path}.project.subjectId`),
    },
    target: {
      id: safeId(targetInput.id, `${path}.target.id`),
      modelElementId: safeId(
        targetInput.modelElementId,
        `${path}.target.modelElementId`,
      ),
    },
    requirementsSource: {
      editingContextId: safeId(
        requirementsSourceInput.editingContextId,
        `${path}.requirementsSource.editingContextId`,
      ),
      elementId: safeId(
        requirementsSourceInput.elementId,
        `${path}.requirementsSource.elementId`,
      ),
    },
    analysis,
    requirements,
  });
}

/** Canonical JSON text of an already-validated source document. */
export function canonicalMechanicalProofCaseSourceText(
  source: MechanicalProofCaseSource,
): string {
  return deterministicJson(validateMechanicalProofCaseSource(source));
}

/** Parse, validate, canonicalize, and prove replay of one source document. */
export function canonicalizeMechanicalProofCaseSource(
  value: unknown,
  path = "$source",
): {
  readonly source: MechanicalProofCaseSource;
  readonly text: string;
} {
  const source = validateMechanicalProofCaseSource(value, path);
  const text = deterministicJson(source);
  const roundtrip = validateMechanicalProofCaseSource(JSON.parse(text), path);
  const replay = deterministicJson(roundtrip);
  if (replay !== text) {
    throw new TypeError(`${path} is not canonical after exact replay.`);
  }
  return { source: roundtrip, text };
}

export async function fingerprintMechanicalProofCaseSource(
  source: MechanicalProofCaseSource,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateMechanicalProofCaseSource(source));
}

/** Server-owned append identities compiled from source identity and revision. */
export function mechanicalProofSealIdentities(
  source: MechanicalProofCaseSource,
): {
  readonly workItemId: string;
  readonly decisionId: string;
} {
  return deriveMechanicalProofSealIdentities(source.id, source.revision);
}

/** Compile the internal sealed declaration from recrossed server facts. */
export function compileMechanicalProofCase(input: {
  readonly source: MechanicalProofCaseSource;
  readonly baseThreadSnapshot: MechanicalProofCase["project"]["baseThreadSnapshot"];
  readonly cadSource: MechanicalCadSource;
  readonly expectedCadArtifact: MechanicalCadArtifactIdentity;
}): MechanicalProofCase {
  const source = validateMechanicalProofCaseSource(input.source);
  if (input.baseThreadSnapshot.subjectId !== source.project.subjectId) {
    throw new TypeError(
      "$source.project.subjectId must equal the recrossed Thread subject.",
    );
  }
  const identities = mechanicalProofSealIdentities(source);
  return validateMechanicalProofCase({
    schemaVersion: MECHANICAL_PROOF_CASE_SCHEMA,
    id: source.id,
    revision: source.revision,
    scope: source.scope,
    evidenceBoundary: source.evidenceBoundary,
    project: {
      id: source.project.id,
      subjectId: source.project.subjectId,
      baseThreadSnapshot: input.baseThreadSnapshot,
    },
    target: source.target,
    authorization: identities,
    requirementsSource: {
      provider: "syson",
      editingContextId: source.requirementsSource.editingContextId,
      elementId: source.requirementsSource.elementId,
    },
    solver: MECHANICAL_PROOF_CALCULIX_CONTRACT,
    cadSource: input.cadSource,
    expectedCadArtifact: input.expectedCadArtifact,
    analysis: source.analysis,
    requirements: source.requirements,
  });
}

export function parametricCadSourceFromPartScript(input: {
  readonly sha256: string;
  readonly bytes: number;
}): MechanicalCadSource {
  return {
    kind: "parametric",
    generator: {
      provider: MECHANICAL_PROOF_PARAMETRIC_CAD_GENERATOR.provider,
      tool: MECHANICAL_PROOF_PARAMETRIC_CAD_GENERATOR.tool,
      definition: {
        mediaType: MECHANICAL_PROOF_PARAMETRIC_CAD_GENERATOR.mediaType,
        sha256: input.sha256,
        bytes: input.bytes,
      },
    },
    engineeringBoundary: MECHANICAL_PROOF_LINEAR_STATIC_CAD_BOUNDARY,
  };
}
