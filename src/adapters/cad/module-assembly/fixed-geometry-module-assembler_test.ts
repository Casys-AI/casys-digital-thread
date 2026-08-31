import { assertEquals, assertRejects } from "@std/assert";
import { GeometryModuleAssemblyError } from "../../../application/ports/out/cad/module-assembly/geometry-module-assembler.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
} from "../../../domain/cad/module-assembly/geometry-module-assembly-receipt.ts";
import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "./fixed-geometry-module-assembly-execution.ts";
import { createGeometryModuleInputBundle } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  FIXED_GEOMETRY_MODULE_ASSEMBLER_IMPLEMENTATION,
  FixedGeometryModuleAssembler,
} from "./fixed-geometry-module-assembler.ts";

const encoder = new TextEncoder();
const CHILD_STEP = encoder.encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=CHILD;\nENDSEC;\nEND-ISO-10303-21;\n",
);
const ASSEMBLY_STEP = encoder.encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=ASSEMBLY;\nENDSEC;\nEND-ISO-10303-21;\n",
);
const ASSEMBLY_GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);

const LIMITS = {
  maxWallTimeMs: 1_000,
  maxCpuTimeMs: 500,
  maxMemoryBytes: 64_000_000,
  maxProcesses: 4,
  maxStdoutBytes: 1_024,
  maxStderrBytes: 1_024,
  maxOutputFileBytes: 1_024,
  maxOutputTotalBytes: 2_048,
} as const;

const RUNTIME = {
  isolationClass: "kernel-isolated",
  imageDigest: fp("a".repeat(64)),
  requestedLimits: LIMITS,
  limitAssurance: {
    maxWallTimeMs: "backend-attested",
    maxCpuTimeMs: "unattested",
    maxMemoryBytes: "backend-attested",
    maxProcesses: "unattested",
    maxStdoutBytes: "broker-observed-cap",
    maxStderrBytes: "broker-observed-cap",
    maxOutputFileBytes: "broker-observed-cap",
    maxOutputTotalBytes: "broker-observed-cap",
  },
} as const;

Deno.test("fixed module assembler normalizes native evidence behind the neutral port", async () => {
  const world = await createWorld();
  const result = await world.assembler.assemble({
    runId: "module-assembly-run",
    bundle: world.bundle,
  });
  assertEquals(world.runner.requests.length, 1);
  assertEquals(result.receipt.schemaVersion, GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA);
  assertEquals(
    result.receipt.capability,
    GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
  );
  assertEquals(
    result.receipt.implementation.id,
    FIXED_GEOMETRY_MODULE_ASSEMBLER_IMPLEMENTATION.id,
  );
  assertEquals(result.assemblyStep.copy(), ASSEMBLY_STEP);
  assertEquals(result.assemblyGlb.copy(), ASSEMBLY_GLB);
});

Deno.test("fixed module assembler reopens generation zero without redispatch", async () => {
  const world = await createWorld();
  const command = { runId: "module-replay-run", bundle: world.bundle };
  const first = await world.assembler.assemble(command);
  const second = await world.assembler.assemble(command);
  assertEquals(second.receipt, first.receipt);
  assertEquals(world.runner.requests.length, 1);
  assertEquals(world.publications.resolveCalls, 2);
  assertEquals(world.publications.readCalls, 1);
});

Deno.test("fixed module assembler refuses an unknown generation-zero outcome", async () => {
  const world = await createWorld();
  world.publications.outcomeUnknown = true;
  await assertRejects(
    () =>
      world.assembler.assemble({
        runId: "module-unknown-run",
        bundle: world.bundle,
      }),
    GeometryModuleAssemblyError,
    "redispatch is refused",
  );
  assertEquals(world.runner.requests.length, 0);
});

Deno.test("fixed module assembler invokes its adapter-only dispatch fence immediately before runner execution", async () => {
  const world = await createWorld();
  const calls: string[] = [];
  const assembler = new FixedGeometryModuleAssembler({
    profiles: world.profiles as never,
    runner: {
      run: async (request) => {
        calls.push("run");
        return await world.runner.run(request);
      },
    },
    publications: world.publications,
    beforeDispatch: (request) => {
      calls.push(`claim:${request.runId}`);
    },
  });
  await assembler.assemble({ runId: "module-dispatch-fence", bundle: world.bundle });
  assertEquals(calls, ["claim:module-dispatch-fence", "run"]);
});

