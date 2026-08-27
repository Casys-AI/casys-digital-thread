import { assertEquals, assertRejects } from "@std/assert";
import type { CalculixIsolatedExecutionAttemptIdentity } from "../../../ports/out/fea/isolated-v3/calculix-isolated-execution-attempt-store.ts";
import type { IsolatedCodeExecutionLimits } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  CALCULIX_ISOLATED_REQUEST_SCHEMA,
  CALCULIX_ISOLATED_RESULT_SCHEMA,
  createCalculixIsolatedInputBundle,
  validateCalculixIsolatedOutput,
} from "../../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import { validateMechanicalProofCase } from "../../../../domain/fea/seal-case/mechanical-proof-case.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  IsolatedCodeExecutionRejectedError,
  IsolatedCodeOutputValidationRejectedError,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedCodeExecutionRejectionDiagnostic,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "../../../../adapters/fea/isolated-v3/fixed-calculix-isolated-execution-profile.ts";
import { FileCalculixIsolatedExecutionAttemptStore } from "../../../../adapters/fea/isolated-v3/file-calculix-isolated-execution-attempt-store.ts";
import { FileCalculixIsolatedExecutionEvidenceStore } from "../../../../adapters/fea/isolated-v3/calculix-isolated-execution-evidence.ts";
import { FileEngineeringProjectRunLease } from "../../../../adapters/shared/stores/file-engineering-project-run-lease.ts";
import { CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR } from "../../../../adapters/fea/isolated-v3/calculix-isolated-output-batch-inspector.ts";
import {
  ExecuteIsolatedCalculixStaticProof,
  ExecuteIsolatedCalculixStaticProofError,
  IsolatedCalculixOutputValidationRejectedError,
  IsolatedCalculixRedispatchExhaustedError,
} from "./execute-isolated-calculix-static-proof.ts";

const AT = "2026-08-14T04:00:00.000Z";
const STEP = new TextEncoder().encode(
  "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
);

Deno.test("isolated CalculiX rejects an oversized bundle before copy, WAL or dispatch", async () => {
  const fixture = await executionFixture();
  let copied = false;
  let prepared = false;
  let runs = 0;
  const oversized = {
    ...fixture.bundle,
    bytes: {
      byteLength: fixture.identity.profile.maximumBundleBytes + 1,
      copy: () => {
        copied = true;
        throw new Error("must not copy");
      },
    },
  } as typeof fixture.bundle;
  const useCase = new ExecuteIsolatedCalculixStaticProof({
    runner: {
      run: () => {
        runs++;
        throw new Error("must not run");
      },
    },
    recovery: {
      destroyByRunId: () => Promise.reject(new Error("must not recover")),
      advanceProducerGeneration: () => Promise.reject(new Error("must not advance")),
    },
    publications: publications("not-published"),
    lease: immediateLease(),
    attempts: {
      read: () => Promise.resolve(undefined),
      prepare: () => {
        prepared = true;
        throw new Error("must not prepare");
      },
      markDispatching: () => Promise.reject(new Error("unreachable")),
      authorizeRedispatch: () => Promise.reject(new Error("unreachable")),
      consumeRedispatch: () => Promise.reject(new Error("unreachable")),
      markOutputPublished: () => Promise.reject(new Error("unreachable")),
      markEvidenceCaptured: () => Promise.reject(new Error("unreachable")),
      markExecutionRejected: () => Promise.reject(new Error("unreachable")),
      markOutputValidationRejected: () => Promise.reject(new Error("unreachable")),
      markRedispatchExhausted: () => Promise.reject(new Error("unreachable")),
    },
    evidence: unreachableEvidence(),
    inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
  });

  await assertRejects(
    () => useCase.execute({ ...fixture, bundle: oversized }),
    ExecuteIsolatedCalculixStaticProofError,
    "exceeds the code-owned profile ceiling",
  );
  assertEquals(copied, false);
  assertEquals(prepared, false);
  assertEquals(runs, 0);
});

