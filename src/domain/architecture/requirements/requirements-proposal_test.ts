/**
 * Tests for requirements-proposal.ts — fail-closed parser, enrichment plan.
 *
 * Convention: test names describe the invariant, not the method.
 */
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  derivePartDefName,
  fingerprintRequirementsEnvelope,
  fingerprintRequirementsPlan,
  parseRequirementsProposalParameters,
  planRequirementsEnrichment,
  requirementEntriesToOracleRequirements,
  RequirementsProposalParseError,
} from "./requirements-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import type { OracleRequirement } from "../../kernel/proof-case.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function param(
  key: string,
  value: string | number | boolean,
  unit?: string,
): EngineeringDecisionProposalParameter {
  return { key, label: key, value, unit };
}

function minimalParams(
  override: Partial<{
    containerComponent: string;
    reqName: string;
    metric: string;
    operator: string;
    threshold: number;
    unit: string;
  }> = {},
): EngineeringDecisionProposalParameter[] {
  return [
    param("requirements.containerComponent", override.containerComponent ?? "DripTray"),
    param("requirement.r1.name", override.reqName ?? "Max displacement"),
    param("requirement.r1.metric", override.metric ?? "maxDisplacement"),
    param("requirement.r1.operator", override.operator ?? "<="),
    param("requirement.r1.threshold", override.threshold ?? 15, override.unit ?? "mm"),
  ];
}

// ── Parser — happy path ──────────────────────────────────────────────────────

Deno.test("parseRequirementsProposalParameters returns a valid proposal for minimal input", () => {
  const proposal = parseRequirementsProposalParameters(minimalParams());
  assertEquals(proposal.containerComponent, "DripTray");
  assertEquals(proposal.partDefName, "DripTrayRequirements");
  assertEquals(proposal.requirements.length, 1);
  const req = proposal.requirements[0]!;
  assertEquals(req.metric, "maxDisplacement");
  assertEquals(req.operator, "<=");
  assertEquals(req.threshold.value, 15);
  assertEquals(req.threshold.unit, "mm");
  assertEquals(req.name, "Max displacement");
});

Deno.test("parseRequirementsProposalParameters accepts two requirements with distinct metrics", () => {
  const params: EngineeringDecisionProposalParameter[] = [
    param("requirements.containerComponent", "DripTray"),
    param("requirement.r1.name", "Max displacement"),
    param("requirement.r1.metric", "maxDisplacement"),
    param("requirement.r1.operator", "<="),
    param("requirement.r1.threshold", 15, "mm"),
    param("requirement.r2.name", "Max von Mises stress"),
    param("requirement.r2.metric", "maxVonMises"),
    param("requirement.r2.operator", "<="),
    param("requirement.r2.threshold", 50000.0, "Pa"),
  ];
  const proposal = parseRequirementsProposalParameters(params);
  assertEquals(proposal.requirements.length, 2);
});

Deno.test("parseRequirementsProposalParameters sorts requirements by metric for determinism", () => {
  const params: EngineeringDecisionProposalParameter[] = [
    param("requirements.containerComponent", "DripTray"),
    param("requirement.r1.name", "Stress"),
    param("requirement.r1.metric", "vonMises"),
    param("requirement.r1.operator", "<="),
    param("requirement.r1.threshold", 50000, "Pa"),
    param("requirement.r2.name", "Displacement"),
    param("requirement.r2.metric", "displacement"),
    param("requirement.r2.operator", "<="),
    param("requirement.r2.threshold", 15, "mm"),
  ];
  const proposal = parseRequirementsProposalParameters(params);
  // "displacement" sorts before "vonMises"
  assertEquals(proposal.requirements[0]!.metric, "displacement");
  assertEquals(proposal.requirements[1]!.metric, "vonMises");
});

Deno.test("parseRequirementsProposalParameters accepts Pa as a supported unit", () => {
  const proposal = parseRequirementsProposalParameters(
    minimalParams({ metric: "maxStress", threshold: 50000, unit: "Pa" }),
  );
  assertEquals(proposal.requirements[0]!.threshold.unit, "Pa");
});

