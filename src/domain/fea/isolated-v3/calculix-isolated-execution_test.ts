import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CALCULIX_ISOLATED_INPUT_BUNDLE_SCHEMA,
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  CALCULIX_ISOLATED_REQUEST_SCHEMA,
  CALCULIX_ISOLATED_RESULT_SCHEMA,
  createCalculixIsolatedInputBundle,
  parseCalculixIsolatedInputBundle,
  validateCalculixIsolatedOutput,
  validateCalculixIsolatedOutputBatch,
  validateCalculixIsolatedStaticResult,
} from "./calculix-isolated-execution.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../seal-case/mechanical-proof-case.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";

const STEP = new TextEncoder().encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
);

Deno.test("isolated CalculiX bundle binds the reviewed proof and exact STEP bytes", async () => {
  const proof = await proofFor(STEP);
  const bundle = await createCalculixIsolatedInputBundle({
    requestId: "request:calculix-local-1",
    proof,
    stepBytes: STEP,
    elementOrder: 2,
    timeoutMs: 120_000,
  });
  const reopened = await parseCalculixIsolatedInputBundle(bundle.bytes.copy());

  assertEquals(reopened.manifest.schemaVersion, CALCULIX_ISOLATED_INPUT_BUNDLE_SCHEMA);
  assertEquals(reopened.manifest.proof, proof);
  assertEquals(reopened.manifest.step, {
    basename: "input.step",
    mediaType: "model/step",
    byteCount: STEP.byteLength,
    sha256: await fingerprintResourceBytes(STEP),
  });
  assertEquals(reopened.stepBytes.copy(), STEP);
  assertEquals(reopened.fingerprint, bundle.fingerprint);

  const copy = bundle.bytes.copy();
  copy[copy.byteLength - 1] ^= 1;
  await assertRejects(
    () => parseCalculixIsolatedInputBundle(copy),
    TypeError,
    "STEP failed exact validation",
  );
});

Deno.test("isolated CalculiX bundle refuses STEP bytes not named by the proof seal", async () => {
  const proof = await proofFor(STEP);
  const divergent = new TextEncoder().encode(
    "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n/* divergent */\nENDSEC;\nEND-ISO-10303-21;\n",
  );
  await assertRejects(
    () =>
      createCalculixIsolatedInputBundle({
        requestId: "request:calculix-local-2",
        proof,
        stepBytes: divergent,
        elementOrder: 1,
        timeoutMs: 10_000,
      }),
    TypeError,
    "must equal the reviewed proof-case artifact",
  );
  const invalidStep = new TextEncoder().encode("not a Part 21 exchange file");
  const invalidProof = await proofFor(invalidStep);
  await assertRejects(
    () =>
      createCalculixIsolatedInputBundle({
        requestId: "request:calculix-local-invalid-step",
        proof: invalidProof,
        stepBytes: invalidStep,
        elementOrder: 1,
        timeoutMs: 10_000,
      }),
    TypeError,
    "not one complete STEP Part 21",
  );
});

Deno.test("isolated CalculiX preflights the solver selection-name ceiling", async () => {
  const proof = await proofFor(STEP);
  const withName = (name: string) =>
    validateMechanicalProofCase({
      ...proof,
      analysis: {
        ...proof.analysis,
        supports: proof.analysis.supports.map((support) => ({
          ...support,
          selection: { ...support.selection, name },
        })),
      },
    });
  await createCalculixIsolatedInputBundle({
    requestId: "request:calculix-selection-61",
    proof: withName("A".repeat(61)),
    stepBytes: STEP,
    elementOrder: 1,
    timeoutMs: 10_000,
  });
  await assertRejects(
    () =>
      createCalculixIsolatedInputBundle({
        requestId: "request:calculix-selection-62",
        proof: withName("A".repeat(62)),
        stepBytes: STEP,
        elementOrder: 1,
        timeoutMs: 10_000,
      }),
    TypeError,
    "at most 61 characters",
  );
});

