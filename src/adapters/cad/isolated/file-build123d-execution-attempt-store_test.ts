import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type Build123dExecutionAttemptIdentity,
  fingerprintBuild123dExecutionAttemptIdentity,
} from "../../../application/ports/out/cad/isolated/build123d-execution-attempt-store.ts";
import {
  BUILD123D_EXECUTION_PROFILE_SCHEMA,
  type Build123dExecutionProfile,
} from "../../../application/ports/out/cad/isolated/build123d-execution-profile-catalog.ts";
import {
  BUILD123D_EXECUTION_OUTPUT,
  BUILD123D_EXECUTION_PROFILE,
  validateBuild123dExecutionAdmission,
} from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  buildBuild123dExecutionDraftReference,
  createBuild123dExecutionDraft,
  deriveBuild123dExecutionRunId,
} from "../../../domain/cad/isolated/build123d-execution-evidence.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createMicrosandboxRuntimeAttestation,
  MICROSANDBOX_LOCAL_RUNTIME_REF,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  Build123dExecutionAttemptIntegrityError,
  FileBuild123dExecutionAttemptStore,
} from "./file-build123d-execution-attempt-store.ts";

const AT = "2026-08-13T10:00:00.000Z";

Deno.test("Build123d WAL follows its six exact phases and replays idempotently", async () => {
  await withStore(async (store, directory) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    assertEquals(prepared.phase, "prepared");
    assertEquals(await store.prepare(fixture.identity), prepared);
    const key = {
      projectId: fixture.identity.projectId,
      agentRunId: fixture.identity.agentRunId,
      executionRunId: fixture.identity.executionRunId,
      attemptFingerprint: prepared.attemptFingerprint,
    };
    const dispatching = await store.markDispatching({ ...key, dispatchedAt: AT });
    assertEquals(dispatching.phase, "dispatching");
    if (dispatching.phase !== "dispatching") throw new Error("unreachable");
    assertEquals(dispatching.dispatch, {
      dispatchCount: 1,
      producerGeneration: 0,
      dispatchedAt: AT,
    });
    assertEquals(
      await store.markDispatching({ ...key, dispatchedAt: AT }),
      dispatching,
    );
    const published = await store.markOutputPublished({
      ...key,
      receiptRecord: fixture.receiptRecord,
    });
    assertEquals(published.phase, "output-published");
    const drafted = await store.markDraftPersisted({
      ...key,
      draftReference: fixture.draftReference,
    });
    assertEquals(drafted.phase, "draft-persisted");
    const threadEvidence = {
      snapshotId: "snapshot.9",
      revision: 9,
      subjectId: "subject.box",
      artifactId: `build123d-execution-${"8".repeat(64)}`,
      artifactFingerprint: hash("8"),
    };
    const threaded = await store.markThreadPersisted({ ...key, threadEvidence });
    assertEquals(threaded.phase, "thread-persisted");
    const completed = await store.markCompleted(key);
    assertEquals(completed.phase, "completed");
    if (completed.phase !== "completed") throw new Error("unreachable");
    assertEquals(completed.dispatch.producerGeneration, 0);
    assertEquals(await store.markCompleted(key), completed);
    assertEquals(await store.read(key.projectId, key.agentRunId), completed);

    if (Deno.build.os !== "windows") {
      assertEquals((await Deno.stat(directory)).mode! & 0o777, 0o700);
      assertEquals(
        (await Deno.stat(await store.pathFor(key.projectId, key.agentRunId))).mode! &
          0o777,
        0o600,
      );
    }
  });
});

Deno.test("Build123d WAL rejects order, transition identity drift and MRTR drift", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    const key = {
      projectId: fixture.identity.projectId,
      agentRunId: fixture.identity.agentRunId,
      executionRunId: fixture.identity.executionRunId,
      attemptFingerprint: prepared.attemptFingerprint,
    };
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptRecordG1,
        }),
      Build123dExecutionAttemptIntegrityError,
      "out of order",
    );
    await assertRejects(
      () =>
        store.markDispatching({
          ...key,
          attemptFingerprint: hash("9"),
          dispatchedAt: AT,
        }),
      Build123dExecutionAttemptIntegrityError,
      "key is divergent",
    );
    const drift = structuredClone(fixture.identity);
    drift.approval.fingerprint.digest = "7".repeat(64);
    await assertRejects(
      () => store.prepare(drift),
      Build123dExecutionAttemptIntegrityError,
      "divergent identity",
    );
    const badRedundancy = structuredClone(fixture.identity);
    badRedundancy.document.fingerprint.digest = "6".repeat(64);
    await assertRejects(
      () => store.prepare(badRedundancy),
      Build123dExecutionAttemptIntegrityError,
    );
  });
});