Deno.test("parseRequirementsProposalParameters accepts >= operator", () => {
  const proposal = parseRequirementsProposalParameters(
    minimalParams({ operator: ">=" }),
  );
  assertEquals(proposal.requirements[0]!.operator, ">=");
});

// ── Parser — error codes ─────────────────────────────────────────────────────

Deno.test("parseRequirementsProposalParameters rejects an empty parameter list with empty_proposal", () => {
  const error = assertThrows(
    () => parseRequirementsProposalParameters([]),
    RequirementsProposalParseError,
  );
  assertEquals((error as RequirementsProposalParseError).code, "empty_proposal");
});

Deno.test("parseRequirementsProposalParameters rejects a proposal without requirements with empty_proposal", () => {
  const error = assertThrows(
    () =>
      parseRequirementsProposalParameters([
        param("requirements.containerComponent", "DripTray"),
      ]),
    RequirementsProposalParseError,
  );
  assertEquals((error as RequirementsProposalParseError).code, "empty_proposal");
});

Deno.test("parseRequirementsProposalParameters rejects missing containerComponent with missing_container", () => {
  const error = assertThrows(
    () =>
      parseRequirementsProposalParameters([
        param("requirement.r1.name", "Disp"),
        param("requirement.r1.metric", "disp"),
        param("requirement.r1.operator", "<="),
        param("requirement.r1.threshold", 1.0, "mm"),
      ]),
    RequirementsProposalParseError,
  );
  assertEquals((error as RequirementsProposalParseError).code, "missing_container");
});

Deno.test(
  "parseRequirementsProposalParameters rejects a containerComponent with hyphens with invalid_identifier",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters(
          minimalParams({ containerComponent: "Drip-Tray" }),
        ),
      RequirementsProposalParseError,
    );
    assertEquals((error as RequirementsProposalParseError).code, "invalid_identifier");
  },
);

Deno.test(
  "parseRequirementsProposalParameters rejects an unknown top-level key with unknown_key",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters([
          ...minimalParams(),
          param("requirements.unknownField", "x"),
        ]),
      RequirementsProposalParseError,
    );
    assertEquals((error as RequirementsProposalParseError).code, "unknown_key");
  },
);

Deno.test(
  "parseRequirementsProposalParameters rejects an unknown requirement field with unknown_key",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters([
          ...minimalParams(),
          param("requirement.r1.extra", "x"),
        ]),
      RequirementsProposalParseError,
    );
    assertEquals((error as RequirementsProposalParseError).code, "unknown_key");
  },
);

Deno.test("parseRequirementsProposalParameters rejects an invalid operator with invalid_operator", () => {
  const error = assertThrows(
    () => parseRequirementsProposalParameters(minimalParams({ operator: "==" })),
    RequirementsProposalParseError,
  );
  assertEquals((error as RequirementsProposalParseError).code, "invalid_operator");
});

Deno.test("parseRequirementsProposalParameters rejects an unsupported unit with unsupported_unit", () => {
  // "lb" (pounds) is a non-SI unit that is deliberately not in UNIT_TO_SYSML_TYPE.
  const error = assertThrows(
    () => parseRequirementsProposalParameters(minimalParams({ unit: "lb" })),
    RequirementsProposalParseError,
  );
  assertEquals((error as RequirementsProposalParseError).code, "unsupported_unit");
});

Deno.test(
  "parseRequirementsProposalParameters rejects a threshold without a unit with missing_threshold_unit",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters([
          param("requirements.containerComponent", "DripTray"),
          param("requirement.r1.name", "Disp"),
          param("requirement.r1.metric", "disp"),
          param("requirement.r1.operator", "<="),
          param("requirement.r1.threshold", 1.0, ""), // empty unit
        ]),
      RequirementsProposalParseError,
    );
    assertEquals(
      (error as RequirementsProposalParseError).code,
      "missing_threshold_unit",
    );
  },
);

