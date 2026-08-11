import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  canonicalResolvedOperationPlanText,
  fingerprintResolvedOperationPlan,
  RESOLVED_OPERATION_PLAN_SCHEMA,
  validateResolvedOperationPlan,
} from "./resolved-operation-plan.ts";

const fingerprint = (character: string) => ({
  algorithm: "sha256" as const,
  digest: character.repeat(64),
});

function validPlan(): Record<string, unknown> {
  return {
    schemaVersion: RESOLVED_OPERATION_PLAN_SCHEMA,
    planId: "plan.thermal-and-fea.1",
    operation: { id: "verify.system-response", version: "1.0" },
    basis: {
      kind: "thread-snapshot",
      snapshotId: "thread.coffee-machine",
      revision: 7,
      subjectId: "coffee-machine",
      fingerprint: fingerprint("a"),
    },
    sourceRefs: [
      { id: "source.step", role: "geometry", fingerprint: fingerprint("b") },
      { id: "source.modelica", role: "model", fingerprint: fingerprint("c") },
      { id: "source.python", role: "model", fingerprint: fingerprint("d") },
    ],
    analysisRefs: [{
      id: "analysis.modelica-incidence.1",
      sourceRefId: "source.modelica",
      sourceFingerprint: fingerprint("c"),
      fingerprint: fingerprint("e"),
    }],
    admissionRefs: [{
      assertionId: "assertion.load-case.1",
      assertionFingerprint: fingerprint("f"),
      admissionFingerprint: fingerprint("1"),
    }],
    policy: { profile: "engineering.strict.1", status: "passed", findings: [] },
    dispatches: [
      {
        ordinal: 1,
        provider: { id: "mcp-modelica", contractVersion: "2026.07" },
        lowering: { id: "lower.modelica-simulate", version: "1" },
        tool: "modelica-simulate",
        inputRefs: [
          { kind: "analysis", id: "analysis.modelica-incidence.1" },
          { kind: "source", id: "source.modelica" },
        ],
        semanticArguments: {
          kit: "CoffeeMachine.Thermal",
          parameters: { ambientK: 293.15, profile: ["nominal", true, null] },
        },
        expectedOutputs: [{ kind: "simulation-run", name: "thermal-run" }],
      },
      {
        ordinal: 2,
        provider: { id: "mcp-calculix", contractVersion: "2026.07" },
        lowering: { id: "lower.calculix-static", version: "1" },
        tool: "calculix-solve-static",
        inputRefs: [
          { kind: "source", id: "source.step" },
          { kind: "admission", assertionId: "assertion.load-case.1" },
          {
            kind: "dispatch-output",
            dispatchOrdinal: 1,
            outputName: "thermal-run",
          },
        ],
        semanticArguments: { loadCase: "drip-tray-nominal", meshSizeMm: 2.5 },
        expectedOutputs: [
          { kind: "solver-result", name: "static-result" },
          { kind: "evidence", name: "solver-evidence" },
        ],
      },
    ],
  };
}

Deno.test("ResolvedOperationPlan validates, canonicalizes sets, and preserves Modelica to CalculiX order", async () => {
  const plan = validateResolvedOperationPlan(validPlan());
  assertEquals(plan.dispatches.map((dispatch) => dispatch.provider.id), [
    "mcp-modelica",
    "mcp-calculix",
  ]);
  assertEquals(plan.sourceRefs.map((ref) => ref.id), [
    "source.modelica",
    "source.python",
    "source.step",
  ]);
  assertEquals(plan.dispatches[1].inputRefs.map((ref) => ref.kind), [
    "admission",
    "dispatch-output",
    "source",
  ]);
  assertEquals(Object.isFrozen(plan), true);
  assertEquals(Object.isFrozen(plan.dispatches[0].semanticArguments.parameters), true);

  const canonical = canonicalResolvedOperationPlanText(validPlan());
  assertEquals(canonical.includes("mcp-modelica"), true);
  assertEquals(
    await fingerprintResolvedOperationPlan(validPlan()),
    await fingerprintResolvedOperationPlan(JSON.parse(canonical)),
  );

  const permuted = validPlan();
  (permuted.sourceRefs as unknown[]).reverse();
  for (const dispatch of permuted.dispatches as Record<string, unknown>[]) {
    (dispatch.inputRefs as unknown[]).reverse();
    (dispatch.expectedOutputs as unknown[]).reverse();
  }
  assertEquals(
    await fingerprintResolvedOperationPlan(validPlan()),
    await fingerprintResolvedOperationPlan(permuted),
  );
});

Deno.test("ResolvedOperationPlan canonical text and fingerprint both reject unvalidated input", async () => {
  assertThrows(
    () => canonicalResolvedOperationPlanText({}),
    TypeError,
    "schemaVersion is required",
  );
  await assertRejects(
    () => fingerprintResolvedOperationPlan({}),
    TypeError,
    "schemaVersion is required",
  );
});

Deno.test("ResolvedOperationPlan accepts the exact approved brief basis and rejects mixed basis fields", () => {
  const approved = validPlan();
  approved.basis = {
    kind: "approved-brief",
    projectId: "project.cm01",
    projectSnapshotId: "project-snapshot.4",
    projectRevision: 4,
    briefId: "brief.cm01",
    briefSnapshotId: "brief-snapshot.3",
    briefRevision: 3,
    fingerprint: fingerprint("2"),
  };
  assertEquals(validateResolvedOperationPlan(approved).basis.kind, "approved-brief");

  const mixed = validPlan();
  (mixed.basis as Record<string, unknown>).id = "not-a-thread-basis";
  assertThrows(
    () => validateResolvedOperationPlan(mixed),
    TypeError,
    "unsupported field",
  );
});