Deno.test("isolated CalculiX output validator closes nine roles and preserves physical units", async () => {
  const proof = await proofFor(STEP);
  const result = resultFor(proof);
  const validated = validateCalculixIsolatedStaticResult(result);
  assertEquals(validated.metrics.maximumDisplacement.unit, "mm");
  assertEquals(validated.metrics.maximumVonMises.unit, "MPa");
  assertEquals(validated.constraints.loads[0].forceN, [0, 0, -4.903325]);

  validateCalculixIsolatedOutput(output("input.step"), STEP);
  validateCalculixIsolatedOutput(
    output("request.json"),
    new TextEncoder().encode(deterministicJson({
      schemaVersion: CALCULIX_ISOLATED_REQUEST_SCHEMA,
      requestId: "request:calculix-local-1",
      proofFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      effective: { elementOrder: 2, timeoutMs: 120_000 },
      step: {
        basename: "input.step",
        mediaType: "model/step",
        byteCount: STEP.byteLength,
        sha256: await fingerprintResourceBytes(STEP),
      },
    })),
  );
  validateCalculixIsolatedOutput(
    output("result.json"),
    new TextEncoder().encode(deterministicJson(result)),
  );

  assertThrows(
    () =>
      validateCalculixIsolatedOutput(
        output("result.json"),
        new TextEncoder().encode(`${deterministicJson(result)}\n`),
      ),
    TypeError,
    "not canonical JSON",
  );
  assertThrows(
    () =>
      validateCalculixIsolatedStaticResult({
        ...result,
        metrics: {
          ...result.metrics,
          maximumDisplacement: {
            ...result.metrics.maximumDisplacement,
            value: 99,
          },
        },
      }),
    TypeError,
    "disagrees with vectorMm",
  );
  assertThrows(
    () =>
      validateCalculixIsolatedStaticResult({
        ...result,
        mesh: {
          ...result.mesh,
          nodesPerSelection: {
            ...result.mesh.nodesPerSelection,
            FIXED: result.mesh.nodes + 1,
          },
        },
      }),
    TypeError,
    "cannot exceed the mesh node count",
  );
});

Deno.test("isolated CalculiX static result accepts sparse Gmsh identifiers", async () => {
  const proof = await proofFor(STEP);
  const result = sparseResultFor(proof);
  const validated = validateCalculixIsolatedStaticResult(result);
  assertEquals(validated.metrics.maximumDisplacement.nodeId, 100);
  assertEquals(validated.metrics.maximumVonMises.elementId, 50);
  assertEquals(validated.mesh.nodes, 8);
  assertEquals(validated.mesh.elements, 4);
});

Deno.test("isolated CalculiX static result rejects non-positive and non-integer identifiers", async () => {
  const proof = await proofFor(STEP);
  const result = resultFor(proof);
  for (const nodeId of [0, -1, 1.5, Number.NaN]) {
    assertThrows(
      () =>
        validateCalculixIsolatedStaticResult({
          ...result,
          metrics: {
            ...result.metrics,
            maximumDisplacement: {
              ...result.metrics.maximumDisplacement,
              nodeId,
            },
          },
        }),
      TypeError,
      "must be a positive integer",
    );
  }
  for (const elementId of [0, -1, 2.5, Number.NaN]) {
    assertThrows(
      () =>
        validateCalculixIsolatedStaticResult({
          ...result,
          metrics: {
            ...result.metrics,
            maximumVonMises: {
              ...result.metrics.maximumVonMises,
              elementId,
            },
          },
        }),
      TypeError,
      "must be a positive integer",
    );
  }
});