Deno.test(
  "parseRequirementsProposalParameters rejects a metric with a hyphen with invalid_metric_identifier",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters(
          minimalParams({ metric: "max-displacement" }),
        ),
      RequirementsProposalParseError,
    );
    assertEquals(
      (error as RequirementsProposalParseError).code,
      "invalid_metric_identifier",
    );
  },
);

Deno.test(
  "parseRequirementsProposalParameters rejects duplicate metrics with duplicate_metric",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters([
          param("requirements.containerComponent", "DripTray"),
          param("requirement.r1.name", "Disp"),
          param("requirement.r1.metric", "maxDisplacement"),
          param("requirement.r1.operator", "<="),
          param("requirement.r1.threshold", 15, "mm"),
          param("requirement.r2.name", "Also Disp"),
          param("requirement.r2.metric", "maxDisplacement"),
          param("requirement.r2.operator", "<="),
          param("requirement.r2.threshold", 20, "mm"),
        ]),
      RequirementsProposalParseError,
    );
    assertEquals((error as RequirementsProposalParseError).code, "duplicate_metric");
  },
);

Deno.test(
  "parseRequirementsProposalParameters rejects a non-numeric threshold with non_numeric_threshold",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters([
          param("requirements.containerComponent", "DripTray"),
          param("requirement.r1.name", "Disp"),
          param("requirement.r1.metric", "maxDisplacement"),
          param("requirement.r1.operator", "<="),
          param("requirement.r1.threshold", "1.5", "mm"), // string, not number
        ]),
      RequirementsProposalParseError,
    );
    assertEquals(
      (error as RequirementsProposalParseError).code,
      "non_numeric_threshold",
    );
  },
);

for (const decimal of [0.5, 1.5]) {
  Deno.test(
    `parseRequirementsProposalParameters rejects decimal threshold ${decimal} for the SysON 0.5.1 round-trip`,
    () => {
      try {
        parseRequirementsProposalParameters(minimalParams({ threshold: decimal }));
        throw new Error("Expected decimal threshold rejection.");
      } catch (error) {
        assertEquals(
          (error as RequirementsProposalParseError).code,
          "invalid_threshold_value",
        );
        assertStringIncludes((error as Error).message, "safe integer");
      }
    },
  );
}

Deno.test(
  "parseRequirementsProposalParameters rejects a missing name field with missing_requirement_field",
  () => {
    const error = assertThrows(
      () =>
        parseRequirementsProposalParameters([
          param("requirements.containerComponent", "DripTray"),
          // no name
          param("requirement.r1.metric", "maxDisplacement"),
          param("requirement.r1.operator", "<="),
          param("requirement.r1.threshold", 15, "mm"),
        ]),
      RequirementsProposalParseError,
    );
    assertEquals(
      (error as RequirementsProposalParseError).code,
      "missing_requirement_field",
    );
  },
);

// ── derivePartDefName ────────────────────────────────────────────────────────

Deno.test("derivePartDefName always appends Requirements suffix", () => {
  assertEquals(derivePartDefName("DripTray"), "DripTrayRequirements");
  assertEquals(derivePartDefName("Airframe"), "AirframeRequirements");
});

// ── requirementEntriesToOracleRequirements ───────────────────────────────────

Deno.test("requirementEntriesToOracleRequirements maps metric to both id and metric", () => {
  const proposal = parseRequirementsProposalParameters(minimalParams());
  const oracle = requirementEntriesToOracleRequirements(proposal.requirements);
  assertEquals(oracle.length, 1);
  assertEquals(oracle[0]!.id, "maxDisplacement");
  assertEquals(oracle[0]!.metric, "maxDisplacement");
  assertEquals(oracle[0]!.limit.value, 15);
  assertEquals(oracle[0]!.limit.unit, "mm");
});

// ── planRequirementsEnrichment ───────────────────────────────────────────────