Deno.test("Build123d WAL records at most one exact recovery-authorized redispatch", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    const key = {
      projectId: fixture.identity.projectId,
      agentRunId: fixture.identity.agentRunId,
      executionRunId: fixture.identity.executionRunId,
      attemptFingerprint: prepared.attemptFingerprint,
    };
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const recoveryDestruction = {
      status: "proven" as const,
      runId: key.executionRunId,
      proofFingerprint: hash("a"),
    };
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: key.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () => store.consumeRedispatch(key),
      Build123dExecutionAttemptIntegrityError,
      "only after exact authorization",
    );
    await assertRejects(
      () =>
        store.authorizeRedispatch({
          ...key,
          recoveryDestruction: {
            status: "acknowledged-unattested",
            runId: key.executionRunId,
            acknowledgementFingerprint: hash("a"),
          },
          generationAdvance,
        }),
      Build123dExecutionAttemptIntegrityError,
      "requires proven cleanup",
    );
    const second = await store.authorizeRedispatch({
      ...key,
      recoveryDestruction,
      generationAdvance,
    });
    assertEquals(second.phase, "dispatching");
    if (second.phase !== "dispatching") throw new Error("unreachable");
    assertEquals(second.dispatch.dispatchCount, 2);
    if (second.dispatch.dispatchCount !== 2) throw new Error("unreachable");
    assertEquals(second.dispatch.producerGeneration, 1);
    assertEquals(second.dispatch.redispatch, {
      status: "authorized",
      previousProducerGeneration: 0,
      generationAdvance,
      recoveryDestruction,
    });
    assertEquals(
      await store.authorizeRedispatch({
        ...key,
        recoveryDestruction,
        generationAdvance,
      }),
      second,
    );
    await assertRejects(
      () =>
        store.authorizeRedispatch({
          ...key,
          recoveryDestruction: {
            ...recoveryDestruction,
            proofFingerprint: hash("b"),
          },
          generationAdvance,
        }),
      Build123dExecutionAttemptIntegrityError,
      "divergent",
    );
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptRecordG1,
        }),
      Build123dExecutionAttemptIntegrityError,
      "unconsumed",
    );

    const path = await store.pathFor(key.projectId, key.agentRunId);
    const authorizedText = await Deno.readTextFile(path);
    const corrupted = JSON.parse(authorizedText);
    corrupted.dispatch.redispatch.status = "pending";
    await Deno.writeTextFile(path, `${JSON.stringify(corrupted)}\n`);
    await assertRejects(
      () => store.read(key.projectId, key.agentRunId),
      Build123dExecutionAttemptIntegrityError,
      "authorized or consumed",
    );
    await Deno.writeTextFile(path, authorizedText);

    const consumed = await store.consumeRedispatch(key);
    assertEquals(consumed.outcome, "consumed-now");
    assertEquals(consumed.attempt.phase, "dispatching");
    if (
      consumed.attempt.phase !== "dispatching" ||
      consumed.attempt.dispatch.dispatchCount !== 2
    ) throw new Error("unreachable");
    assertEquals(consumed.attempt.dispatch.redispatch, {
      status: "consumed",
      previousProducerGeneration: 0,
      generationAdvance,
      recoveryDestruction,
    });
    assertEquals(await store.read(key.projectId, key.agentRunId), consumed.attempt);
    assertEquals(await store.consumeRedispatch(key), {
      outcome: "already-consumed",
      attempt: consumed.attempt,
    });
    assertEquals(
      await store.authorizeRedispatch({
        ...key,
        recoveryDestruction,
        generationAdvance,
      }),
      consumed.attempt,
    );
  });
});