Deno.test("isolated CalculiX batch binds sparse identifiers to the exact job.dat", async () => {
  const proof = await proofFor(STEP);
  const bundle = await createCalculixIsolatedInputBundle({
    requestId: "request:calculix-local-1",
    proof,
    stepBytes: STEP,
    elementOrder: 2,
    timeoutMs: 120_000,
  });
  const result = sparseResultFor(proof);
  const outputs = new Map<string, Uint8Array>([
    ["mesh.geo", textBytes("MESH_GEO")],
    ["mesh.inp", textBytes("*NODE\n")],
    ["job.inp", textBytes("JOB_INP")],
    ["job.dat", textBytes("DAT")],
  ]);
  validateCalculixIsolatedOutputBatch(
    bundle.manifest,
    outputs,
    result,
    sparseBatchInspector({ nodeId: 100, elementId: 50 }),
  );
  assertThrows(
    () =>
      validateCalculixIsolatedOutputBatch(
        bundle.manifest,
        outputs,
        result,
        sparseBatchInspector({ nodeId: 101, elementId: 50 }),
      ),
    TypeError,
    "metrics differ from the exact job.dat",
  );
});

async function proofFor(step: Uint8Array): Promise<MechanicalProofCase> {
  const base = validateMechanicalProofCase(JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json",
        import.meta.url,
      ),
    ),
  ));
  return validateMechanicalProofCase({
    ...base,
    expectedCadArtifact: {
      format: "step",
      sha256: await fingerprintResourceBytes(step),
      bytes: step.byteLength,
    },
  });
}

function sparseResultFor(proof: MechanicalProofCase) {
  const result = resultFor(proof);
  return {
    ...result,
    metrics: {
      maximumDisplacement: {
        ...result.metrics.maximumDisplacement,
        nodeId: 100,
      },
      maximumVonMises: {
        ...result.metrics.maximumVonMises,
        elementId: 50,
      },
    },
  };
}

function sparseBatchInspector(metrics: {
  readonly nodeId: number;
  readonly elementId: number;
}) {
  return {
    buildMeshScript: () => "MESH_GEO",
    inspectMesh: () => ({
      nodeCount: 8,
      elementCount: 4,
      maxNodeId: 100,
      nodesPerSet: { FIXED: 4, LOADED: 4 },
    }),
    buildDeck: () => "JOB_INP",
    parseResult: () => ({
      maxDisplacement: {
        magnitudeMm: 0.1,
        nodeId: metrics.nodeId,
        vectorMm: [0, 0, -0.1] as const,
      },
      maxVonMises: {
        mpa: 2,
        elementId: metrics.elementId,
      },
    }),
  };
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function resultFor(proof: MechanicalProofCase) {
  return {
    schemaVersion: CALCULIX_ISOLATED_RESULT_SCHEMA,
    requestId: "request:calculix-local-1",
    executionIdentity: {
      schemaVersion: "1.0",
      profile: { id: "calculix-static-proof-v1", version: "1.0.0" },
      wrapper: { id: "calculix-static-proof-v1", version: "1.0.0" },
      lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
      engines: {
        gmsh: { command: "gmsh", version: "4.12.1" },
        ccx: { command: "ccx", version: "CalculiX 2.21" },
      },
      image: { status: "bound-by-isolated-runner-receipt" },
    },
    inputArtifact: {
      mediaType: "model/step",
      byteCount: proof.expectedCadArtifact.bytes,
      sha256: proof.expectedCadArtifact.sha256,
    },
    mesh: {
      nodes: 8,
      elements: 4,
      nodesPerSelection: { FIXED: 4, LOADED: 4 },
    },
    constraints: {
      fixedSelections: ["FIXED"],
      loads: [{ selection: "LOADED", forceN: [0, 0, -4.903325] }],
    },
    metrics: {
      maximumDisplacement: {
        value: 0.1,
        unit: "mm",
        nodeId: 8,
        vectorMm: [0, 0, -0.1],
      },
      maximumVonMises: {
        value: 2,
        unit: "MPa",
        elementId: 4,
      },
    },
  };
}

function output(role: string) {
  const declaration = CALCULIX_ISOLATED_OUTPUT_MANIFEST.find((item) =>
    item.role === role
  );
  if (!declaration) throw new Error(`Missing output ${role}.`);
  return declaration;
}