Deno.test("planRequirementsEnrichment returns initial mode when no prior exists", () => {
  const proposal = parseRequirementsProposalParameters(minimalParams());
  const plan = planRequirementsEnrichment(proposal, undefined);
  assertEquals(plan.mode, "initial");
  assertEquals(plan.toInsert.length, 1);
  assertEquals(plan.adopted.length, 0);
  assertEquals(plan.conflicts.length, 0);
  assertEquals(plan.disappeared.length, 0);
});

Deno.test("planRequirementsEnrichment returns initial mode for an empty prior", () => {
  const proposal = parseRequirementsProposalParameters(minimalParams());
  const plan = planRequirementsEnrichment(proposal, []);
  assertEquals(plan.mode, "initial");
  assertEquals(plan.toInsert.length, 1);
});

Deno.test("planRequirementsEnrichment adopts an identical requirement from the prior", () => {
  const proposal = parseRequirementsProposalParameters(minimalParams());
  const prior: OracleRequirement[] = [
    {
      id: "maxDisplacement",
      name: "Max displacement",
      metric: "maxDisplacement",
      operator: "<=",
      limit: { value: 15, unit: "mm" },
    },
  ];
  const plan = planRequirementsEnrichment(proposal, prior);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.adopted.length, 1);
  assertEquals(plan.toInsert.length, 0);
  assertEquals(plan.conflicts.length, 0);
  assertEquals(plan.disappeared.length, 0);
});

Deno.test("planRequirementsEnrichment detects a threshold conflict when value differs", () => {
  const proposal = parseRequirementsProposalParameters(
    minimalParams({ threshold: 20 }),
  );
  const prior: OracleRequirement[] = [
    {
      id: "maxDisplacement",
      name: "Max displacement",
      metric: "maxDisplacement",
      operator: "<=",
      limit: { value: 15, unit: "mm" },
    },
  ];
  const plan = planRequirementsEnrichment(proposal, prior);
  assertEquals(plan.conflicts.length, 1);
  assertEquals(plan.conflicts[0]!.metric, "maxDisplacement");
  assertEquals(plan.conflicts[0]!.proposed.value, 20);
  assertEquals(plan.conflicts[0]!.prior.value, 15);
});

Deno.test("planRequirementsEnrichment detects a threshold conflict when unit differs", () => {
  const proposal = parseRequirementsProposalParameters(
    minimalParams({ metric: "stress", threshold: 50000, unit: "Pa" }),
  );
  const prior: OracleRequirement[] = [
    {
      id: "stress",
      name: "Stress",
      metric: "stress",
      operator: "<=",
      limit: { value: 50000, unit: "mm" }, // unit mismatch
    },
  ];
  const plan = planRequirementsEnrichment(proposal, prior);
  assertEquals(plan.conflicts.length, 1);
});

Deno.test("planRequirementsEnrichment detects disappeared metrics for the cliquet", () => {
  const proposal = parseRequirementsProposalParameters(minimalParams());
  const prior: OracleRequirement[] = [
    {
      id: "maxDisplacement",
      name: "Max displacement",
      metric: "maxDisplacement",
      operator: "<=",
      limit: { value: 15, unit: "mm" },
    },
    {
      id: "minThickness",
      name: "Min thickness",
      metric: "minThickness",
      operator: ">=",
      limit: { value: 30, unit: "mm" },
    },
  ];
  const plan = planRequirementsEnrichment(proposal, prior);
  assertEquals(plan.disappeared, ["minThickness"]);
});

