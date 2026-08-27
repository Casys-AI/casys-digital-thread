/**
 * Domain module for the generic `architecture.seed-syson-model@2` MRTR grammar.
 *
 * Pure: no I/O, no Deno.*, no fetch. All logic is project-agnostic — the
 * word "coffee", "drone" or any product name is a defect in this module.
 *
 * WHY A CLOSED PARAMETER GRAMMAR — the seed executor never reads the
 * proposal. It derives the SysON project name as
 * `${project.project.name} · system model seed · ${run.id}` and the SysON
 * document name as `${project.project.name} system model`. A free-form
 * `model.name` would therefore be prose the human signs and the server
 * ignores. The grammar pins every key to a server-owned literal so the
 * signed envelope attests the container role, not an agent-invented name.
 *
 * LIMIT — `assertProposalMatchesOperationGrammar` is project-agnostic. It
 * cannot compare `model.name` to `projectId` or `project.project.name`.
 * The executor name is also not `projectId`. The signed value is therefore
 * the server-owned document role token, the tightest pin the existing
 * proposal-validation contract can enforce.
 *
 * WHY A FLAT PARAMETER GRAMMAR — same contract as write-architecture and
 * write-requirements: readable without tooling, safe to elicit, parsed
 * fail-closed into a typed envelope whose digest the human can recompute.
 */

import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  SYSON_MODEL_SEED_OPERATION,
  SYSON_MODEL_SEED_SCOPE,
} from "./syson-model-seed.ts";

// ── Operation identity ───────────────────────────────────────────────────────

export { SYSON_MODEL_SEED_OPERATION };

export const SYSON_MODEL_SEED_ADMISSION_SCHEMA =
  "syson-model-seed-admission/1.0" as const;

/**
 * Server-owned SysON document role signed by MRTR.
 *
 * The executor does not read this parameter. It still names the provider
 * document `${project.project.name} system model`.
 */
export const SYSON_MODEL_SEED_CANONICAL_MODEL_NAME = "system model" as const;

export const SYSON_MODEL_SEED_OPERATION_KEY =
  `${SYSON_MODEL_SEED_OPERATION.id}@${SYSON_MODEL_SEED_OPERATION.version}` as const;

// ── Proposal types ───────────────────────────────────────────────────────────

/** Parsed, hierarchy-typed representation of the human-reviewed MRTR proposal. */
export interface SysonModelSeedProposal {
  readonly schemaVersion: typeof SYSON_MODEL_SEED_ADMISSION_SCHEMA;
  readonly operation: typeof SYSON_MODEL_SEED_OPERATION_KEY;
  readonly scope: typeof SYSON_MODEL_SEED_SCOPE;
  readonly modelName: typeof SYSON_MODEL_SEED_CANONICAL_MODEL_NAME;
}

export const SYSON_MODEL_SEED_CANONICAL_PROPOSAL: SysonModelSeedProposal = Object
  .freeze({
    schemaVersion: SYSON_MODEL_SEED_ADMISSION_SCHEMA,
    operation: SYSON_MODEL_SEED_OPERATION_KEY,
    scope: SYSON_MODEL_SEED_SCOPE,
    modelName: SYSON_MODEL_SEED_CANONICAL_MODEL_NAME,
  });

// ── Error types ──────────────────────────────────────────────────────────────

export type SysonModelSeedProposalParseErrorCode =
  | "empty_proposal"
  | "unknown_key"
  | "missing_schema"
  | "missing_scope"
  | "missing_operation"
  | "missing_model_name"
  | "non_string_value"
  | "unexpected_unit"
  | "duplicate_key"
  | "invalid_schema"
  | "invalid_scope"
  | "invalid_operation"
  | "invalid_model_name";