Deno.test("Build123d WAL rejects a divergent producer-generation advance proof", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    const key = attemptKey(fixture.identity, prepared.attemptFingerprint);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const recoveryDestruction = recoveryProof(key.executionRunId);
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: key.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });

    await assertRejects(
      () =>
        store.authorizeRedispatch({
          ...key,
          recoveryDestruction,
          generationAdvance: {
            ...generationAdvance,
            fingerprint: hash("9"),
          },
        }),
      Build123dExecutionAttemptIntegrityError,
      "does not match this execution run",
    );
    const foreignAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: "build123d-execution-foreign",
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () =>
        store.authorizeRedispatch({
          ...key,
          recoveryDestruction,
          generationAdvance: foreignAdvance,
        }),
      Build123dExecutionAttemptIntegrityError,
      "does not match this execution run",
    );
  });
});

Deno.test("Build123d WAL accepts only the receipt from its current producer generation", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    const key = attemptKey(fixture.identity, prepared.attemptFingerprint);
    await store.markDispatching({ ...key, dispatchedAt: AT });

    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptRecordG1,
        }),
      Build123dExecutionAttemptIntegrityError,
      "another producer generation",
    );
    const published = await store.markOutputPublished({
      ...key,
      receiptRecord: fixture.receiptRecordG0,
    });
    assertEquals(published.phase, "output-published");
    if (published.phase !== "output-published") throw new Error("unreachable");
    assertEquals(published.dispatch.producerGeneration, 0);
    assertEquals(published.receiptRecord.producerGeneration, 0);
  });
});

Deno.test("Build123d WAL rejects a delayed generation-zero receipt after advancing to generation one", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    const key = attemptKey(fixture.identity, prepared.attemptFingerprint);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: key.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await store.authorizeRedispatch({
      ...key,
      recoveryDestruction: recoveryProof(key.executionRunId),
      generationAdvance,
    });

    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptRecordG1,
        }),
      Build123dExecutionAttemptIntegrityError,
      "unconsumed",
    );
    await store.consumeRedispatch(key);
    await assertRejects(
      () =>
        store.markOutputPublished({
          ...key,
          receiptRecord: fixture.receiptRecordG0,
        }),
      Build123dExecutionAttemptIntegrityError,
      "another producer generation",
    );
    const published = await store.markOutputPublished({
      ...key,
      receiptRecord: fixture.receiptRecordG1,
    });
    assertEquals(published.phase, "output-published");
    if (published.phase !== "output-published") throw new Error("unreachable");
    assertEquals(published.dispatch.producerGeneration, 1);
    assertEquals(published.receiptRecord.producerGeneration, 1);
    if (published.dispatch.dispatchCount !== 2) throw new Error("unreachable");
    assertEquals(published.dispatch.redispatch.generationAdvance, generationAdvance);

    await assertRejects(
      () =>
        store.markDraftPersisted({
          ...key,
          draftReference: fixture.draftReferenceG0,
        }),
      Build123dExecutionAttemptIntegrityError,
      "does not derive from the exact durable execution receipt",
    );
    const drafted = await store.markDraftPersisted({
      ...key,
      draftReference: fixture.draftReferenceG1,
    });
    assertEquals(drafted.phase, "draft-persisted");
    const threadEvidence = {
      snapshotId: "snapshot.9",
      revision: 9,
      subjectId: "subject.box",
      artifactId: `build123d-execution-${"8".repeat(64)}`,
      artifactFingerprint: hash("8"),
    };
    await store.markThreadPersisted({ ...key, threadEvidence });
    const completed = await store.markCompleted(key);
    assertEquals(completed.phase, "completed");
    assertEquals(await store.read(key.projectId, key.agentRunId), completed);

    const path = await store.pathFor(key.projectId, key.agentRunId);
    const completedText = await Deno.readTextFile(path);
    const unconsumedPublished = JSON.parse(completedText);
    unconsumedPublished.dispatch.redispatch.status = "authorized";
    await Deno.writeTextFile(path, `${JSON.stringify(unconsumedPublished)}\n`);
    await assertRejects(
      () => store.read(key.projectId, key.agentRunId),
      Build123dExecutionAttemptIntegrityError,
      "requires a consumed redispatch authorization",
    );
    await Deno.writeTextFile(path, completedText);
    const wrongDraft = JSON.parse(completedText);
    wrongDraft.draftReference = fixture.draftReferenceG0;
    await Deno.writeTextFile(path, `${JSON.stringify(wrongDraft)}\n`);
    await assertRejects(
      () => store.read(key.projectId, key.agentRunId),
      Build123dExecutionAttemptIntegrityError,
      "does not derive from the exact durable execution receipt",
    );
  });
});