Deno.test("planRequirementsEnrichment correctly classifies insert, adopt and conflict together", () => {
  const params: EngineeringDecisionProposalParameter[] = [
    param("requirements.containerComponent", "DripTray"),
    // r1: already in prior, same threshold → adopt
    param("requirement.r1.name", "Max displacement"),
    param("requirement.r1.metric", "maxDisplacement"),
    param("requirement.r1.operator", "<="),
    param("requirement.r1.threshold", 15, "mm"),
    // r2: in prior but different value → conflict
    param("requirement.r2.name", "Min wall"),
    param("requirement.r2.metric", "minWall"),
    param("requirement.r2.operator", ">="),
    param("requirement.r2.threshold", 30, "mm"),
    // r3: new → insert
    param("requirement.r3.name", "Max stress"),
    param("requirement.r3.metric", "maxStress"),
    param("requirement.r3.operator", "<="),
    param("requirement.r3.threshold", 50000, "Pa"),
  ];
  const proposal = parseRequirementsProposalParameters(params);
  const prior: OracleRequirement[] = [
    {
      id: "maxDisplacement",
      name: "Max displacement",
      metric: "maxDisplacement",
      operator: "<=",
      limit: { value: 15, unit: "mm" },
    },
    {
      id: "minWall",
      name: "Min wall",
      metric: "minWall",
      operator: ">=",
      limit: { value: 5.0, unit: "mm" }, // different value → conflict
    },
  ];
  const plan = planRequirementsEnrichment(proposal, prior);
  assertEquals(plan.toInsert.map((e) => e.metric), ["maxStress"]);
  assertEquals(plan.adopted.map((e) => e.metric), ["maxDisplacement"]);
  assertEquals(plan.conflicts.map((c) => c.metric), ["minWall"]);
  assertEquals(plan.disappeared, []);
});

// ── fingerprintRequirementsEnvelope ──────────────────────────────────────────

Deno.test(
  "fingerprintRequirementsEnvelope produces a deterministic SHA-256 fingerprint",
  async () => {
    const envelope = {
      target: {
        kind: "part-definition" as const,
        label: "DripTray",
        elementId: "element-123",
      },
      architectureBasis: { snapshotId: "snap-abc", revision: 4, fingerprint: "abc123" },
      partDefName: "DripTrayRequirements",
      requirements: requirementEntriesToOracleRequirements(
        parseRequirementsProposalParameters(minimalParams()).requirements,
      ),
    };
    const fp1 = await fingerprintRequirementsEnvelope(envelope);
    const fp2 = await fingerprintRequirementsEnvelope(envelope);
    assertEquals(fp1.digest, fp2.digest);
    assertEquals(fp1.algorithm, "sha256");
  },
);

Deno.test(
  "fingerprintRequirementsEnvelope changes when the target elementId changes",
  async () => {
    const requirements = requirementEntriesToOracleRequirements(
      parseRequirementsProposalParameters(minimalParams()).requirements,
    );
    const base = {
      target: {
        kind: "part-definition" as const,
        label: "DripTray",
        elementId: "element-123",
      },
      architectureBasis: { snapshotId: "snap-abc", revision: 4, fingerprint: "abc123" },
      partDefName: "DripTrayRequirements",
      requirements,
    };
    const fp1 = await fingerprintRequirementsEnvelope(base);
    const fp2 = await fingerprintRequirementsEnvelope({
      ...base,
      target: { ...base.target, elementId: "element-456" },
    });
    assertEquals(fp1.digest !== fp2.digest, true);
  },
);

Deno.test(
  "fingerprintRequirementsPlan is stable when enrichment render order differs from the signed proposal",
  async () => {
    const target = {
      kind: "part-definition" as const,
      label: "CantileverArm",
      elementId: "part-def-1",
    };
    const displacement: OracleRequirement = {
      id: "maxDisplacement",
      name: "Maximum arm displacement",
      metric: "maxDisplacement",
      operator: "<=",
      limit: { value: 2, unit: "mm" },
    };
    const stress: OracleRequirement = {
      id: "maxVonMises",
      name: "Maximum von Mises stress",
      metric: "maxVonMises",
      operator: "<=",
      limit: { value: 60_000_000, unit: "Pa" },
    };
    const signedProposalOrder = [displacement, stress];
    const enrichmentRenderOrder = [stress, displacement];
    const signed = await fingerprintRequirementsPlan({
      partDefName: "CantileverArmRequirements",
      target,
      requirements: signedProposalOrder,
    });
    const rendered = await fingerprintRequirementsPlan({
      partDefName: "CantileverArmRequirements",
      target,
      requirements: enrichmentRenderOrder,
    });
    assertEquals(signed.digest, rendered.digest);
  },
);