Deno.test("isolated CalculiX rejects a proof from another project before WAL or dispatch", async () => {
  const fixture = await executionFixture();
  let prepared = false;
  let runs = 0;
  const useCase = new ExecuteIsolatedCalculixStaticProof({
    runner: {
      run: () => {
        runs++;
        throw new Error("must not run");
      },
    },
    recovery: {
      destroyByRunId: () => Promise.reject(new Error("must not recover")),
      advanceProducerGeneration: () => Promise.reject(new Error("must not advance")),
    },
    publications: publications("not-published"),
    lease: immediateLease(),
    attempts: {
      read: () => Promise.resolve(undefined),
      prepare: () => {
        prepared = true;
        throw new Error("must not prepare");
      },
      markDispatching: () => Promise.reject(new Error("unreachable")),
      authorizeRedispatch: () => Promise.reject(new Error("unreachable")),
      consumeRedispatch: () => Promise.reject(new Error("unreachable")),
      markOutputPublished: () => Promise.reject(new Error("unreachable")),
      markEvidenceCaptured: () => Promise.reject(new Error("unreachable")),
      markExecutionRejected: () => Promise.reject(new Error("unreachable")),
      markOutputValidationRejected: () => Promise.reject(new Error("unreachable")),
      markRedispatchExhausted: () => Promise.reject(new Error("unreachable")),
    },
    evidence: unreachableEvidence(),
    inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
  });

  await assertRejects(
    () =>
      useCase.execute({
        ...fixture,
        identity: { ...fixture.identity, projectId: "another-project" },
      }),
    ExecuteIsolatedCalculixStaticProofError,
    "project differs from the exact proof bundle",
  );
  assertEquals(prepared, false);
  assertEquals(runs, 0);
});

Deno.test("isolated CalculiX recovery never redispatches an unknown publication", async () => {
  await withPreparedDispatch(async ({ attempts, identity, bundle }) => {
    let runs = 0;
    let recoveries = 0;
    const useCase = new ExecuteIsolatedCalculixStaticProof({
      runner: {
        run: () => {
          runs++;
          throw new Error("must not run");
        },
      },
      recovery: {
        destroyByRunId: () => {
          recoveries++;
          throw new Error("must not recover");
        },
        advanceProducerGeneration: () => {
          throw new Error("must not advance");
        },
      },
      publications: publications("outcome-unknown"),
      lease: immediateLease(),
      attempts,
      evidence: unreachableEvidence(),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });

    await assertRejects(
      () => useCase.execute({ identity, bundle }),
      ExecuteIsolatedCalculixStaticProofError,
      "outcome is unknown; no redispatch",
    );
    assertEquals(runs, 0);
    assertEquals(recoveries, 0);
  });
});

