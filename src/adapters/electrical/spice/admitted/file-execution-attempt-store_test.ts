import { assertEquals, assertRejects } from "@std/assert";
import type { AdmittedSpiceExecutionAttemptIdentity } from "../../../../application/ports/out/electrical/spice/admitted-execution-attempt-store.ts";
import { createIsolatedOutputProducerGenerationAdvance } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import { SPICE_ADMITTED_REQUESTED_LIMITS } from "../../../../domain/electrical/spice/admitted/contract.ts";
import { deriveAdmittedSpiceExecutionRunId } from "../../../../domain/electrical/spice/admitted/execution-evidence.ts";
import {
  SPICE_ADMITTED_COMPILATION_SCHEMA,
  SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
  validateSpiceAdmittedRunAdmission,
} from "../../../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { FixedAdmittedSpiceExecutionProfileCatalog } from "./execution-profile-catalog.ts";
import {
  AdmittedSpiceExecutionAttemptIntegrityError,
  FileAdmittedSpiceExecutionAttemptStore,
} from "./file-execution-attempt-store.ts";

const AT = "2026-08-23T05:00:00.000Z";

Deno.test(
  "admitted SPICE WAL round-trips retry-generation-closed with proven generation-one cleanup",
  async () => {
    await withStore(async (store, directory) => {
      const fixture = await walFixture();
      const prepared = await store.prepare(fixture.identity, AT);
      const key = keyFor(prepared);
      await store.markDispatching({ ...key, dispatchedAt: AT });
      await store.markGenerationZeroCleaned({
        ...key,
        destruction: fixture.generationZeroDestruction,
      });
      const advance = await createIsolatedOutputProducerGenerationAdvance({
        runId: fixture.identity.executionRunId,
        closedGeneration: 0,
        nextGeneration: 1,
      });
      const redispatch = await store.markRedispatching({
        ...key,
        advance,
        dispatchedAt: AT,
      });
      assertEquals(redispatch.outcome, "transitioned-now");
      await assertRejects(
        () =>
          store.markRetryGenerationClosed({
            ...key,
            destruction: fixture.unattestedDestruction as never,
          }),
        TypeError,
      );
      const closed = await store.markRetryGenerationClosed({
        ...key,
        destruction: fixture.generationOneDestruction,
      });
      assertEquals(closed.phase, "retry-generation-closed");
      if (closed.phase !== "retry-generation-closed") {
        throw new Error("unreachable");
      }
      assertEquals(closed.dispatch, {
        dispatchCount: 2,
        producerGeneration: 1,
        dispatchedAt: AT,
      });
      assertEquals(closed.closedGeneration, {
        producerGeneration: 1,
        destruction: fixture.generationOneDestruction,
      });
      assertEquals(
        await store.markRetryGenerationClosed({
          ...key,
          destruction: fixture.generationOneDestruction,
        }),
        closed,
      );
      await assertRejects(
        () =>
          store.markRetryGenerationClosed({
            ...key,
            destruction: {
              ...fixture.generationOneDestruction,
              proofFingerprint: hash("a"),
            },
          }),
        AdmittedSpiceExecutionAttemptIntegrityError,
        "divergent",
      );

      const reopened = await new FileAdmittedSpiceExecutionAttemptStore(directory)
        .read(fixture.identity.projectId, fixture.identity.agentRunId);
      assertEquals(reopened, closed);
    });
  },
);

Deno.test(
  "admitted SPICE WAL rejects retry-generation-closed out of order and on file replay",
  async () => {
    await withStore(async (store) => {
      const fixture = await walFixture();
      const prepared = await store.prepare(fixture.identity, AT);
      const key = keyFor(prepared);
      await assertRejects(
        () =>
          store.markRetryGenerationClosed({
            ...key,
            destruction: fixture.generationOneDestruction,
          }),
        AdmittedSpiceExecutionAttemptIntegrityError,
        "out of order",
      );
      await store.markDispatching({ ...key, dispatchedAt: AT });
      await assertRejects(
        () =>
          store.markRetryGenerationClosed({
            ...key,
            destruction: fixture.generationOneDestruction,
          }),
        AdmittedSpiceExecutionAttemptIntegrityError,
        "out of order",
      );
      await store.markGenerationZeroCleaned({
        ...key,
        destruction: fixture.generationZeroDestruction,
      });
      await assertRejects(
        () =>
          store.markRetryGenerationClosed({
            ...key,
            destruction: fixture.generationOneDestruction,
          }),
        AdmittedSpiceExecutionAttemptIntegrityError,
        "out of order",
      );
      const advance = await createIsolatedOutputProducerGenerationAdvance({
        runId: fixture.identity.executionRunId,
        closedGeneration: 0,
        nextGeneration: 1,
      });
      await store.markRedispatching({ ...key, advance, dispatchedAt: AT });
      const closed = await store.markRetryGenerationClosed({
        ...key,
        destruction: fixture.generationOneDestruction,
      });
      assertEquals(closed.phase, "retry-generation-closed");

      const path = await store.pathFor(
        fixture.identity.projectId,
        fixture.identity.agentRunId,
      );
      const recorded = JSON.parse(await Deno.readTextFile(path));
      recorded.closedGeneration.producerGeneration = 0;
      await Deno.writeTextFile(path, `${deterministicJson(recorded)}\n`);
      await assertRejects(
        () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
        TypeError,
        "$attempt.closedGeneration.producerGeneration",
      );
    });
  },
);