Deno.test("Build123d WAL rejects corrupted dispatch generations and advance proofs", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    const key = attemptKey(fixture.identity, prepared.attemptFingerprint);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const path = await store.pathFor(key.projectId, key.agentRunId);
    const generationZeroText = await Deno.readTextFile(path);
    const wrongFirstGeneration = JSON.parse(generationZeroText);
    wrongFirstGeneration.dispatch.producerGeneration = 1;
    await Deno.writeTextFile(path, `${JSON.stringify(wrongFirstGeneration)}\n`);
    await assertRejects(
      () => store.read(key.projectId, key.agentRunId),
      TypeError,
      "producerGeneration",
    );

    await Deno.writeTextFile(path, generationZeroText);
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: key.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await store.authorizeRedispatch({
      ...key,
      recoveryDestruction: recoveryProof(key.executionRunId),
      generationAdvance,
    });
    const generationOneText = await Deno.readTextFile(path);
    const generationTwo = JSON.parse(generationOneText);
    generationTwo.dispatch.producerGeneration = 2;
    await Deno.writeTextFile(path, `${JSON.stringify(generationTwo)}\n`);
    await assertRejects(
      () => store.read(key.projectId, key.agentRunId),
      TypeError,
      "producerGeneration",
    );

    const wrongPrevious = JSON.parse(generationOneText);
    wrongPrevious.dispatch.redispatch.previousProducerGeneration = 1;
    await Deno.writeTextFile(path, `${JSON.stringify(wrongPrevious)}\n`);
    await assertRejects(
      () => store.read(key.projectId, key.agentRunId),
      TypeError,
      "previousProducerGeneration",
    );

    const brokenProof = JSON.parse(generationOneText);
    brokenProof.dispatch.redispatch.generationAdvance.fingerprint.digest = "9".repeat(
      64,
    );
    await Deno.writeTextFile(path, `${JSON.stringify(brokenProof)}\n`);
    await assertRejects(
      () => store.read(key.projectId, key.agentRunId),
      Build123dExecutionAttemptIntegrityError,
      "does not match this execution run",
    );
  });
});

Deno.test("Build123d WAL rejects corruption and noncanonical private files", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    await store.prepare(fixture.identity);
    const path = await store.pathFor(
      fixture.identity.projectId,
      fixture.identity.agentRunId,
    );
    const text = await Deno.readTextFile(path);
    await Deno.writeTextFile(path, text.trim());
    await assertRejects(
      () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
      Build123dExecutionAttemptIntegrityError,
      "not canonical",
    );
    await Deno.writeTextFile(path, "not-json\n");
    await assertRejects(
      () => store.read(fixture.identity.projectId, fixture.identity.agentRunId),
      Build123dExecutionAttemptIntegrityError,
      "not JSON",
    );
  });
});

Deno.test("Build123d WAL prepares a draft id longer than the safeId bound", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const projectId = `p${"x".repeat(255)}`;
    const executionRunId = await deriveBuild123dExecutionRunId(
      projectId,
      fixture.identity.agentRunId,
    );
    const documentDigest =
      fixture.identity.technicalAdmission.draftReference.documentFingerprint.digest;
    const identity = {
      ...fixture.identity,
      projectId,
      executionRunId,
      technicalAdmission: {
        ...fixture.identity.technicalAdmission,
        draftReference: {
          ...fixture.identity.technicalAdmission.draftReference,
          projectId,
          draftId: `technical-compilation:${projectId}:${documentDigest}`,
        },
      },
      isolatedRequest: {
        ...fixture.identity.isolatedRequest,
        runId: executionRunId,
      },
    };
    assert(identity.technicalAdmission.draftReference.draftId.length > 256);
    const prepared = await store.prepare(identity);
    assertEquals(prepared.phase, "prepared");
    assertEquals(prepared.projectId, projectId);
  });
});