Deno.test("ResolvedOperationPlan rejects unresolved lineage and non-contiguous causal dispatches", () => {
  const unknownAnalysisSource = validPlan();
  (unknownAnalysisSource.analysisRefs as Record<string, unknown>[])[0]
    .sourceFingerprint = fingerprint("9");
  assertThrows(
    () => validateResolvedOperationPlan(unknownAnalysisSource),
    TypeError,
    "must match the sourceRefs fingerprint",
  );

  const unknownAnalysisSourceId = validPlan();
  (unknownAnalysisSourceId.analysisRefs as Record<string, unknown>[])[0]
    .sourceRefId = "source.missing";
  assertThrows(
    () => validateResolvedOperationPlan(unknownAnalysisSourceId),
    TypeError,
    "must name an existing sourceRefs id",
  );

  const unknownOutput = validPlan();
  ((unknownOutput.dispatches as Record<string, unknown>[])[1].inputRefs as Record<
    string,
    unknown
  >[])[2]
    .outputName = "missing";
  assertThrows(
    () => validateResolvedOperationPlan(unknownOutput),
    TypeError,
    "outputName",
  );

  const forwardOutput = validPlan();
  ((forwardOutput.dispatches as Record<string, unknown>[])[0].inputRefs as Record<
    string,
    unknown
  >[])[0] = {
    kind: "dispatch-output",
    dispatchOrdinal: 2,
    outputName: "static-result",
  };
  assertThrows(
    () => validateResolvedOperationPlan(forwardOutput),
    TypeError,
    "earlier existing",
  );

  const skippedOrdinal = validPlan();
  (skippedOrdinal.dispatches as Record<string, unknown>[])[1].ordinal = 3;
  assertThrows(
    () => validateResolvedOperationPlan(skippedOrdinal),
    TypeError,
    "contiguous preserved",
  );
});

Deno.test("ResolvedOperationPlan binds an analysis to its named source, not any source with its hash", () => {
  const plan = validPlan();
  const sourceRefs = plan.sourceRefs as Record<string, unknown>[];
  sourceRefs.push({
    id: "source.modelica-copy",
    role: "model",
    fingerprint: fingerprint("c"),
  });
  const analysis = (plan.analysisRefs as Record<string, unknown>[])[0]!;
  analysis.sourceRefId = "source.python";

  assertThrows(
    () => validateResolvedOperationPlan(plan),
    TypeError,
    "must match the sourceRefs fingerprint for sourceRefId source.python",
  );
});

Deno.test("ResolvedOperationPlan rejects hostile JSON without executing a getter", () => {
  const getterPlan = validPlan();
  let getterCalled = false;
  Object.defineProperty(
    (getterPlan.dispatches as Record<string, unknown>[])[0].semanticArguments as Record<
      string,
      unknown
    >,
    "malicious",
    {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("must not execute");
      },
    },
  );
  assertThrows(
    () => validateResolvedOperationPlan(getterPlan),
    TypeError,
    "data field",
  );
  assertEquals(getterCalled, false);

  const arrayGetterPlan = validPlan();
  let arrayGetterCalled = false;
  const profile = (((arrayGetterPlan.dispatches as Record<string, unknown>[])[0]
    .semanticArguments as Record<string, unknown>).parameters as Record<
      string,
      unknown
    >).profile as unknown[];
  Object.defineProperty(profile, "0", {
    configurable: true,
    enumerable: true,
    get() {
      arrayGetterCalled = true;
      throw new Error("must not execute");
    },
  });
  assertThrows(
    () => validateResolvedOperationPlan(arrayGetterPlan),
    TypeError,
    "data field",
  );
  assertEquals(arrayGetterCalled, false);

  const hidden = validPlan();
  Object.defineProperty(
    (hidden.dispatches as Record<string, unknown>[])[0].semanticArguments as Record<
      string,
      unknown
    >,
    "hidden",
    { enumerable: false, value: "not-json" },
  );
  assertThrows(() => validateResolvedOperationPlan(hidden), TypeError, "data field");

  const semanticUrl = validPlan();
  ((semanticUrl.dispatches as Record<string, unknown>[])[0]
    .semanticArguments as Record<string, unknown>).url = "a legitimate semantic field";
  assertEquals(
    validateResolvedOperationPlan(semanticUrl).dispatches[0].semanticArguments.url,
    "a legitimate semantic field",
  );
});

Deno.test("ResolvedOperationPlan rejects malformed fingerprints, duplicate ids, and non-JSON values", () => {
  const badFingerprint = validPlan();
  (badFingerprint.basis as Record<string, unknown>).fingerprint = {
    algorithm: "sha256",
    digest: "A".repeat(64),
  };
  assertThrows(
    () => validateResolvedOperationPlan(badFingerprint),
    TypeError,
    "lowercase",
  );

  const duplicateSource = validPlan();
  (duplicateSource.sourceRefs as Record<string, unknown>[]).push({
    id: "source.modelica",
    role: "another-allowed-role",
    fingerprint: fingerprint("7"),
  });
  assertThrows(
    () => validateResolvedOperationPlan(duplicateSource),
    TypeError,
    "duplicates",
  );

  const nonFinite = validPlan();
  ((nonFinite.dispatches as Record<string, unknown>[])[0].semanticArguments as Record<
    string,
    unknown
  >)
    .temperature = Number.NaN;
  assertThrows(
    () => validateResolvedOperationPlan(nonFinite),
    TypeError,
    "finite JSON number",
  );

  const cyclic = validPlan();
  const argumentsRecord = (cyclic.dispatches as Record<string, unknown>[])[0]
    .semanticArguments as Record<string, unknown>;
  argumentsRecord.self = argumentsRecord;
  assertThrows(() => validateResolvedOperationPlan(cyclic), TypeError, "cycle");
});