async function createWorld() {
  const bundle = await createGeometryModuleInputBundle([{
    usageElementId: "usage.child",
    partDefinitionElementId: "definition.child",
    placement: {
      translationMm: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    },
    childCapture: {
      schemaVersion: "geometry-part-capture/1.0",
      artifactId: "geometry-part-child",
      fingerprint: fp("b".repeat(64)),
    },
    stepBytes: CHILD_STEP,
  }]);
  const publications = new FakePublications();
  const runner = new FakeRunner(publications);
  const profiles = {
    initial: () => Promise.resolve(profile()),
    resolve: () => Promise.resolve(profile()),
  };
  return {
    bundle,
    runner,
    publications,
    profiles,
    assembler: new FixedGeometryModuleAssembler({
      profiles: profiles as never,
      runner,
      publications,
    }),
  };
}

function profile() {
  return {
    executionProfile: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
    isolationPolicy: {
      id: "isolation.geometry-module-assembly-v1",
      version: "1.0.0",
      fingerprint: fp("c".repeat(64)),
    },
    outputManifest: GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
    runtime: RUNTIME,
    minimumDestructionAssurance: "proven",
  } as const;
}

class FakeRunner {
  readonly requests: IsolatedCodeExecutionRequest[] = [];

  constructor(readonly publications: FakePublications) {}

  async run(request: IsolatedCodeExecutionRequest) {
    this.requests.push(request);
    const validated = await validateIsolatedCodeExecutionRequest(request);
    const stepDigest = await fingerprintResourceBytes(ASSEMBLY_STEP);
    const glbDigest = await fingerprintResourceBytes(ASSEMBLY_GLB);
    const outputs = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.map((declaration) => {
      const bytes = declaration.role === "assembly.step" ? ASSEMBLY_STEP : ASSEMBLY_GLB;
      return {
        ...declaration,
        bytes,
        byteCount: bytes.byteLength,
        sha256: declaration.role === "assembly.step" ? stepDigest : glbDigest,
        casUri: `casys://isolated-output/sha256/${
          declaration.role === "assembly.step" ? stepDigest : glbDigest
        }`,
      };
    });
    const members = outputs.map(({ bytes: _bytes, ...member }) => member);
    const receipt = await createIsolatedCodeExecutionReceipt({
      request: validated,
      runtime: RUNTIME,
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs,
      destruction: {
        status: "proven",
        runId: request.runId,
        proofFingerprint: fp("d".repeat(64)),
      },
      publication: await createIsolatedOutputPublicationRef(
        request.runId,
        0,
        await fingerprintIsolatedOutputPublicationManifest(
          request.runId,
          0,
          members,
        ),
      ),
    });
    this.publications.receipt = receipt;
    return receipt;
  }
}

class FakePublications {
  receipt?: IsolatedCodeExecutionReceipt;
  outcomeUnknown = false;
  resolveCalls = 0;
  readCalls = 0;

  resolvePublicationByRunId(runId: string, producerGeneration: 0 | 1) {
    this.resolveCalls += 1;
    if (this.outcomeUnknown) {
      return Promise.resolve({
        status: "outcome-unknown" as const,
        runId,
        producerGeneration,
      });
    }
    if (
      this.receipt?.runId === runId &&
      this.receipt.producerGeneration === producerGeneration
    ) {
      return Promise.resolve({
        status: "published" as const,
        runId,
        producerGeneration,
        ref: this.receipt.publication.ref,
        receipt: isolatedCodeExecutionReceiptRecord(this.receipt),
      });
    }
    return Promise.resolve({
      status: "not-published" as const,
      runId,
      producerGeneration,
    });
  }

  readReceipt() {
    this.readCalls += 1;
    return Promise.resolve(this.receipt);
  }

  readPublishedObject() {
    return Promise.resolve(undefined);
  }
}

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}