Deno.test("Build123d WAL rejects a draft id that is not the derived template", async () => {
  await withStore(async (store) => {
    const fixture = await walFixture();
    const identity = {
      ...fixture.identity,
      technicalAdmission: {
        ...fixture.identity.technicalAdmission,
        draftReference: {
          ...fixture.identity.technicalAdmission.draftReference,
          draftId: "technical-compilation:project.box:draft",
        },
      },
    };
    await assertRejects(
      () => store.prepare(identity),
      Build123dExecutionAttemptIntegrityError,
      "does not match its project and document fingerprint",
    );
  });
});

Deno.test("Build123d WAL persists a terminal output-validation rejection and refuses redispatch", async () => {
  await withStore(async (store, directory) => {
    const fixture = await walFixture();
    const prepared = await store.prepare(fixture.identity);
    const key = attemptKey(fixture.identity, prepared.attemptFingerprint);
    await store.markDispatching({ ...key, dispatchedAt: AT });
    const observation = {
      role: BUILD123D_EXECUTION_OUTPUT.role,
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
    const restarted = new FileBuild123dExecutionAttemptStore(directory);
    const recovered = await restarted.read(
      fixture.identity.projectId,
      fixture.identity.agentRunId,
    );
    assertEquals(recovered, rejected);
    assertEquals(
      await restarted.markOutputValidationRejected({
        ...key,
        observation,
        destruction,
      }),
      rejected,
    );
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: fixture.identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () =>
        restarted.authorizeRedispatch({
          ...key,
          recoveryDestruction: {
            status: "proven",
            runId: fixture.identity.executionRunId,
            proofFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
          },
          generationAdvance,
        }),
      Build123dExecutionAttemptIntegrityError,
      "only while dispatching",
    );
    await assertRejects(
      () =>
        restarted.markOutputValidationRejected({
          ...key,
          observation: { ...observation, role: "job.dat" },
          destruction,
        }),
      Build123dExecutionAttemptIntegrityError,
      "role is not registered",
    );
    await assertRejects(
      () =>
        store.markOutputValidationRejected({
          ...key,
          observation,
          destruction: {
            status: "acknowledged-unattested",
            runId: fixture.identity.executionRunId,
            acknowledgementFingerprint: {
              algorithm: "sha256",
              digest: "f".repeat(64),
            },
          } as never,
        }),
      Build123dExecutionAttemptIntegrityError,
      "requires proven cleanup",
    );
  });
});

