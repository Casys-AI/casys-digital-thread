/**
 * Tests for syson-model-seed-proposal.ts — fail-closed parser, digest.
 *
 * Convention: test names describe the invariant, not the method.
 */
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  encodeSysonModelSeedProposalParameters,
  fingerprintSysonModelSeedProposal,
  parseSysonModelSeedProposalParameters,
  SYSON_MODEL_SEED_ADMISSION_SCHEMA,
  SYSON_MODEL_SEED_CANONICAL_MODEL_NAME,
  SYSON_MODEL_SEED_CANONICAL_PROPOSAL,
  SYSON_MODEL_SEED_OPERATION_KEY,
  SysonModelSeedProposalParseError,
} from "./syson-model-seed-proposal.ts";
import { SYSON_MODEL_SEED_SCOPE } from "./syson-model-seed.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";

function param(
  key: string,
  value: string | number | boolean,
  unit?: string,
): EngineeringDecisionProposalParameter {
  return { key, label: key, value, unit };
}

function canonicalParams(): EngineeringDecisionProposalParameter[] {
  return [...encodeSysonModelSeedProposalParameters()];
}

Deno.test("the seed proposal grammar accepts the closed canonical envelope", () => {
  const proposal = parseSysonModelSeedProposalParameters(canonicalParams());
  assertEquals(proposal, SYSON_MODEL_SEED_CANONICAL_PROPOSAL);
  assertEquals(proposal.schemaVersion, SYSON_MODEL_SEED_ADMISSION_SCHEMA);
  assertEquals(proposal.scope, SYSON_MODEL_SEED_SCOPE);
  assertEquals(proposal.operation, SYSON_MODEL_SEED_OPERATION_KEY);
  assertEquals(proposal.modelName, SYSON_MODEL_SEED_CANONICAL_MODEL_NAME);
});

Deno.test("the seed proposal grammar rejects a free-form parameter key", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters([
        ...canonicalParams(),
        param("model.displayName", "DeskLamp"),
      ]),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "unknown_key");
  assertStringIncludes(error.message, "model.displayName");
});

Deno.test("the seed proposal grammar pins the model name to the canonical form", () => {
  const freeForm = canonicalParams().map((parameter) =>
    parameter.key === "model.name" ? param("model.name", "desk-lamp-dl05") : parameter
  );
  const error = assertThrows(
    () => parseSysonModelSeedProposalParameters(freeForm),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "invalid_model_name");
  assertStringIncludes(error.message, SYSON_MODEL_SEED_CANONICAL_MODEL_NAME);
  assertStringIncludes(error.message, "desk-lamp-dl05");
});

Deno.test("the seed proposal grammar rejects an empty parameter list", () => {
  const error = assertThrows(
    () => parseSysonModelSeedProposalParameters([]),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "empty_proposal");
});

Deno.test("the seed proposal grammar rejects a missing model name", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters(
        canonicalParams().filter((parameter) => parameter.key !== "model.name"),
      ),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "missing_model_name");
});

Deno.test("the seed proposal grammar rejects a duplicate key", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters([
        ...canonicalParams(),
        param("model.name", SYSON_MODEL_SEED_CANONICAL_MODEL_NAME),
      ]),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "duplicate_key");
});

Deno.test("the seed proposal grammar rejects a non-string value", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters(
        canonicalParams().map((parameter) =>
          parameter.key === "model.name" ? param("model.name", 1) : parameter
        ),
      ),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "non_string_value");
});

Deno.test("the seed proposal grammar rejects a unit on a seed parameter", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters(
        canonicalParams().map((parameter) =>
          parameter.key === "model.name"
            ? param("model.name", SYSON_MODEL_SEED_CANONICAL_MODEL_NAME, "mm")
            : parameter
        ),
      ),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "unexpected_unit");
});

Deno.test("the seed proposal grammar rejects a divergent schema version", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters(
        canonicalParams().map((parameter) =>
          parameter.key === "seed.schemaVersion"
            ? param("seed.schemaVersion", "syson-model-seed-admission/0.0")
            : parameter
        ),
      ),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "invalid_schema");
});

Deno.test("the seed proposal grammar rejects a divergent scope", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters(
        canonicalParams().map((parameter) =>
          parameter.key === "seed.scope"
            ? param("seed.scope", "architecture")
            : parameter
        ),
      ),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "invalid_scope");
});

Deno.test("the seed proposal grammar rejects a missing schema version", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters(
        canonicalParams().filter((parameter) => parameter.key !== "seed.schemaVersion"),
      ),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "missing_schema");
});

Deno.test("the seed proposal grammar rejects a divergent operation identity", () => {
  const error = assertThrows(
    () =>
      parseSysonModelSeedProposalParameters(
        canonicalParams().map((parameter) =>
          parameter.key === "seed.operation"
            ? param("seed.operation", "architecture.seed-syson-model@1")
            : parameter
        ),
      ),
    SysonModelSeedProposalParseError,
  ) as SysonModelSeedProposalParseError;
  assertEquals(error.code, "invalid_operation");
});

Deno.test("the seed proposal digest is deterministic for the canonical envelope", async () => {
  const first = await fingerprintSysonModelSeedProposal(
    SYSON_MODEL_SEED_CANONICAL_PROPOSAL,
  );
  const second = await fingerprintSysonModelSeedProposal(
    parseSysonModelSeedProposalParameters(canonicalParams()),
  );
  assertEquals(first.algorithm, "sha256");
  assertEquals(first.digest.length, 64);
  assertEquals(first, second);
});
