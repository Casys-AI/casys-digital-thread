import { assert, assertEquals, assertRejects } from "@std/assert";
import { createCrossDomainImpactManifest } from "./cross-domain-impact-manifest.ts";
import { evaluateCrossDomainImpact } from "./cross-domain-impact-evaluation.ts";
import {
  evaluateMechanicalPreservation,
  validateMechanicalPreservation,
} from "./cross-domain-impact-mechanical-preservation.ts";
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
  validCrossDomainImpactManifestBody,
} from "../../testing/cross-domain-impact-fixtures.ts";
import {
  MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
  validMechanicalPreservationInput,
} from "../../testing/mechanical-preservation-fixtures.ts";

Deno.test("mechanical preservation carries FEA forward only with exact assertion, inputs and accept closeout", async () => {
  const result = await evaluateMechanicalPreservation(
    await validMechanicalPreservationInput(),
  );
  assertEquals(result.status, "carried-forward");
  assertEquals(await validateMechanicalPreservation(result), result);
});

Deno.test("absence of a mechanical causal edge is not an independence assertion", async () => {
  const evaluationInput = await validCrossDomainImpactEvaluationInput();
  const body = validCrossDomainImpactManifestBody();
  body.independenceAssertions = [];
  const manifest = await createCrossDomainImpactManifest(body);
  const evaluation = await evaluateCrossDomainImpact({
    ...evaluationInput,
    manifest,
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
  });
  const input = await validMechanicalPreservationInput();
  const result = await evaluateMechanicalPreservation({
    ...input,
    manifest,
    evaluation,
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
    reviewTrigger: evaluation.reviewTrigger,
    feaEvidence: null,
    closeout: null,
  });
  assertEquals(result.status, "impact-unresolved");
});

Deno.test("a replaced FEA input never carries mechanics forward", async () => {
  const input = await validMechanicalPreservationInput();
  const replaced = {
    ...input,
    feaEvidence: {
      ...input.feaEvidence!,
      consumptions: input.feaEvidence!.consumptions.map((consumption) => ({
        ...consumption,
        input: {
          id: consumption.input.id,
          fingerprint: impactFingerprint("f"),
        },
      })),
    },
  };
  const result = await evaluateMechanicalPreservation(replaced);
  assertEquals(result.status, "impact-unresolved");
});

Deno.test("a mismatched FEA consumption status never carries mechanics forward", async () => {
  const input = await validMechanicalPreservationInput();
  const result = await evaluateMechanicalPreservation({
    ...input,
    feaEvidence: {
      ...input.feaEvidence!,
      consumptions: input.feaEvidence!.consumptions.map((consumption) => ({
        ...consumption,
        status: "mismatch" as const,
      })),
    },
  });
  assertEquals(result.status, "impact-unresolved");
});

Deno.test("wrong-producer or thermal/electrical evidence is never a mechanical verdict", async () => {
  const input = await validMechanicalPreservationInput();
  for (
    const tool of [
      "simulate.run-admitted-modelica@1",
      "verify.evaluate-admitted-modelica-observations@1",
      "recorded-test@1",
    ]
  ) {
    const result = await evaluateMechanicalPreservation({
      ...input,
      feaEvidence: {
        ...input.feaEvidence!,
        execution: {
          ...input.feaEvidence!.execution,
          producer: {
            ...input.feaEvidence!.execution.producer,
            tool,
          },
        },
      },
    });
    assertEquals(result.status, "impact-unresolved");
  }
});

Deno.test("a stale FEA execution or missing accept closeout never carries mechanics forward", async () => {
  const input = await validMechanicalPreservationInput();
  const stale = await evaluateMechanicalPreservation({
    ...input,
    feaEvidence: {
      ...input.feaEvidence!,
      execution: { ...input.feaEvidence!.execution, freshness: "stale" },
    },
  });
  assertEquals(stale.status, "impact-unresolved");

  const missing = await evaluateMechanicalPreservation({
    ...input,
    closeout: null,
  });
  assertEquals(missing.status, "impact-unresolved");

  const rejected = await evaluateMechanicalPreservation({
    ...input,
    closeout: { ...input.closeout!, consequence: "reject" },
  });
  assertEquals(rejected.status, "impact-unresolved");

  const wrongCloseout = await evaluateMechanicalPreservation({
    ...input,
    closeout: {
      ...input.closeout!,
      producerTool: "decide.reject-evaluation-closeout@1",
    },
  });
  assertEquals(wrongCloseout.status, "impact-unresolved");
});

Deno.test("closeout input replacement or expiry of the independence assertion stays unresolved", async () => {
  const input = await validMechanicalPreservationInput();
  const replacedCloseout = await evaluateMechanicalPreservation({
    ...input,
    closeout: {
      ...input.closeout!,
      inputs: {
        ...input.closeout!.inputs,
        executionEvidence: {
          id: input.closeout!.inputs.executionEvidence.id,
          fingerprint: impactFingerprint("9"),
        },
      },
    },
  });
  assertEquals(replacedCloseout.status, "impact-unresolved");

  const expired = await evaluateMechanicalPreservation({
    ...input,
    evaluatedAt: "2026-09-21T09:00:00.000Z",
  });
  assertEquals(expired.status, "impact-unresolved");
});

Deno.test("a mismatched review trigger never carries mechanics forward", async () => {
  const input = await validMechanicalPreservationInput();
  const result = await evaluateMechanicalPreservation({
    ...input,
    reviewTrigger: { id: "other-review-trigger", fingerprint: impactFingerprint("d") },
  });
  assertEquals(result.status, "impact-unresolved");
});

Deno.test("mechanical preservation exposes only carried-forward or impact-unresolved", async () => {
  const result = await evaluateMechanicalPreservation(
    await validMechanicalPreservationInput(),
  );
  assert(
    result.status === "carried-forward" || result.status === "impact-unresolved",
  );
  const forged = structuredClone(result) as unknown as Record<string, unknown>;
  forged.status = "pass";
  await assertRejects(
    () => validateMechanicalPreservation(forged),
    TypeError,
    "impact-unresolved",
  );
  forged.status = "invalidated";
  await assertRejects(
    () => validateMechanicalPreservation(forged),
    TypeError,
    "impact-unresolved",
  );
});

Deno.test("invented closeout consumption ids never carry mechanics forward", async () => {
  const input = await validMechanicalPreservationInput();
  const result = await evaluateMechanicalPreservation({
    ...input,
    closeout: {
      ...input.closeout!,
      consumptions: input.closeout!.consumptions.map((item, index) => ({
        ...item,
        id: `closeout-consume-${index}`,
      })),
    },
  });
  assertEquals(result.status, "impact-unresolved");
});

Deno.test("legal preservation names the exact FEA @3 producer and accept closeout", async () => {
  const result = await evaluateMechanicalPreservation(
    await validMechanicalPreservationInput(),
  );
  assertEquals(
    result.feaEvidence?.execution.producer.tool,
    "verify.run-fea-static-proof@3",
  );
  assertEquals(
    result.closeout?.producerTool,
    MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
  );
  assertEquals(result.closeout?.consequence, "accept");
});