async function walFixture() {
  const source = new TextEncoder().encode("result = Box(2, 3, 4)\n");
  const sourceSha256 = await fingerprintResourceBytes(source);
  const imageReference = `ghcr.io/casys-ai/build123d-runtime@sha256:${"9".repeat(64)}`;
  const runtime = createMicrosandboxRuntimeAttestation({
    imageReference,
    limits: limits(),
  });
  let admission = validateBuild123dExecutionAdmission({
    schemaVersion: "build123d-execution-admission/2.0",
    admissionArtifact: {
      schemaVersion: "technical-compilation-admission-capture/4.0",
      id: `technical-compilation-admission-${"1".repeat(64)}`,
      fingerprint: hash("1"),
    },
    compilation: {
      document: {
        schemaVersion: "technical-compilation/2.0",
        fingerprint: hash("2"),
        status: "ready-for-review",
      },
      projection: {
        target: "build123d-source",
        fingerprint: hash("3"),
        status: "ready-for-review",
      },
      source: {
        id: "source.box",
        sourceFingerprint: { algorithm: "sha256", digest: sourceSha256 },
        captureFingerprint: hash("4"),
        analysisFingerprint: hash("5"),
      },
      profile: {
        id: "build123d-closed-subset-v1",
        version: "1.0.0",
        fingerprint: hash("6"),
      },
    },
    execution: {
      profile: { ...BUILD123D_EXECUTION_PROFILE, fingerprint: hash("7") },
      isolationPolicy: {
        id: "isolation.build123d-closed-v1",
        version: "1.0.0",
        fingerprint: hash("8"),
      },
      runtimeBackend: {
        ...MICROSANDBOX_LOCAL_RUNTIME_REF,
        imageReference,
        imageDigest: runtime.imageDigest,
      },
      runtime: {
        isolationClass: runtime.isolationClass,
        imageDigest: runtime.imageDigest,
        limits: runtime.requestedLimits,
        limitAssurance: runtime.limitAssurance,
      },
      outputValidator: { id: "occt-step-ap214", version: "1.0.0" },
      output: BUILD123D_EXECUTION_OUTPUT,
      minimumDestructionAssurance: "proven",
    },
    status: "ready-for-execution-review",
  });
  const profileBody = {
    schemaVersion: BUILD123D_EXECUTION_PROFILE_SCHEMA,
    executionProfile: BUILD123D_EXECUTION_PROFILE,
    compilationTarget: "build123d-source" as const,
    compilationProfile: {
      id: "build123d-closed-subset-v1",
      version: "1.0.0",
      target: "build123d-source" as const,
      sourceRole: "cad-script" as const,
      language: "python" as const,
      analyzer: { id: "build123d-qualified-lezer", version: "1.1.0" },
      analysisPolicyProfile: "build123d-closed-subset-v1",
      requiredBindingSymbolKinds: ["artifact", "parameter"] as const,
    },
    compilationProfileFingerprint: await sha256Fingerprint({
      id: "build123d-closed-subset-v1",
      version: "1.0.0",
      target: "build123d-source",
      sourceRole: "cad-script",
      language: "python",
      analyzer: { id: "build123d-qualified-lezer", version: "1.1.0" },
      analysisPolicyProfile: "build123d-closed-subset-v1",
      requiredBindingSymbolKinds: ["artifact", "parameter"],
    }),
    isolationPolicy: admission.execution.isolationPolicy,
    runtimeBackend: admission.execution.runtimeBackend,
    runtime: {
      isolationClass: admission.execution.runtime.isolationClass,
      imageDigest: admission.execution.runtime.imageDigest,
      requestedLimits: admission.execution.runtime.limits,
      limitAssurance: admission.execution.runtime.limitAssurance,
    },
    outputManifest: [BUILD123D_EXECUTION_OUTPUT],
    outputValidator: admission.execution.outputValidator,
    maximumSourceBytes: 262_144,
    minimumDestructionAssurance: "proven" as const,
  };
  const profile: Build123dExecutionProfile = {
    ...profileBody,
    profileFingerprint: await sha256Fingerprint(profileBody),
  };
  admission = validateBuild123dExecutionAdmission({
    ...admission,
    execution: {
      ...admission.execution,
      profile: {
        ...admission.execution.profile,
        fingerprint: profile.profileFingerprint,
      },
    },
  });
  const projectId = "project.box";
  const agentRunId = "agent-run.execute.box";
  const executionRunId = await deriveBuild123dExecutionRunId(projectId, agentRunId);
  const decisionFingerprint = hash("c");
  const identity: Build123dExecutionAttemptIdentity = {
    projectId,
    agentRunId,
    executionRunId,
    basis: {
      kind: "thread-snapshot",
      snapshotId: "snapshot.8",
      revision: 8,
      subjectId: "subject.box",
      fingerprint: hash("d"),
    },
    run: {
      workItemId: "work.execute.box",
      inputFingerprint: hash("e"),
      startedAt: AT,
    },
    decision: { id: "decision.execute.box", inputFingerprint: decisionFingerprint },
    approval: {
      id: "approval.execute.box",
      inputFingerprint: decisionFingerprint,
      fingerprint: hash("f"),
    },
    admission,
    technicalAdmission: {
      trustedRunId: "run.compile.box",
      decisionId: "decision.compile.box",
      sealedAt: "2026-08-13T09:00:00.000Z",
      draftReference: {
        schemaVersion: "technical-compilation-draft-reference/1.0",
        draftId:
          `technical-compilation:${projectId}:${admission.compilation.document.fingerprint.digest}`,
        projectId,
        documentFingerprint: admission.compilation.document.fingerprint,
        envelopeFingerprint: hash("a"),
      },
      documentFingerprint: admission.compilation.document.fingerprint,
      projectionFingerprint: admission.compilation.projection.fingerprint,
      sourceFingerprint: admission.compilation.source.sourceFingerprint,
    },
    executionProfile: profile,
    isolatedRequest: {
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId: executionRunId,
      producerGeneration: 0,
      profile: profile.executionProfile,
      sourceSha256,
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    },
    document: admission.compilation.document,
    projection: admission.compilation.projection,
    source: admission.compilation.source,
    profile: admission.execution.profile,
    output: admission.execution.output,
  };
  const observedAttemptFingerprint = await fingerprintBuild123dExecutionAttemptIdentity(
    identity,
  );
  assertEquals(observedAttemptFingerprint.algorithm, "sha256");
  const step = new TextEncoder().encode("STEP");
  const stepSha256 = await fingerprintResourceBytes(step);
  const publicationMember = {
    ...BUILD123D_EXECUTION_OUTPUT,
    byteCount: step.byteLength,
    sha256: stepSha256,
    casUri: `casys://isolated-output/sha256/${stepSha256}`,
  };
  const outputRecord = {
    ...publicationMember,
    validation: "accepted" as const,
    persistence: "staged-reread-atomic-commit" as const,
  };
  const receiptRecordForGeneration = async (producerGeneration: 0 | 1) => {
    const request = await validateIsolatedCodeExecutionRequest({
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId: executionRunId,
      producerGeneration,
      profile: profile.executionProfile,
      source: { bytes: source, sha256: sourceSha256 },
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    });
    const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
      executionRunId,
      producerGeneration,
      [publicationMember],
    );
    return isolatedCodeExecutionReceiptRecord(
      await createIsolatedCodeExecutionReceipt({
        request,
        runtime: profile.runtime,
        termination: { kind: "exited", exitCode: 0, signal: null },
        logs: {
          stdout: { bytes: new Uint8Array(), truncated: false },
          stderr: { bytes: new Uint8Array(), truncated: false },
        },
        outputs: [{ ...outputRecord, bytes: step }],
        destruction: {
          status: "proven",
          runId: executionRunId,
          proofFingerprint: hash(producerGeneration === 0 ? "b" : "c"),
        },
        publication: await createIsolatedOutputPublicationRef(
          executionRunId,
          producerGeneration,
          publicationFingerprint,
        ),
      }),
    );
  };
  const receiptRecordG0 = await receiptRecordForGeneration(0);
  const receiptRecordG1 = await receiptRecordForGeneration(1);
  const draftReferenceForReceipt = async (
    receiptRecord: typeof receiptRecordG0,
  ) =>
    await buildBuild123dExecutionDraftReference(
      await createBuild123dExecutionDraft({
        projectId,
        basis: identity.basis,
        agentRunId,
        executionRunId,
        decisionId: identity.decision.id,
        executedAt: AT,
        admission,
        receiptRecord,
      }),
    );
  const draftReferenceG0 = await draftReferenceForReceipt(receiptRecordG0);
  const draftReferenceG1 = await draftReferenceForReceipt(receiptRecordG1);
  return {
    identity,
    receiptRecord: receiptRecordG0,
    receiptRecordG0,
    receiptRecordG1,
    draftReference: draftReferenceG0,
    draftReferenceG0,
    draftReferenceG1,
  };
}

async function withStore(
  body: (
    store: FileBuild123dExecutionAttemptStore,
    directory: string,
  ) => Promise<void>,
) {
  const directory = await Deno.makeTempDir({ prefix: "build123d-wal-" });
  try {
    await body(new FileBuild123dExecutionAttemptStore(directory), directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

function limits() {
  return {
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 20_000,
    maxMemoryBytes: 1_073_741_824,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 33_554_432,
    maxOutputTotalBytes: 33_554_432,
  };
}

function hash(digit: string) {
  return { algorithm: "sha256" as const, digest: digit.repeat(64) };
}

function attemptKey(
  identity: Build123dExecutionAttemptIdentity,
  attemptFingerprint: Awaited<
    ReturnType<typeof fingerprintBuild123dExecutionAttemptIdentity>
  >,
) {
  return {
    projectId: identity.projectId,
    agentRunId: identity.agentRunId,
    executionRunId: identity.executionRunId,
    attemptFingerprint,
  };
}

function recoveryProof(runId: string) {
  return {
    status: "proven" as const,
    runId,
    proofFingerprint: hash("a"),
  };
}