Deno.test("isolated CalculiX persists a known execution rejection and replays it without redispatch", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await executionFixture();
    const diagnostic = await createIsolatedCodeExecutionRejectionDiagnostic({
      termination: { kind: "exited", exitCode: 1, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: {
          bytes: new TextEncoder().encode(
            "MeshingError: Selection 'FIXED' matched no surface\n",
          ),
          truncated: false,
        },
      },
      maximumLogBytes: { stdout: 1_024, stderr: 1_024 },
    });
    const destruction = {
      status: "proven" as const,
      runId: fixture.identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    };
    let runs = 0;
    const attempts = new FileCalculixIsolatedExecutionAttemptStore(
      `${root}/attempts`,
    );
    const useCase = new ExecuteIsolatedCalculixStaticProof({
      runner: {
        run: () => {
          runs++;
          return Promise.reject(
            new IsolatedCodeExecutionRejectedError(diagnostic, destruction),
          );
        },
      },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("must not recover")),
        advanceProducerGeneration: () => Promise.reject(new Error("must not advance")),
      },
      publications: publications("not-published"),
      lease: immediateLease(),
      attempts,
      evidence: unreachableEvidence(),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });
    const first = await assertRejects(
      () => useCase.execute(fixture),
      IsolatedCodeExecutionRejectedError,
      "did not terminate successfully",
    );
    assertEquals(first.diagnostic.logs.stderr.excerpt.includes("empty"), false);
    assertEquals(
      first.diagnostic.logs.stderr.excerpt.includes("matched no surface"),
      true,
    );
    assertEquals(runs, 1);
    const persisted = await attempts.read(
      fixture.identity.projectId,
      fixture.identity.agentRunId,
    );
    assertEquals(persisted?.phase, "execution-rejected");
    const replay = await assertRejects(
      () => useCase.execute(fixture),
      IsolatedCodeExecutionRejectedError,
      "did not terminate successfully",
    );
    assertEquals(replay.diagnostic, first.diagnostic);
    assertEquals(runs, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("isolated CalculiX persists an output-validation rejection and replays it without redispatch", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await executionFixture();
    const observation = {
      role: "job.dat",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    const destruction = {
      status: "proven" as const,
      runId: fixture.identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    };
    let runs = 0;
    const attempts = new FileCalculixIsolatedExecutionAttemptStore(
      `${root}/attempts`,
    );
    const useCase = new ExecuteIsolatedCalculixStaticProof({
      runner: {
        run: () => {
          runs++;
          return Promise.reject(
            new IsolatedCodeOutputValidationRejectedError(observation, destruction),
          );
        },
      },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("must not recover")),
        advanceProducerGeneration: () => Promise.reject(new Error("must not advance")),
      },
      publications: publications("not-published"),
      lease: immediateLease(),
      attempts,
      evidence: unreachableEvidence(),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });
    const first = await assertRejects(
      () => useCase.execute(fixture),
      IsolatedCalculixOutputValidationRejectedError,
      "no redispatch occurs",
    );
    assertEquals(first instanceof IsolatedCodeExecutionRejectedError, false);
    assertEquals(first instanceof IsolatedCodeOutputValidationRejectedError, false);
    assertEquals(first.observation, observation);
    assertEquals(first.destruction, destruction);
    assertEquals("diagnostic" in first, false);
    assertEquals("bytes" in first, false);
    assertEquals(runs, 1);
    const persisted = await attempts.read(
      fixture.identity.projectId,
      fixture.identity.agentRunId,
    );
    assertEquals(persisted?.phase, "output-validation-rejected");
    const replay = await assertRejects(
      () => useCase.execute(fixture),
      IsolatedCalculixOutputValidationRejectedError,
      "no redispatch occurs",
    );
    assertEquals(replay.observation, first.observation);
    assertEquals(replay.destruction, first.destruction);
    assertEquals(runs, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("isolated CalculiX reconstructs a persisted output-validation rejection after a lost ACK and never redispatches", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await executionFixture();
    const observation = {
      role: "job.dat",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    const destruction = {
      status: "proven" as const,
      runId: fixture.identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    };
    let runs = 0;
    const attempts = new PersistThenLoseAckAttemptStore(`${root}/attempts`);
    const useCase = new ExecuteIsolatedCalculixStaticProof({
      runner: {
        run: () => {
          runs++;
          return Promise.reject(
            new IsolatedCodeOutputValidationRejectedError(observation, destruction),
          );
        },
      },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("must not recover")),
        advanceProducerGeneration: () => Promise.reject(new Error("must not advance")),
      },
      publications: publications("not-published"),
      lease: immediateLease(),
      attempts,
      evidence: unreachableEvidence(),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });
    const first = await assertRejects(
      () => useCase.execute(fixture),
      IsolatedCalculixOutputValidationRejectedError,
      "no redispatch occurs",
    );
    assertEquals(first.observation, observation);
    assertEquals(first.destruction, destruction);
    assertEquals(runs, 1);
    const persisted = await attempts.read(
      fixture.identity.projectId,
      fixture.identity.agentRunId,
    );
    assertEquals(persisted?.phase, "output-validation-rejected");
    const replay = await assertRejects(
      () => useCase.execute(fixture),
      IsolatedCalculixOutputValidationRejectedError,
      "no redispatch occurs",
    );
    assertEquals(replay.observation, first.observation);
    assertEquals(replay.destruction, first.destruction);
    assertEquals(runs, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("isolated CalculiX recovery consumes one proven redispatch and never grants a third", async () => {
  await withPreparedDispatch(async ({ attempts, identity, bundle }) => {
    let runs = 0;
    const recoveries: number[] = [];
    let advances = 0;
    const useCase = new ExecuteIsolatedCalculixStaticProof({
      runner: {
        run: (request) => {
          runs++;
          assertEquals(request.producerGeneration, 1);
          throw new Error("lost second dispatch acknowledgement");
        },
      },
      recovery: {
        destroyByRunId: (runId, producerGeneration) => {
          recoveries.push(producerGeneration);
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: {
              algorithm: "sha256" as const,
              digest: producerGeneration === 0 ? "e".repeat(64) : "f".repeat(64),
            },
          });
        },
        advanceProducerGeneration: (input) => {
          advances++;
          assertEquals(input, {
            runId: identity.executionRunId,
            closedGeneration: 0,
            nextGeneration: 1,
          });
          return createIsolatedOutputProducerGenerationAdvance(input);
        },
      },
      publications: publications("not-published"),
      lease: immediateLease(),
      attempts,
      evidence: unreachableEvidence(),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });

    await assertRejects(
      () => useCase.execute({ identity, bundle }),
      Error,
      "lost second dispatch acknowledgement",
    );
    assertEquals(runs, 1);
    assertEquals(recoveries, [0]);
    assertEquals(advances, 1);
    const exhausted = await assertRejects(
      () => useCase.execute({ identity, bundle }),
      IsolatedCalculixRedispatchExhaustedError,
      "no third dispatch occurs",
    );
    assertEquals(exhausted.producerGeneration, 1);
    assertEquals(exhausted.executionRunId, identity.executionRunId);
    assertEquals(exhausted.destruction.status, "proven");
    assertEquals("diagnostic" in exhausted, false);
    const persisted = await attempts.read(identity.projectId, identity.agentRunId);
    assertEquals(persisted?.phase, "redispatch-exhausted");
    const replay = await assertRejects(
      () => useCase.execute({ identity, bundle }),
      IsolatedCalculixRedispatchExhaustedError,
      "no third dispatch occurs",
    );
    assertEquals(replay.destruction, exhausted.destruction);
    assertEquals(runs, 1);
    assertEquals(recoveries, [0, 1]);
    assertEquals(advances, 1);
  });
});

Deno.test("isolated CalculiX serializes concurrent calls, closes the batch and replays without redispatch", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await executionFixture();
    const outputBytes = outputFixture(fixture.bundle);
    const receipt = await receiptFixture(fixture.identity, fixture.bundle, outputBytes);
    let runs = 0;
    let objectReads = 0;
    const attemptsDirectory = `${root}/attempts`;
    const evidenceDirectory = `${root}/evidence`;
    const useCase = new ExecuteIsolatedCalculixStaticProof({
      runner: {
        run: async () => {
          runs++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return receipt;
        },
      },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("unreachable")),
        advanceProducerGeneration: () => Promise.reject(new Error("unreachable")),
      },
      publications: {
        resolvePublicationByRunId: () => Promise.reject(new Error("unreachable")),
        readReceipt: () => Promise.resolve(receipt),
        readPublishedObject: (_ref, member) => {
          assertEquals("bytes" in member, false);
          objectReads++;
          return Promise.resolve(outputBytes.get(member.role)?.slice());
        },
      },
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      attempts: new FileCalculixIsolatedExecutionAttemptStore(attemptsDirectory),
      evidence: new FileCalculixIsolatedExecutionEvidenceStore(evidenceDirectory),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });

    const [first, concurrentReplay] = await Promise.all([
      useCase.execute(fixture),
      useCase.execute(fixture),
    ]);
    assertEquals(first.attempt.phase, "evidence-captured");
    assertEquals(concurrentReplay.attempt.phase, "evidence-captured");
    assertEquals(concurrentReplay.evidence, first.evidence);
    assertEquals(
      first.evidence.authority.resolvedOperationPlanFingerprint,
      fixture.identity.resolvedOperationPlanFingerprint,
    );
    assertEquals(
      first.evidence.executionProfileFingerprint,
      fixture.identity.profile.profileFingerprint,
    );
    assertEquals(runs, 1);
    assertEquals(objectReads, 2 * CALCULIX_ISOLATED_OUTPUT_MANIFEST.length);

    const replay = new ExecuteIsolatedCalculixStaticProof({
      runner: { run: () => Promise.reject(new Error("must not redispatch")) },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("must not recover")),
        advanceProducerGeneration: () => Promise.reject(new Error("must not advance")),
      },
      publications: {
        resolvePublicationByRunId: () => Promise.reject(new Error("must not resolve")),
        readReceipt: () => Promise.resolve(receipt),
        readPublishedObject: (_ref, member) => {
          assertEquals("bytes" in member, false);
          objectReads++;
          return Promise.resolve(outputBytes.get(member.role)?.slice());
        },
      },
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      attempts: new FileCalculixIsolatedExecutionAttemptStore(attemptsDirectory),
      evidence: new FileCalculixIsolatedExecutionEvidenceStore(evidenceDirectory),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });
    const reopened = await replay.execute(fixture);
    assertEquals(reopened.evidence, first.evidence);
    assertEquals(runs, 1);
    assertEquals(objectReads, 3 * CALCULIX_ISOLATED_OUTPUT_MANIFEST.length);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("isolated CalculiX rejects metrics that are not derived from job.dat", async () => {
  const root = await Deno.makeTempDir();
  try {
    const fixture = await executionFixture();
    const outputBytes = outputFixture(fixture.bundle);
    const parsed = JSON.parse(
      new TextDecoder().decode(outputBytes.get("result.json")!),
    );
    parsed.metrics.maximumVonMises.value = 99;
    outputBytes.set(
      "result.json",
      new TextEncoder().encode(deterministicJson(parsed)),
    );
    const receipt = await receiptFixture(fixture.identity, fixture.bundle, outputBytes);
    const useCase = new ExecuteIsolatedCalculixStaticProof({
      runner: { run: () => Promise.resolve(receipt) },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("unreachable")),
        advanceProducerGeneration: () => Promise.reject(new Error("unreachable")),
      },
      publications: {
        resolvePublicationByRunId: () => Promise.reject(new Error("unreachable")),
        readReceipt: () => Promise.resolve(receipt),
        readPublishedObject: (_ref, member) =>
          Promise.resolve(outputBytes.get(member.role)?.slice()),
      },
      lease: immediateLease(),
      attempts: new FileCalculixIsolatedExecutionAttemptStore(`${root}/attempts`),
      evidence: new FileCalculixIsolatedExecutionEvidenceStore(`${root}/evidence`),
      inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
    });
    await assertRejects(
      () => useCase.execute(fixture),
      TypeError,
      "metrics differ from the exact job.dat",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

class PersistThenLoseAckAttemptStore extends FileCalculixIsolatedExecutionAttemptStore {
  #fail = true;

  override markOutputValidationRejected(
    input: Parameters<
      FileCalculixIsolatedExecutionAttemptStore["markOutputValidationRejected"]
    >[0],
  ) {
    return super.markOutputValidationRejected(input).then((rejected) => {
      if (this.#fail) {
        this.#fail = false;
        throw new Error("lost output-validation WAL acknowledgement");
      }
      return rejected;
    });
  }
}

function publications(status: "not-published" | "outcome-unknown") {
  return {
    resolvePublicationByRunId: (runId: string, producerGeneration: 0 | 1) =>
      Promise.resolve({ status, runId, producerGeneration }),
    readReceipt: () => Promise.reject(new Error("unreachable")),
    readPublishedObject: () => Promise.reject(new Error("unreachable")),
  };
}

function immediateLease() {
  return {
    withLease: <T>(
      _projectId: string,
      _executionRunId: string,
      operation: () => Promise<T>,
    ) => operation(),
  };
}

function unreachableEvidence() {
  return {
    save: () => Promise.reject(new Error("unreachable")),
    read: () => Promise.reject(new Error("unreachable")),
    uriFor: () => "casys://unreachable/sha256/" + "0".repeat(64),
  };
}

async function withPreparedDispatch(
  body: (input: {
    attempts: FileCalculixIsolatedExecutionAttemptStore;
    identity: CalculixIsolatedExecutionAttemptIdentity;
    bundle: Awaited<ReturnType<typeof createCalculixIsolatedInputBundle>>;
  }) => Promise<void>,
) {
  const directory = await Deno.makeTempDir();
  try {
    const attempts = new FileCalculixIsolatedExecutionAttemptStore(directory);
    const { identity, bundle } = await executionFixture();
    const prepared = await attempts.prepare(identity);
    await attempts.markDispatching({
      projectId: prepared.projectId,
      agentRunId: prepared.agentRunId,
      executionRunId: prepared.executionRunId,
      attemptFingerprint: prepared.attemptFingerprint,
      dispatchedAt: AT,
    });
    await body({ attempts, identity, bundle });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function executionFixture() {
  const proof = validateMechanicalProofCase(JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json",
        import.meta.url,
      ),
    ),
  ));
  const exactProof = validateMechanicalProofCase({
    ...proof,
    expectedCadArtifact: {
      format: "step",
      sha256: await fingerprintResourceBytes(STEP),
      bytes: STEP.byteLength,
    },
  });
  const bundle = await createCalculixIsolatedInputBundle({
    requestId: "request:calculix-local",
    proof: exactProof,
    stepBytes: STEP,
    elementOrder: 2,
    timeoutMs: 120_000,
  });
  const identity: CalculixIsolatedExecutionAttemptIdentity = {
    projectId: bundle.manifest.proof.project.id,
    agentRunId: "run:calculix-local",
    executionRunId: `calculix-local-${"1".repeat(64)}`,
    requestId: bundle.manifest.requestId,
    startedAt: AT,
    resolvedOperationPlanFingerprint: {
      algorithm: "sha256",
      digest: "2".repeat(64),
    },
    proofFingerprint: bundle.manifest.proofFingerprint,
    step: {
      byteCount: bundle.manifest.step.byteCount,
      sha256: bundle.manifest.step.sha256,
    },
    bundleFingerprint: bundle.fingerprint,
    profile: await profile(),
  };
  return { identity, bundle };
}

function outputFixture(
  bundle: Awaited<ReturnType<typeof createCalculixIsolatedInputBundle>>,
) {
  const proof = bundle.manifest.proof;
  const selections = [
    ...proof.analysis.supports.map((item) => item.selection.name),
    ...proof.analysis.loads.map((item) => item.selection.name),
  ];
  const nodesPerSelection = Object.fromEntries(
    selections.map((name) => [name, 1]),
  );
  const meshInp = [
    "*NODE",
    "1,0,0,0",
    "2,1,0,0",
    "*ELEMENT,TYPE=C3D4,ELSET=PART",
    "1,1,2,1,2",
    "*NSET,NSET=FIXED",
    "1",
    "*NSET,NSET=LOADED",
    "2",
    "",
  ].join("\n");
  const inspected = CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR.inspectMesh(meshInp);
  const meshGeo = CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR.buildMeshScript({
    stepPath: "input.step",
    selections: [
      ...proof.analysis.supports,
      ...proof.analysis.loads,
    ].map((item) => ({
      name: item.selection.name,
      box: { min: item.selection.box.min, max: item.selection.box.max },
    })),
    meshSizeMm: proof.analysis.mesh.targetSize.value,
    elementOrder: bundle.manifest.effective.elementOrder,
    timeoutMs: bundle.manifest.effective.timeoutMs,
  });
  const jobInp = CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR.buildDeck({
    inpText: meshInp,
    maxNodeId: inspected.maxNodeId,
    material: {
      eMpa: proof.analysis.material.youngModulus.value,
      nu: proof.analysis.material.poissonRatio.value,
    },
    fixed: proof.analysis.supports.map((item) => item.selection.name),
    loads: proof.analysis.loads.map((item) => ({
      selection: item.selection.name,
      totalForceN: item.force.value,
    })),
    nodesPerSet: inspected.nodesPerSet,
  });
  const jobDat = [
    " displacements",
    "2 0 0 -0.1",
    " stresses",
    "1 1 2 0 0 0 0 0",
    "",
  ].join("\n");
  const text = (value: string) => new TextEncoder().encode(value);
  const values = new Map<string, Uint8Array>([
    ["input.step", bundle.stepBytes.copy()],
    [
      "request.json",
      text(deterministicJson({
        schemaVersion: CALCULIX_ISOLATED_REQUEST_SCHEMA,
        requestId: bundle.manifest.requestId,
        proofFingerprint: bundle.manifest.proofFingerprint,
        effective: bundle.manifest.effective,
        step: bundle.manifest.step,
      })),
    ],
    ["mesh.geo", text(meshGeo)],
    ["mesh.inp", text(meshInp)],
    ["gmsh.log", text("gmsh passed\n")],
    ["job.inp", text(jobInp)],
    ["ccx.log", text("ccx passed\n")],
    ["job.dat", text(jobDat)],
    [
      "result.json",
      text(deterministicJson({
        schemaVersion: CALCULIX_ISOLATED_RESULT_SCHEMA,
        requestId: bundle.manifest.requestId,
        executionIdentity: {
          schemaVersion: "1.0",
          profile: { id: "calculix-static-proof-v1", version: "1.0.0" },
          wrapper: { id: "calculix-static-proof-v1", version: "1.0.0" },
          lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
          engines: {
            gmsh: { command: "gmsh", version: "4.12.1" },
            ccx: { command: "ccx", version: "This is Version 2.21" },
          },
          image: { status: "bound-by-isolated-runner-receipt" },
        },
        inputArtifact: {
          mediaType: "model/step",
          byteCount: bundle.manifest.step.byteCount,
          sha256: bundle.manifest.step.sha256,
        },
        mesh: { nodes: 2, elements: 1, nodesPerSelection },
        constraints: {
          fixedSelections: proof.analysis.supports.map((item) => item.selection.name),
          loads: proof.analysis.loads.map((item) => ({
            selection: item.selection.name,
            forceN: item.force.value,
          })),
        },
        metrics: {
          maximumDisplacement: {
            value: 0.1,
            unit: "mm",
            nodeId: 2,
            vectorMm: [0, 0, -0.1],
          },
          maximumVonMises: {
            value: 2,
            unit: "MPa",
            elementId: 1,
          },
        },
      })),
    ],
  ]);
  for (const declaration of CALCULIX_ISOLATED_OUTPUT_MANIFEST) {
    validateCalculixIsolatedOutput(declaration, values.get(declaration.role)!);
  }
  return values;
}

async function receiptFixture(
  identity: CalculixIsolatedExecutionAttemptIdentity,
  bundle: Awaited<ReturnType<typeof createCalculixIsolatedInputBundle>>,
  outputBytes: ReadonlyMap<string, Uint8Array>,
  producerGeneration: 0 | 1 = 0,
) {
  const outputs = await Promise.all(
    CALCULIX_ISOLATED_OUTPUT_MANIFEST.map(async (declaration) => {
      const bytes = outputBytes.get(declaration.role)!;
      const sha256 = await fingerprintResourceBytes(bytes);
      return {
        ...declaration,
        bytes,
        byteCount: bytes.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
      };
    }),
  );
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    identity.executionRunId,
    producerGeneration,
    outputs.map(({ bytes: _bytes, ...output }) => output),
  );
  return await createIsolatedCodeExecutionReceipt({
    request: {
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId: identity.executionRunId,
      producerGeneration,
      profile: identity.profile.executionProfile,
      source: {
        bytes: bundle.bytes,
        sha256: bundle.fingerprint.digest,
      },
      policy: identity.profile.isolationPolicy,
      outputs: CALCULIX_ISOLATED_OUTPUT_MANIFEST,
    },
    runtime: identity.profile.runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs,
    destruction: {
      status: "proven",
      runId: identity.executionRunId,
      proofFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
    },
    publication: await createIsolatedOutputPublicationRef(
      identity.executionRunId,
      producerGeneration,
      publicationFingerprint,
    ),
  });
}

async function profile() {
  const limits: IsolatedCodeExecutionLimits = {
    maxWallTimeMs: 180_000,
    maxCpuTimeMs: 160_000,
    maxMemoryBytes: 2 * 1_073_741_824,
    maxProcesses: 16,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxOutputFileBytes: 128 * 1_048_576,
    maxOutputTotalBytes: 256 * 1_048_576,
  };
  const digest = "a".repeat(64);
  return await new FixedCalculixIsolatedExecutionProfileCatalog({
    imageReference: `ghcr.io/casys-ai/calculix-static@sha256:${digest}`,
    wrapperSha256: "b".repeat(64),
    policy: {
      id: "calculix-microsandbox-no-network",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    limits,
  }).initial();
}