Deno.test("admitted SPICE WAL persists a terminal output-validation rejection and refuses redispatch", async () => {
  await withStore(async (store, directory) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity, AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const observation = {
      role: "evidence",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    const destruction = {
      status: "proven" as const,
      runId: fixture.identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
    };
    const rejected = await store.markOutputValidationRejected({
      ...key,
      observation,
      destruction,
    });
    assertEquals(rejected.phase, "output-validation-rejected");
    const restarted = new FileAdmittedSpiceExecutionAttemptStore(directory);
    assertEquals(
      await restarted.read(fixture.identity.projectId, fixture.identity.agentRunId),
      rejected,
    );
    assertEquals(
      await restarted.markOutputValidationRejected({
        ...key,
        observation,
        destruction,
      }),
      rejected,
    );
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () => restarted.markRedispatching({ ...key, advance, dispatchedAt: AT }),
      AdmittedSpiceExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        restarted.markOutputValidationRejected({
          ...key,
          observation: { ...observation, role: "job.dat" },
          destruction,
        }),
      AdmittedSpiceExecutionAttemptIntegrityError,
      "role is not registered",
    );
  });
});

async function walFixture() {
  const source = new TextEncoder().encode(
    "Vin in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n",
  );
  const sourceSha256 = await fingerprintResourceBytes(source);
  const profile = await new FixedAdmittedSpiceExecutionProfileCatalog({
    imageReference: `casys/ngspice-microsandbox-worker@sha256:${"9".repeat(64)}`,
    policy: {
      id: "spice-admitted-deny-all",
      version: "1.0.0",
      fingerprint: hash("8"),
    },
    limits: SPICE_ADMITTED_REQUESTED_LIMITS,
  }).initial();
  const admission = validateSpiceAdmittedRunAdmission({
    schemaVersion: SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
    admissionArtifact: {
      schemaVersion: SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
      id: `technical-compilation-admission-${"1".repeat(64)}`,
      fingerprint: hash("1"),
    },
    compilation: {
      document: {
        schemaVersion: SPICE_ADMITTED_COMPILATION_SCHEMA,
        fingerprint: hash("2"),
        status: "ready-for-review",
      },
      projection: {
        target: "spice-circuit-source",
        fingerprint: hash("3"),
        status: "ready-for-review",
      },
      source: {
        id: "source.spice.divider",
        sourceFingerprint: {
          algorithm: "sha256",
          digest: sourceSha256,
        },
        captureFingerprint: hash("4"),
        analysisFingerprint: hash("5"),
      },
      profile: {
        id: profile.compilationProfile.id,
        version: profile.compilationProfile.version,
        fingerprint: profile.compilationProfileFingerprint,
      },
    },
    execution: {
      profile: {
        id: profile.executionProfile.id,
        version: profile.executionProfile.version,
        fingerprint: profile.profileFingerprint,
      },
      isolationPolicy: profile.isolationPolicy,
      runtimeBackend: profile.runtimeBackend,
      runtime: {
        imageDigest: profile.runtime.imageDigest,
        isolationClass: profile.runtime.isolationClass,
        limits: profile.runtime.requestedLimits,
        limitAssurance: profile.runtime.limitAssurance,
      },
      outputValidator: profile.outputValidator,
      outputs: profile.outputManifest,
      minimumDestructionAssurance: profile.minimumDestructionAssurance,
    },
    status: "ready-for-execution-review",
  });
  const projectId = "spice-generic-wal";
  const agentRunId = "run-generic-admitted-spice";
  const executionRunId = await deriveAdmittedSpiceExecutionRunId(
    projectId,
    agentRunId,
  );
  const basis = {
    kind: "thread-snapshot" as const,
    snapshotId: "subject.spice:r8:compile-seal-admission",
    revision: 8,
    subjectId: "subject.spice",
  };
  const authorityFingerprint = await sha256Fingerprint({
    basis,
    decisionId: "decision.spice.run",
  });
  const identity: AdmittedSpiceExecutionAttemptIdentity = {
    projectId,
    agentRunId,
    executionRunId,
    startedAt: AT,
    basis,
    basisFingerprint: await sha256Fingerprint({ snapshot: basis }),
    reviewedRunFingerprint: await sha256Fingerprint({
      workItemId: "work.spice.run",
      basis,
      decision: authorityFingerprint,
    }),
    decision: {
      id: "decision.spice.run",
      inputFingerprint: authorityFingerprint,
    },
    approval: {
      id: "approval.spice.run",
      inputFingerprint: authorityFingerprint,
    },
    admission,
    executionProfile: profile,
    isolatedRequest: {
      schemaVersion: "isolated-code-execution-request/1.0",
      runId: executionRunId,
      producerGeneration: 0,
      profile: profile.executionProfile,
      sourceSha256,
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    },
  };
  return {
    identity,
    generationZeroDestruction: {
      status: "proven" as const,
      runId: executionRunId,
      proofFingerprint: hash("6"),
    },
    generationOneDestruction: {
      status: "proven" as const,
      runId: executionRunId,
      proofFingerprint: hash("9"),
    },
    unattestedDestruction: {
      status: "acknowledged-unattested" as const,
      runId: executionRunId,
      acknowledgementFingerprint: hash("6"),
    },
  };
}

function keyFor(value: {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: ReturnType<typeof hash>;
}) {
  return {
    projectId: value.projectId,
    agentRunId: value.agentRunId,
    executionRunId: value.executionRunId,
    attemptFingerprint: value.attemptFingerprint,
  };
}

function hash(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}

async function withStore(
  body: (
    store: FileAdmittedSpiceExecutionAttemptStore,
    directory: string,
  ) => Promise<void>,
) {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "admitted-spice-wal-" }),
  );
  try {
    await body(new FileAdmittedSpiceExecutionAttemptStore(directory), directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