/** Structured parse failure — code is stable, message is diagnostic only. */
export class SysonModelSeedProposalParseError extends Error {
  readonly code: SysonModelSeedProposalParseErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: SysonModelSeedProposalParseErrorCode,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "SysonModelSeedProposalParseError";
    this.code = code;
    this.context = context;
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const PARAMETER_KEYS = [
  "seed.schemaVersion",
  "seed.scope",
  "seed.operation",
  "model.name",
] as const;

const PARAMETER_LABELS: Record<(typeof PARAMETER_KEYS)[number], string> = {
  "seed.schemaVersion": "SysON seed admission schema",
  "seed.scope": "SysON seed scope",
  "seed.operation": "SysON seed operation",
  "model.name": "SysON model name",
};

const ALLOWED_KEYS = new Set<string>(PARAMETER_KEYS);

// ── Encoder ──────────────────────────────────────────────────────────────────

/**
 * Emit the unique canonical MRTR sequence. The seed admits one envelope;
 * there is nothing for the caller to choose.
 */
export function encodeSysonModelSeedProposalParameters(
  proposal: SysonModelSeedProposal = SYSON_MODEL_SEED_CANONICAL_PROPOSAL,
): readonly EngineeringDecisionProposalParameter[] {
  if (
    proposal.schemaVersion !== SYSON_MODEL_SEED_ADMISSION_SCHEMA ||
    proposal.operation !== SYSON_MODEL_SEED_OPERATION_KEY ||
    proposal.scope !== SYSON_MODEL_SEED_SCOPE ||
    proposal.modelName !== SYSON_MODEL_SEED_CANONICAL_MODEL_NAME
  ) {
    throw new TypeError(
      "The seed proposal is not the server-owned canonical envelope.",
    );
  }
  return Object.freeze(PARAMETER_KEYS.map((key) => ({
    key,
    label: PARAMETER_LABELS[key],
    value: parameterValue(proposal, key),
  })));
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a flat list of MRTR-reviewed decision parameters into the typed
 * seed proposal.
 *
 * Fail-closed: unknown key, non-string value, unit, duplicate, missing or
 * non-canonical value → SysonModelSeedProposalParseError with a named code.
 * This function does not validate MRTR authority or project lineage —
 * those remain the executor's gates.
 */
export function parseSysonModelSeedProposalParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): SysonModelSeedProposal {
  if (parameters.length === 0) {
    throw new SysonModelSeedProposalParseError(
      "empty_proposal",
      "The seed proposal has no parameters.",
    );
  }

  const values = new Map<string, string>();
  for (const param of parameters) {
    if (!ALLOWED_KEYS.has(param.key)) {
      throw new SysonModelSeedProposalParseError(
        "unknown_key",
        `Unknown seed parameter key "${param.key}". Allowed keys: ` +
          `${PARAMETER_KEYS.join(", ")}.`,
        { key: param.key },
      );
    }
    if (values.has(param.key)) {
      throw new SysonModelSeedProposalParseError(
        "duplicate_key",
        `Seed parameter "${param.key}" is duplicated.`,
        { key: param.key },
      );
    }
    if (param.unit !== undefined) {
      throw new SysonModelSeedProposalParseError(
        "unexpected_unit",
        `Seed parameter "${param.key}" cannot have a unit.`,
        { key: param.key, unit: param.unit },
      );
    }
    if (typeof param.value !== "string") {
      throw new SysonModelSeedProposalParseError(
        "non_string_value",
        `Seed parameter "${param.key}" must be a string.`,
        { key: param.key, valueType: typeof param.value },
      );
    }
    values.set(param.key, param.value);
  }

  const schemaVersion = requireKey(
    values,
    "seed.schemaVersion",
    "missing_schema",
    'Required parameter "seed.schemaVersion" is absent.',
  );
  if (schemaVersion !== SYSON_MODEL_SEED_ADMISSION_SCHEMA) {
    throw new SysonModelSeedProposalParseError(
      "invalid_schema",
      `seed.schemaVersion must be "${SYSON_MODEL_SEED_ADMISSION_SCHEMA}".`,
      { value: schemaVersion },
    );
  }

  const scope = requireKey(
    values,
    "seed.scope",
    "missing_scope",
    'Required parameter "seed.scope" is absent.',
  );
  if (scope !== SYSON_MODEL_SEED_SCOPE) {
    throw new SysonModelSeedProposalParseError(
      "invalid_scope",
      `seed.scope must be "${SYSON_MODEL_SEED_SCOPE}".`,
      { value: scope },
    );
  }

  const operation = requireKey(
    values,
    "seed.operation",
    "missing_operation",
    'Required parameter "seed.operation" is absent.',
  );
  if (operation !== SYSON_MODEL_SEED_OPERATION_KEY) {
    throw new SysonModelSeedProposalParseError(
      "invalid_operation",
      `seed.operation must be "${SYSON_MODEL_SEED_OPERATION_KEY}".`,
      { value: operation },
    );
  }

  const modelName = requireKey(
    values,
    "model.name",
    "missing_model_name",
    'Required parameter "model.name" is absent.',
  );
  if (modelName !== SYSON_MODEL_SEED_CANONICAL_MODEL_NAME) {
    throw new SysonModelSeedProposalParseError(
      "invalid_model_name",
      `model.name "${modelName}" must be the canonical form ` +
        `"${SYSON_MODEL_SEED_CANONICAL_MODEL_NAME}". ` +
        "The seed executor derives the provider document name from the project " +
        "and does not accept a free-form model name.",
      { value: modelName },
    );
  }

  return {
    schemaVersion: SYSON_MODEL_SEED_ADMISSION_SCHEMA,
    operation: SYSON_MODEL_SEED_OPERATION_KEY,
    scope: SYSON_MODEL_SEED_SCOPE,
    modelName: SYSON_MODEL_SEED_CANONICAL_MODEL_NAME,
  };
}

/**
 * Deterministic SHA-256 of the closed typed envelope (D1).
 *
 * Broader than signing a single key: any change to schema, operation, scope
 * or the pinned model-name role invalidates the digest the human can recompute.
 */
export function fingerprintSysonModelSeedProposal(
  proposal: SysonModelSeedProposal,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(parseSysonModelSeedProposalParameters(
    encodeSysonModelSeedProposalParameters(proposal),
  ));
}

function requireKey(
  values: ReadonlyMap<string, string>,
  key: (typeof PARAMETER_KEYS)[number],
  code: SysonModelSeedProposalParseErrorCode,
  message: string,
): string {
  const value = values.get(key);
  if (value === undefined || value.trim() === "") {
    throw new SysonModelSeedProposalParseError(code, message, { key });
  }
  return value;
}

function parameterValue(
  proposal: SysonModelSeedProposal,
  key: (typeof PARAMETER_KEYS)[number],
): string {
  switch (key) {
    case "seed.schemaVersion":
      return proposal.schemaVersion;
    case "seed.scope":
      return proposal.scope;
    case "seed.operation":
      return proposal.operation;
    case "model.name":
      return proposal.modelName;
  }
}
