import { assertEquals, assertRejects } from "@std/assert";
import { ChronoPrescribedKinematicsCaseLowerer } from "../../adapters/mechanics/chrono/chrono-prescribed-kinematics-case-lowerer.ts";
import { FileCapabilityRuntimeQualificationAttemptStore } from "../../adapters/control-plane/file-capability-runtime-qualification-attempt-store.ts";
import { FileCapabilityRuntimeQualificationAttestationStore } from "../../adapters/control-plane/file-capability-runtime-qualification-attestation-store.ts";
import {
  capabilityRuntimeQualificationStoppedOutcomeId,
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  createCapabilityRuntimeQualificationSpecification,
} from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
  createFirstPartyCapabilityRuntimeQualificationCandidates,
} from "../../adapters/control-plane/first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "../../adapters/control-plane/first-party-capability-runtime-qualification-specifications.ts";
import {
  chronoArm64EmulationQualificationLinkOrientationWxyz,
  chronoArm64EmulationQualificationPrescribedAngleRad,
} from "./capability-runtime-qualification-criteria.ts";
import {
  type PrescribedKinematicsCaseSource,
  prescribedKinematicsRequiredSampleTimes,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroups } from "../../adapters/control-plane/first-party-capability-runtime-launch-groups.ts";
import {
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
  InMemoryCapabilityRuntimeStateObserver,
} from "../../adapters/control-plane/in-memory-capability-runtime-supervisor.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import { createCapabilityRuntimeQualificationHostStopProof } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeSecretSnapshot,
} from "../ports/out/capability/capability-runtime-supervisor.ts";
import type {
  PrescribedKinematicsCaseSubmissionRequest,
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsObserver,
  PrescribedKinematicsRunRequest,
  PrescribedKinematicsSamplePageRequest,
} from "../ports/out/mechanics/prescribed-kinematics-observer.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "./capability-runtime-launch-group-registry.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "./capability-runtime-launch-group-supervisor.ts";
import {
  evaluateCapabilityRuntimeQualifications,
  loadProvenCapabilityRuntimeQualificationAttestations,
  matchesCapabilityRuntimeQualificationCandidate,
} from "./evaluate-capability-runtime-qualifications.ts";
import { createChronoRuntimeQualificationAttestation } from "./capability-runtime-qualification-attestation-factory.ts";
import {
  CapabilityRuntimeQualificationError,
  CapabilityRuntimeQualificationService,
} from "./capability-runtime-qualification-service.ts";
import type {
  CapabilityRuntimeAdminLock,
  CapabilityRuntimeAdminPolicy,
  CapabilityRuntimeHostObservation,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";

const HOST = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const HOST_B = { algorithm: "sha256" as const, digest: "b".repeat(64) };

Deno.test("qualification review binds the exact Chrono candidate and excludes secrets, leases and samples", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    assertEquals(review.kind, "qualify-apply");
    assertEquals(
      review.candidate.id,
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    assertEquals(review.binding.id, "chrono-prescribed-kinematics");
    assertEquals(review.contract.id, "chrono-prescribed-kinematics-adapter");
    assertEquals(review.unit.id, "casys.mcp-chrono");
    assertEquals(review.launchGroup.id, "casys-chrono");
    assertEquals(review.observedHost.platform, "linux/arm64");
    assertEquals(review.targetPlatform, "linux/amd64");
    assertEquals(review.mode, "emulated");
    assertEquals(/^chrono-qual-[a-f0-9]{64}$/.test(review.requestId), true);
    assertEquals(review.secretSlots[0]?.availability, "available");
    const encoded = JSON.stringify(review);
    assertEquals(review.secretSlots[0]?.slot, "chrono-mcp-bearer-token");
    assertEquals(encoded.includes("CASYS_CHRONO_MCP_BEARER_TOKEN"), false);
    assertEquals(encoded.includes("lease"), false);
    assertEquals(encoded.includes("container"), false);
    assertEquals(encoded.includes("samples"), false);
    assertEquals(encoded.includes("recordedAt"), false);
    const again = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    assertEquals(again.reviewFingerprint, review.reviewFingerprint);
    assertEquals(again.requestId, review.requestId);
  } finally {
    await runtime.close();
  }
});

Deno.test("qualification apply records one Chrono ABSTOL_RESIDUAL attestation and recover never redispatches", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => runtime.service.apply(review.candidate.id, review.reviewFingerprint, false),
      CapabilityRuntimeQualificationError,
      "--confirm",
    );
    await assertRejects(
      () =>
        runtime.service.apply(review.candidate.id, {
          algorithm: "sha256",
          digest: "f".repeat(64),
        }, true),
      CapabilityRuntimeQualificationError,
      "stale",
    );
    assertEquals(
      await runtime.attempts.read({
        candidateId: review.candidate.id,
        candidateFingerprint: review.candidate.fingerprint,
        observedHostFingerprint: review.observedHost.fingerprint,
        qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
      }),
      undefined,
    );

    const applied = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "qualified");
    assertEquals(applied.phase, "attested");
    assertEquals(runtime.observer.runs, 1);
    assertEquals(runtime.host.calls.map((call) => call.action), [
      "runtime-qualification-start",
      "runtime-stop",
    ]);
    assertEquals(
      runtime.host.calls[0]?.projectId,
      "system-capability-qualification",
    );
    const attestations = await runtime.attestations.list();
    assertEquals(attestations.length, 1);
    assertEquals(
      matchesCapabilityRuntimeQualificationCandidate(
        attestations[0]!,
        runtime.candidate,
        review.observedHost,
        runtime.specs[0],
      ),
      true,
    );
    const attempt = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    if (attempt?.phase !== "attested") throw new Error("attested WAL absent");
    const effective = evaluateCapabilityRuntimeQualifications({
      catalog: runtime.catalog,
      host: runtime.hostObservation,
      attestations,
      specs: runtime.specs,
      candidates: [runtime.candidate],
      provenAttestations: await loadProvenCapabilityRuntimeQualificationAttestations({
        attempts: runtime.attempts,
        attestations,
        candidates: [runtime.candidate],
        specs: runtime.specs,
        host: runtime.hostObservation,
      }),
    });
    const chrono = effective.bindings.find((binding) =>
      binding.id === "chrono-prescribed-kinematics"
    );
    assertEquals(chrono?.qualification, "qualified");
    assertEquals(chrono?.runtimeModes[0]?.mode, "emulated");

    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.attestationFingerprint, applied.attestationFingerprint);
    assertEquals(runtime.observer.runs, 1);
    assertEquals((await runtime.attestations.list()).length, 1);

    const nextReview = await runtime.service.review(review.candidate.id);
    const second = await runtime.service.apply(
      nextReview.candidate.id,
      nextReview.reviewFingerprint,
      true,
    );
    assertEquals(second.attestationFingerprint, applied.attestationFingerprint);
    assertEquals(runtime.observer.runs, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("a stale review or H1 guard failure leaves no prepared WAL", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () =>
        runtime.service.apply(review.candidate.id, {
          algorithm: "sha256",
          digest: "f".repeat(64),
        }, true),
      CapabilityRuntimeQualificationError,
      "stale",
    );
    assertEquals(
      await runtime.attempts.read({
        candidateId: review.candidate.id,
        candidateFingerprint: review.candidate.fingerprint,
        observedHostFingerprint: review.observedHost.fingerprint,
        qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
      }),
      undefined,
    );
  } finally {
    await runtime.close();
  }

  let policyReads = 0;
  const drifted = await fixture({
    policyRead: () => {
      policyReads += 1;
      return {
        schemaVersion: "capability-runtime-admin-policy/1.0",
        disabledBindingIds: policyReads >= 3 ? ["chrono-prescribed-kinematics"] : [],
        preferences: [],
      };
    },
  });
  try {
    const review = await drifted.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => drifted.service.apply(review.candidate.id, review.reviewFingerprint, true),
      CapabilityRuntimeQualificationError,
      "administratively disabled",
    );
    assertEquals(
      await drifted.attempts.read({
        candidateId: review.candidate.id,
        candidateFingerprint: review.candidate.fingerprint,
        observedHostFingerprint: review.observedHost.fingerprint,
        qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
      }),
      undefined,
    );
    assertEquals(drifted.host.calls, []);
  } finally {
    await drifted.close();
  }
});

Deno.test("two concurrent applies publish one start, one dispatch and one attestation", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const [first, second] = await Promise.all([
      runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
      runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
    ]);
    assertEquals(first.status, "qualified");
    assertEquals(second.status, "qualified");
    assertEquals(first.attestationFingerprint, second.attestationFingerprint);
    assertEquals(runtime.observer.runs, 1);
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-qualification-start")
        .length,
      1,
    );
    assertEquals((await runtime.attestations.list()).length, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("crash after start before markActive reuses the start proof without a second Docker start", async () => {
  const runtime = await fixture({ crashMarkActive: 1 });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
      Error,
      "crash-before-mark-active",
    );
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-qualification-start")
        .length,
      1,
    );
    const prepared = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(prepared?.phase, "prepared");
    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.phase, "attested");
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-qualification-start")
        .length,
      1,
    );
    assertEquals(runtime.observer.runs, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("recover from prepared does not claim dispatch, and recover after claim never calls run", async () => {
  const preparedRuntime = await fixture({ hostFail: "runtime-qualification-start" });
  try {
    const review = await preparedRuntime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () =>
        preparedRuntime.service.apply(
          review.candidate.id,
          review.reviewFingerprint,
          true,
        ),
      Error,
    );
    const recovered = await preparedRuntime.service.recover(review.candidate.id);
    assertEquals(recovered.phase, "prepared");
    assertEquals(preparedRuntime.observer.runs, 0);
    assertEquals(recovered.attestationFingerprint, null);
  } finally {
    await preparedRuntime.close();
  }

  const runtime = await fixture({
    run: "uncertain",
    readRun: "uncertain",
  });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const first = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(first.phase, "quarantined");
    assertEquals(first.status, "unavailable");
    assertEquals(runtime.observer.runs, 1);
    runtime.observer.readRunState = "recorded";
    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.phase, "attested");
    assertEquals(runtime.observer.runs, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("a transient reread of a recorded receipt does not seal a failed outcome", async () => {
  const runtime = await fixture({ receiptReread: "fail-after-record" });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const first = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(first.phase, "recorded");
    runtime.observer.receiptReread = "complete";
    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.phase, "attested");
  } finally {
    await runtime.close();
  }
});

Deno.test("crash after attestation append is idempotent and never creates a second event", async () => {
  const runtime = await fixture({ crashMarkAttested: 1 });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
      Error,
      "crash-before-mark-attested",
    );
    assertEquals((await runtime.attestations.list()).length, 1);
    const stopped = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(stopped?.phase, "stopped");
    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.phase, "attested");
    assertEquals((await runtime.attestations.list()).length, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("qualification fails closed on missing secret, host drift, disabled policy and unknown candidate", async () => {
  const missingSecret = await fixture({ secret: "unavailable" });
  try {
    await assertRejects(
      () =>
        missingSecret.service.review(CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID),
      CapabilityRuntimeQualificationError,
      "bearer credential is missing",
    );
  } finally {
    await missingSecret.close();
  }

  const drifted = await fixture({ platform: "linux/amd64" });
  try {
    await assertRejects(
      () => drifted.service.review(CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID),
      CapabilityRuntimeQualificationError,
      "linux/arm64",
    );
  } finally {
    await drifted.close();
  }

  const disabled = await fixture({
    disabledBindingIds: ["chrono-prescribed-kinematics"],
  });
  try {
    await assertRejects(
      () => disabled.service.review(CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID),
      CapabilityRuntimeQualificationError,
      "administratively disabled",
    );
  } finally {
    await disabled.close();
  }

  const runtime = await fixture();
  try {
    await assertRejects(
      () => runtime.service.review("other-candidate"),
      CapabilityRuntimeQualificationError,
      "chrono-arm64-emulation-v1",
    );
    await assertRejects(
      () => runtime.service.recover(CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID),
      CapabilityRuntimeQualificationError,
      "existing WAL attempt",
    );
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await runtime.service.apply(review.candidate.id, review.reviewFingerprint, true);
    runtime.hostIdentity.digest = HOST_B.digest;
    await assertRejects(
      () => runtime.service.recover(review.candidate.id),
      CapabilityRuntimeQualificationError,
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("qualification records failed outcome for NOT_CONVERGED and does not attest", async () => {
  const runtime = await fixture({ exit: "not-converged" });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "failed");
    assertEquals(applied.phase, "stopped");
    assertEquals(applied.attestationFingerprint, null);
    assertEquals(await runtime.attestations.list(), []);
  } finally {
    await runtime.close();
  }
});

Deno.test("provider SUCCESS without the prescribed ramp does not qualify", async () => {
  const runtime = await fixture({ motion: "still" });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "failed");
    assertEquals(applied.attestationFingerprint, null);
  } finally {
    await runtime.close();
  }
});

Deno.test("qualification quarantines incomplete receipt pagination without attesting", async () => {
  const runtime = await fixture({ pages: "incomplete" });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "unavailable");
    assertEquals(applied.attestationFingerprint, null);
    assertEquals(await runtime.attestations.list(), []);
  } finally {
    await runtime.close();
  }
});

Deno.test("raw Chrono SUCCESS is not qualification; RELTOL_UPDATE completes", async () => {
  const rejected = await fixture({ exit: "success-raw" });
  try {
    const review = await rejected.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await rejected.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "failed");
    assertEquals(applied.attestationFingerprint, null);
  } finally {
    await rejected.close();
  }

  const accepted = await fixture({ exit: "reltol-update" });
  try {
    const review = await accepted.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await accepted.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "qualified");
    assertEquals(applied.phase, "attested");
  } finally {
    await accepted.close();
  }
});

Deno.test("lost secret before dispatch claim is pre-dispatch-unavailable with cleanup and no run", async () => {
  const runtime = await fixture({ loseSecretAfterStart: true });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "unavailable");
    assertEquals(applied.phase, "stopped");
    assertEquals(applied.outcome?.basis, "pre-dispatch");
    assertEquals(applied.outcome?.status, "unavailable");
    assertEquals(runtime.observer.runs, 0);
    assertEquals(runtime.host.calls.map((call) => call.action), [
      "runtime-qualification-start",
      "runtime-stop",
    ]);
  } finally {
    await runtime.close();
  }
});

Deno.test("lost secret after dispatch claim never redispatches", async () => {
  const runtime = await fixture({
    run: "uncertain",
    readRun: "uncertain",
    loseSecretAfterClaim: true,
  });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const first = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(first.phase, "quarantined");
    assertEquals(runtime.observer.runs, 1);
    runtime.loseSecret();
    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.phase, "quarantined");
    assertEquals(runtime.observer.runs, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("observer construction errors are not rewritten as a missing credential", async () => {
  const runtime = await fixture({
    observerCreateError: "observer-composition-failed",
  });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
      Error,
      "observer-composition-failed",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("one hundred recoveries before deadline stay open; after deadline one sealed unavailable", async () => {
  const runtime = await fixture({
    run: "uncertain",
    readRun: "absent",
  });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const first = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(first.phase, "quarantined");
    for (let index = 0; index < 100; index += 1) {
      const recovered = await runtime.service.recover(review.candidate.id);
      assertEquals(recovered.phase, "quarantined");
      assertEquals(recovered.outcome, null);
    }
    assertEquals(runtime.observer.runs, 1);
    runtime.advance(5 * 60 * 1000);
    const sealed = await runtime.service.recover(review.candidate.id);
    assertEquals(sealed.status, "unavailable");
    assertEquals(sealed.phase, "stopped");
    assertEquals(sealed.outcome?.basis, "quarantined");
    assertEquals(sealed.outcome?.recordedAt, runtime.now());
    assertEquals(runtime.observer.runs, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("a late receipt at deadline still records before the store seals unavailable", async () => {
  const runtime = await fixture({
    run: "uncertain",
    readRun: "absent",
  });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const first = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(first.phase, "quarantined");
    runtime.advance(5 * 60 * 1000);
    runtime.observer.readRunState = "recorded";
    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.phase, "attested");
    assertEquals(runtime.observer.runs, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("a late receipt before deadline terminalization still records", async () => {
  const runtime = await fixture({
    run: "uncertain",
    readRun: "absent",
  });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const first = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(first.phase, "quarantined");
    runtime.observer.readRunState = "recorded";
    const recovered = await runtime.service.recover(review.candidate.id);
    assertEquals(recovered.status, "qualified");
    assertEquals(recovered.phase, "attested");
    assertEquals(runtime.observer.runs, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("divergent same-axes attestation is refused and cardinality stays one", async () => {
  const runtime = await fixture({ crashAttestationAppend: 1 });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
      Error,
      "crash-before-attestation-append",
    );
    const stopped = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(stopped?.phase, "stopped");
    if (stopped?.phase !== "stopped") throw new Error("stopped WAL absent");
    const expected = await createChronoRuntimeQualificationAttestation({
      attempt: stopped,
      candidate: runtime.candidate,
      spec: runtime.specs[0]!,
    });
    const { fingerprint: _ignored, ...body } = expected;
    const divergentBody = {
      ...body,
      outcome: {
        id: "divergent-qualification-outcome",
        fingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
      },
    };
    const divergent = await createCapabilityRuntimeBindingQualificationAttestation({
      ...divergentBody,
      fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
        divergentBody,
      ),
    });
    await runtime.attestations.append(divergent);
    assertEquals((await runtime.attestations.list()).length, 1);
    await assertRejects(
      () => runtime.service.recover(review.candidate.id),
      CapabilityRuntimeQualificationError,
      "divergent attestation",
    );
    const events = await runtime.attestations.list();
    assertEquals(events.length, 1);
    assertEquals(events[0]?.fingerprint, divergent.fingerprint);
    assertEquals(
      events[0]?.fingerprint.digest === expected.fingerprint.digest,
      false,
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("recover refuses an exact revocation even when a qualified WAL exists", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "qualified");
    const [qualified] = await runtime.attestations.list();
    const { fingerprint: _ignored, ...body } = qualified!;
    const revokedBody = {
      ...body,
      state: "revoked" as const,
      recordedAt: "2026-08-29T00:00:01.000Z",
    };
    await runtime.attestations.append(
      await createCapabilityRuntimeBindingQualificationAttestation({
        ...revokedBody,
        fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
          revokedBody,
        ),
      }),
    );
    await assertRejects(
      () => runtime.service.recover(review.candidate.id),
      CapabilityRuntimeQualificationError,
      "revocation is recorded",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("apply does not qualify from a self-consistent outcome without the exact stopped WAL", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const outcome = {
      algorithm: "sha256" as const,
      digest: "d".repeat(64),
    };
    const body = {
      schemaVersion:
        "capability-runtime-binding-qualification-attestation/1.1" as const,
      state: "qualified" as const,
      recordedAt: "2026-08-29T00:00:00.000Z",
      binding: review.binding,
      selector: review.selector,
      contract: review.contract,
      profile: review.profile,
      unit: review.unit,
      material: review.material,
      targetPlatform: review.targetPlatform,
      mode: review.mode,
      launchGroup: review.launchGroup,
      observedHost: review.observedHost,
      fixture: review.fixture,
      qualificationSpec: {
        id: review.qualificationSpec.id,
        fingerprint: review.qualificationSpec.fingerprint,
      },
      outcome: {
        id: capabilityRuntimeQualificationStoppedOutcomeId(outcome),
        fingerprint: outcome,
      },
    };
    await runtime.attestations.append(
      await createCapabilityRuntimeBindingQualificationAttestation({
        ...body,
        fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
          body,
        ),
      }),
    );
    const confirmed = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () =>
        runtime.service.apply(
          confirmed.candidate.id,
          confirmed.reviewFingerprint,
          true,
        ),
      CapabilityRuntimeQualificationError,
      "divergent attestation",
    );
    assertEquals(runtime.observer.runs > 0, true);
    const wal = await runtime.attempts.read({
      candidateId: confirmed.candidate.id,
      candidateFingerprint: confirmed.candidate.fingerprint,
      observedHostFingerprint: confirmed.observedHost.fingerprint,
      qualificationSpecFingerprint: confirmed.qualificationSpec.fingerprint,
    });
    assertEquals(wal?.phase === "attested", false);
  } finally {
    await runtime.close();
  }
});

Deno.test("specification S1 stays isolated and S2 is a distinct WAL that S1 cannot satisfy", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applied = await runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    assertEquals(applied.status, "qualified");
    const s1Key = {
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    };
    const s1 = await runtime.attempts.read(s1Key);
    if (s1?.phase !== "attested") throw new Error("S1 attested WAL absent");
    const s1Spec = runtime.specs[0]!;
    const s2Spec = await createCapabilityRuntimeQualificationSpecification({
      schemaVersion: "capability-runtime-qualification-specification/1.0",
      id: s1Spec.id,
      version: s1Spec.version,
      candidate: s1Spec.candidate,
      sourceFingerprint: s1Spec.sourceFingerprint,
      loweringFingerprint: s1Spec.loweringFingerprint,
      caseFingerprint: s1Spec.caseFingerprint,
      protocolFingerprint: s1Spec.protocolFingerprint,
      criteriaFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
    });
    assertEquals(
      s2Spec.fingerprint.digest === s1Spec.fingerprint.digest,
      false,
    );
    const s2Key = {
      ...s1Key,
      qualificationSpecFingerprint: s2Spec.fingerprint,
    };
    assertEquals(await runtime.attempts.read(s2Key), undefined);
    const attestations = await runtime.attestations.list();
    const s1OnS2 = evaluateCapabilityRuntimeQualifications({
      catalog: runtime.catalog,
      host: runtime.hostObservation,
      attestations,
      specs: [s2Spec],
      candidates: [runtime.candidate],
      provenAttestations: await loadProvenCapabilityRuntimeQualificationAttestations({
        attempts: runtime.attempts,
        attestations,
        candidates: [runtime.candidate],
        specs: [s2Spec],
        host: runtime.hostObservation,
      }),
    });
    assertEquals(
      s1OnS2.bindings.find((item) => item.id === "chrono-prescribed-kinematics")
        ?.qualification,
      "unqualified",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("a foreign canonical stop proof never attests on first apply or recovery", async () => {
  const runtime = await fixture();
  try {
    const originalRelease = runtime.groups.releaseQualificationTerminal.bind(
      runtime.groups,
    );
    runtime.groups.releaseQualificationTerminal = async (input) => {
      const proof = await originalRelease(input);
      const { fingerprint: _ignored, ...body } = proof;
      return await createCapabilityRuntimeQualificationHostStopProof({
        ...body,
        journalEntry: { ...proof.journalEntry, projectId: "foreign-owner" },
      });
    };
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
      Error,
      "reserved qualification owner",
    );
    const wal = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(wal?.phase === "attested", false);
    assertEquals((await runtime.attestations.list()).length, 0);
    await assertRejects(
      () => runtime.service.recover(review.candidate.id),
      Error,
      "reserved qualification owner",
    );
    assertEquals((await runtime.attestations.list()).length, 0);
    const recovered = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(recovered?.phase === "attested", false);
  } finally {
    await runtime.close();
  }
});

Deno.test("S1 revocation blocks S2 on the same candidate and host", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await runtime.service.apply(review.candidate.id, review.reviewFingerprint, true);
    const [qualified] = await runtime.attestations.list();
    const { fingerprint: _ignored, ...body } = qualified!;
    await runtime.attestations.append(
      await createCapabilityRuntimeBindingQualificationAttestation({
        ...body,
        state: "revoked",
        recordedAt: "2026-08-29T00:00:01.000Z",
        fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation({
          ...body,
          state: "revoked",
          recordedAt: "2026-08-29T00:00:01.000Z",
        }),
      }),
    );
    await assertRejects(
      () => runtime.service.recover(review.candidate.id),
      CapabilityRuntimeQualificationError,
      "revocation is recorded",
    );
    const s1Spec = runtime.specs[0]!;
    const s2Spec = await createCapabilityRuntimeQualificationSpecification({
      schemaVersion: "capability-runtime-qualification-specification/1.0",
      id: s1Spec.id,
      version: s1Spec.version,
      candidate: s1Spec.candidate,
      sourceFingerprint: s1Spec.sourceFingerprint,
      loweringFingerprint: s1Spec.loweringFingerprint,
      caseFingerprint: s1Spec.caseFingerprint,
      protocolFingerprint: s1Spec.protocolFingerprint,
      criteriaFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
    });
    const attestations = await runtime.attestations.list();
    const effective = evaluateCapabilityRuntimeQualifications({
      catalog: runtime.catalog,
      host: runtime.hostObservation,
      attestations,
      specs: [s2Spec],
      candidates: [runtime.candidate],
      provenAttestations: [],
    });
    assertEquals(
      effective.bindings.find((item) => item.id === "chrono-prescribed-kinematics")
        ?.qualification,
      "revoked",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("revocation after start still stops and never attests", async () => {
  const runtime = await fixture({ crashMarkActive: 0, crashAfterMarkActive: 1 });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    await assertRejects(
      () => runtime.service.apply(review.candidate.id, review.reviewFingerprint, true),
      Error,
      "crash-after-mark-active",
    );
    const active = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(active?.phase, "active");
    const body = {
      schemaVersion:
        "capability-runtime-binding-qualification-attestation/1.1" as const,
      state: "revoked" as const,
      recordedAt: "2026-08-29T00:00:01.000Z",
      binding: review.binding,
      selector: review.selector,
      contract: review.contract,
      profile: review.profile,
      unit: review.unit,
      material: review.material,
      targetPlatform: review.targetPlatform,
      mode: review.mode,
      launchGroup: review.launchGroup,
      observedHost: review.observedHost,
      fixture: review.fixture,
      qualificationSpec: {
        id: review.qualificationSpec.id,
        fingerprint: review.qualificationSpec.fingerprint,
      },
      outcome: {
        id: "capability-runtime-qualification-stopped-" + "d".repeat(64),
        fingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
      },
    };
    await runtime.attestations.append(
      await createCapabilityRuntimeBindingQualificationAttestation({
        ...body,
        fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
          body,
        ),
      }),
    );
    await assertRejects(
      () => runtime.service.recover(review.candidate.id),
      CapabilityRuntimeQualificationError,
      "revocation is recorded",
    );
    assertEquals(
      (await runtime.attestations.list()).filter((event) => event.state === "qualified")
        .length,
      0,
    );
    const wal = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(wal?.phase === "attested", false);
    assertEquals(await runtime.leases.listActive(runtime.now()), []);
    const observed = await runtime.states.observe([runtime.candidate.material]);
    assertEquals(
      observed.get(capabilityRuntimeMaterialKey(runtime.candidate.material))?.runtime,
      "inactive",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("revocation during dispatch wins the durable attestation order", async () => {
  let resume = () => {};
  const pauseRun = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let enteredRun = () => {};
  const entered = new Promise<void>((resolve) => {
    enteredRun = resolve;
  });
  const runtime = await fixture({ pauseRun, onRun: enteredRun });
  try {
    const review = await runtime.service.review(
      CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
    );
    const applying = runtime.service.apply(
      review.candidate.id,
      review.reviewFingerprint,
      true,
    );
    await entered;
    const body = {
      schemaVersion:
        "capability-runtime-binding-qualification-attestation/1.1" as const,
      state: "revoked" as const,
      recordedAt: "2026-08-29T00:00:01.000Z",
      binding: review.binding,
      selector: review.selector,
      contract: review.contract,
      profile: review.profile,
      unit: review.unit,
      material: review.material,
      targetPlatform: review.targetPlatform,
      mode: review.mode,
      launchGroup: review.launchGroup,
      observedHost: review.observedHost,
      fixture: review.fixture,
      qualificationSpec: {
        id: review.qualificationSpec.id,
        fingerprint: review.qualificationSpec.fingerprint,
      },
      outcome: {
        id: capabilityRuntimeQualificationStoppedOutcomeId({
          algorithm: "sha256",
          digest: "d".repeat(64),
        }),
        fingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
      },
    };
    await runtime.attestations.append(
      await createCapabilityRuntimeBindingQualificationAttestation({
        ...body,
        fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
          body,
        ),
      }),
    );
    resume();
    await assertRejects(
      () => applying,
      CapabilityRuntimeQualificationError,
      "revocation is recorded",
    );
    assertEquals(
      (await runtime.attestations.list()).filter((event) => event.state === "qualified")
        .length,
      0,
    );
    const wal = await runtime.attempts.read({
      candidateId: review.candidate.id,
      candidateFingerprint: review.candidate.fingerprint,
      observedHostFingerprint: review.observedHost.fingerprint,
      qualificationSpecFingerprint: review.qualificationSpec.fingerprint,
    });
    assertEquals(wal?.phase, "stopped");
    assertEquals(await runtime.leases.listActive(runtime.now()), []);
    const observed = await runtime.states.observe([runtime.candidate.material]);
    assertEquals(
      observed.get(capabilityRuntimeMaterialKey(runtime.candidate.material))?.runtime,
      "inactive",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("qualification modules stay off MCP, Workbench and project command surfaces", async () => {
  const files = [
    "src/application/control-plane/capability-runtime-qualification-service.ts",
    "src/adapters/control-plane/local-capability-runtime-qualification-composition.ts",
    "scripts/runners/capability-runtime-qualification.ts",
  ];
  for (const path of files) {
    const text = await Deno.readTextFile(path);
    assertEquals(text.includes("src/tools/"), false, path);
    assertEquals(text.includes("orchestration/operations"), false, path);
    assertEquals(text.includes("project-capability-workbench"), false, path);
  }
});

async function fixture(options: {
  readonly secret?: "available" | "unavailable";
  readonly platform?: "linux/arm64" | "linux/amd64";
  readonly disabledBindingIds?: readonly string[];
  readonly run?: "recorded" | "uncertain";
  readonly readRun?: "recorded" | "uncertain" | "absent";
  readonly receiptReread?: "complete" | "fail-after-record";
  readonly exit?:
    | "success"
    | "not-converged"
    | "success-raw"
    | "reltol-update"
    | "abstol-update";
  readonly pages?: "complete" | "incomplete";
  readonly motion?: "ramp" | "still";
  readonly hostFail?: CapabilityRuntimeJournalEntry["action"];
  readonly crashMarkActive?: number;
  readonly crashAfterMarkActive?: number;
  readonly crashMarkOutcome?: number;
  readonly crashMarkAttested?: number;
  readonly crashAttestationAppend?: number;
  readonly loseSecretAfterStart?: boolean;
  readonly loseSecretAfterClaim?: boolean;
  readonly observerCreateError?: string;
  readonly policyRead?: () => CapabilityRuntimeAdminPolicy;
  readonly pauseRun?: Promise<void>;
  readonly onRun?: () => void;
} = {}) {
  const directory = await Deno.makeTempDir({
    prefix: "casys-runtime-qualification-",
  });
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const candidates = await createFirstPartyCapabilityRuntimeQualificationCandidates();
  const specs = await createFirstPartyCapabilityRuntimeQualificationSpecifications();
  const candidate = candidates[0]!;
  const groups = (await createFirstPartyCapabilityRuntimeLaunchGroups()).filter(
    (group) => group.id === "casys-chrono",
  );
  const states = new InMemoryCapabilityRuntimeStateObserver();
  states.set(candidate.material, { material: "installed", runtime: "inactive" });
  const journal = new InMemoryCapabilityRuntimeJournal();
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const host = new QualificationHost(states, options.hostFail);
  const registry = new FixedCapabilityRuntimeLaunchGroupRegistry(groups);
  let secretAvailability: "available" | "unavailable" = options.secret ??
    "available";
  const observeSecrets = (
    slots: readonly string[],
  ) =>
    Promise.resolve(
      new Map(slots.map((slot) => [slot, secretAvailability])),
    );
  const supervisor = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: registry,
    journal,
    leases,
    states,
    host,
    secrets: { observe: observeSecrets },
    lock: serialLock(),
  });
  let nowMs = Date.parse("2026-08-29T00:00:00.000Z");
  const now = () => new Date(nowMs).toISOString();
  const innerAttempts = new FileCapabilityRuntimeQualificationAttemptStore(
    `${directory}/attempts`,
    { now },
  );
  let remainingActiveCrashes = options.crashMarkActive ?? 0;
  let remainingAfterActiveCrashes = options.crashAfterMarkActive ?? 0;
  let remainingOutcomeCrashes = options.crashMarkOutcome ?? 0;
  let remainingAttestCrashes = options.crashMarkAttested ?? 0;
  const attempts = new ProxyAttemptStore(innerAttempts, {
    beforeMarkActive: () => {
      if (remainingActiveCrashes > 0) {
        remainingActiveCrashes -= 1;
        throw new Error("crash-before-mark-active");
      }
    },
    afterMarkActive: () => {
      if (options.loseSecretAfterStart) secretAvailability = "unavailable";
      if (remainingAfterActiveCrashes > 0) {
        remainingAfterActiveCrashes -= 1;
        throw new Error("crash-after-mark-active");
      }
    },
    beforeMarkOutcome: () => {
      if (remainingOutcomeCrashes > 0) {
        remainingOutcomeCrashes -= 1;
        throw new Error("crash-before-mark-outcome");
      }
    },
    beforeMarkAttested: () => {
      if (remainingAttestCrashes > 0) {
        remainingAttestCrashes -= 1;
        throw new Error("crash-before-mark-attested");
      }
    },
    afterClaimDispatching: () => {
      if (options.loseSecretAfterClaim) secretAvailability = "unavailable";
    },
  });
  const innerAttestations = new FileCapabilityRuntimeQualificationAttestationStore(
    `${directory}/attestations`,
  );
  let remainingAttestationAppendCrashes = options.crashAttestationAppend ?? 0;
  const attestations = {
    list: () => innerAttestations.list(),
    read: (fingerprint: Parameters<typeof innerAttestations.read>[0]) =>
      innerAttestations.read(fingerprint),
    append: async (
      value: Parameters<typeof innerAttestations.append>[0],
    ) => {
      if (remainingAttestationAppendCrashes > 0) {
        remainingAttestationAppendCrashes -= 1;
        throw new Error("crash-before-attestation-append");
      }
      await innerAttestations.append(value);
    },
    appendQualifiedUnlessRevoked: async (
      value: Parameters<typeof innerAttestations.appendQualifiedUnlessRevoked>[0],
    ) => {
      if (remainingAttestationAppendCrashes > 0) {
        remainingAttestationAppendCrashes -= 1;
        throw new Error("crash-before-attestation-append");
      }
      return await innerAttestations.appendQualifiedUnlessRevoked(value);
    },
  };
  const observer = new QualificationObserver(candidate, {
    run: options.run ?? "recorded",
    readRun: options.readRun ?? "recorded",
    receiptReread: options.receiptReread ?? "complete",
    exit: options.exit ?? "success",
    pages: options.pages ?? "complete",
    motion: options.motion ?? "ramp",
    pauseRun: options.pauseRun,
    onRun: options.onRun,
  });
  const hostIdentity = {
    algorithm: "sha256" as const,
    digest: HOST.digest,
  };
  const hostObservation: CapabilityRuntimeHostObservation = {
    schemaVersion: "capability-runtime-host-observation/1.0",
    identityFingerprint: hostIdentity,
    platform: options.platform ?? "linux/arm64",
    images: [],
  };
  const policy: CapabilityRuntimeAdminPolicy = {
    schemaVersion: "capability-runtime-admin-policy/1.0",
    disabledBindingIds: options.disabledBindingIds ?? [],
    preferences: [],
  };
  const lock: CapabilityRuntimeAdminLock = {
    schemaVersion: "capability-runtime-admin-lock/1.0",
    revision: 0,
    previous: null,
    units: [],
  };
  const service = new CapabilityRuntimeQualificationService({
    catalog,
    candidates,
    specs,
    policy: {
      read: () => Promise.resolve(options.policyRead ? options.policyRead() : policy),
    },
    lock: { read: () => Promise.resolve(lock) },
    hostObservation: {
      read: () =>
        Promise.resolve({
          schemaVersion: "capability-runtime-host-observation/1.0",
          identityFingerprint: {
            algorithm: "sha256" as const,
            digest: hostIdentity.digest,
          },
          platform: options.platform ?? "linux/arm64",
          images: [],
        }),
    },
    attestations,
    attempts,
    launchGroups: registry,
    groups: supervisor,
    states,
    secrets: {
      observe: observeSecrets,
      beginSnapshot: () =>
        Promise.resolve(Object.freeze({}) as CapabilityRuntimeSecretSnapshot),
    },
    createObserver: () => {
      if (options.observerCreateError) {
        throw new Error(options.observerCreateError);
      }
      return observer;
    },
    lowerer: new ChronoPrescribedKinematicsCaseLowerer(),
    now,
  });
  return {
    service,
    observer,
    host,
    groups: supervisor,
    attempts,
    attestations,
    catalog,
    candidate,
    specs,
    hostObservation,
    hostIdentity,
    states,
    leases,
    now,
    advance: (ms: number) => {
      nowMs += ms;
    },
    loseSecret: () => {
      secretAvailability = "unavailable";
    },
    close: () => Deno.remove(directory, { recursive: true }),
  };
}

class ProxyAttemptStore implements CapabilityRuntimeQualificationAttemptStore {
  constructor(
    private readonly inner: CapabilityRuntimeQualificationAttemptStore,
    private readonly hooks: {
      readonly beforeMarkActive?: () => void;
      readonly afterMarkActive?: () => void;
      readonly beforeMarkOutcome?: () => void;
      readonly beforeMarkAttested?: () => void;
      readonly afterClaimDispatching?: () => void;
    },
  ) {}

  read(...args: Parameters<CapabilityRuntimeQualificationAttemptStore["read"]>) {
    return this.inner.read(...args);
  }
  prepare(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["prepare"]>
  ) {
    return this.inner.prepare(...args);
  }
  async markActive(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markActive"]>
  ) {
    this.hooks.beforeMarkActive?.();
    const attempt = await this.inner.markActive(...args);
    this.hooks.afterMarkActive?.();
    return attempt;
  }
  markCaseSubmitted(
    ...args: Parameters<
      CapabilityRuntimeQualificationAttemptStore["markCaseSubmitted"]
    >
  ) {
    return this.inner.markCaseSubmitted(...args);
  }
  async claimDispatching(
    ...args: Parameters<
      CapabilityRuntimeQualificationAttemptStore["claimDispatching"]
    >
  ) {
    const claimed = await this.inner.claimDispatching(...args);
    this.hooks.afterClaimDispatching?.();
    return claimed;
  }
  markRecorded(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markRecorded"]>
  ) {
    return this.inner.markRecorded(...args);
  }
  sealDispatchDeadline(
    ...args: Parameters<
      CapabilityRuntimeQualificationAttemptStore["sealDispatchDeadline"]
    >
  ) {
    return this.inner.sealDispatchDeadline(...args);
  }
  markQuarantined(
    ...args: Parameters<
      CapabilityRuntimeQualificationAttemptStore["markQuarantined"]
    >
  ) {
    return this.inner.markQuarantined(...args);
  }
  markOutcome(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markOutcome"]>
  ) {
    this.hooks.beforeMarkOutcome?.();
    return this.inner.markOutcome(...args);
  }
  markStopped(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markStopped"]>
  ) {
    return this.inner.markStopped(...args);
  }
  markAttested(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markAttested"]>
  ) {
    this.hooks.beforeMarkAttested?.();
    return this.inner.markAttested(...args);
  }
}

class QualificationObserver implements PrescribedKinematicsObserver {
  runs = 0;
  reads = 0;
  readRunState: "recorded" | "uncertain" | "absent";
  receiptReread: "complete" | "fail-after-record";
  #caseSha256 = "";
  #requestId = "";

  constructor(
    private readonly candidate: {
      readonly fixture: { readonly source: PrescribedKinematicsCaseSource };
    },
    private readonly options: {
      readonly run: "recorded" | "uncertain";
      readonly readRun: "recorded" | "uncertain" | "absent";
      readonly receiptReread: "complete" | "fail-after-record";
      readonly exit:
        | "success"
        | "not-converged"
        | "success-raw"
        | "reltol-update"
        | "abstol-update";
      readonly pages: "complete" | "incomplete";
      readonly motion: "ramp" | "still";
      readonly pauseRun?: Promise<void>;
      readonly onRun?: () => void;
    },
  ) {
    this.readRunState = options.readRun;
    this.receiptReread = options.receiptReread;
  }

  submitCase(request: PrescribedKinematicsCaseSubmissionRequest) {
    this.#caseSha256 = request.requestFingerprint.digest;
    return Promise.resolve({
      caseSha256: request.requestFingerprint.digest,
      caseUri: `chrono-case:sha256:${request.requestFingerprint.digest}`,
    });
  }

  async run(request: PrescribedKinematicsRunRequest) {
    this.options.onRun?.();
    if (this.options.pauseRun) await this.options.pauseRun;
    this.runs += 1;
    this.#requestId = request.requestId;
    if (this.options.run === "uncertain") {
      return {
        state: "uncertain" as const,
        requestId: request.requestId,
        caseSha256: request.caseSha256,
        caseUri: request.caseUri,
      };
    }
    return {
      state: "recorded" as const,
      record: this.#record(request, 0),
    };
  }

  readRun(
    request: Pick<
      PrescribedKinematicsRunRequest,
      "requestId" | "caseSha256" | "caseUri"
    >,
    page?: PrescribedKinematicsSamplePageRequest,
  ) {
    this.reads += 1;
    this.#requestId = request.requestId;
    if (this.readRunState === "uncertain") {
      return Promise.resolve({
        state: "uncertain" as const,
        requestId: request.requestId,
        caseSha256: request.caseSha256,
        caseUri: request.caseUri,
      });
    }
    if (this.readRunState === "absent") {
      return Promise.resolve({
        state: "absent" as const,
        requestId: request.requestId,
        caseSha256: request.caseSha256,
        caseUri: request.caseUri,
      });
    }
    return Promise.resolve({
      state: "recorded" as const,
      record: this.#record(request, page?.sampleOffset ?? 0),
    });
  }

  readReceipt(
    _receiptSha256: string,
    page?: PrescribedKinematicsSamplePageRequest,
  ) {
    this.reads += 1;
    if (this.receiptReread === "fail-after-record" && this.reads > 2) {
      return Promise.reject(new Error("transient receipt reread"));
    }
    return Promise.resolve(
      this.#record({
        requestId: this.#requestId,
        caseSha256: this.#caseSha256,
        caseUri: `chrono-case:sha256:${this.#caseSha256}`,
      }, page?.sampleOffset ?? 0),
    );
  }

  #record(
    request: {
      readonly requestId: string;
      readonly caseSha256: string;
      readonly caseUri: string;
    },
    offset: number,
  ): PrescribedKinematicsObservationRecord {
    const times = prescribedKinematicsRequiredSampleTimes(
      this.candidate.fixture.source,
    );
    const total = times.length;
    const returned = this.options.pages === "incomplete" && offset === 0
      ? 0
      : Math.min(64, total - offset);
    const samples = Array.from({ length: returned }, (_, index) => {
      const sampleIndex = offset + index;
      const angle = chronoArm64EmulationQualificationPrescribedAngleRad(sampleIndex);
      const moving = this.options.motion !== "still";
      return {
        timeSeconds: times[sampleIndex]!,
        bodies: [
          {
            bodyId: "base",
            positionMetres: [0, 0, 0] as const,
            rotationWxyz: [1, 0, 0, 0] as const,
          },
          {
            bodyId: "link",
            positionMetres: [0, 0, 1] as const,
            rotationWxyz: moving
              ? chronoArm64EmulationQualificationLinkOrientationWxyz(angle)
              : [1, 0, 0, 0] as const,
          },
        ],
        joints: [{
          jointId: "hinge",
          motorAngleRadians: angle,
          declaredLimitObservation: "within" as const,
          translationResidualMetres: [0, 0, 0] as const,
          rotationQuaternionImagResidual: [0, 0, 0] as const,
        }],
      };
    });
    const success = this.options.exit !== "not-converged";
    return {
      request,
      recordedAt: "2026-08-29T00:00:00.000Z",
      receipt: {
        receiptSha256: "c".repeat(64),
        caseSha256: request.caseSha256,
        outcomeSha256: "d".repeat(64),
        requestId: request.requestId,
        recordedAt: "2026-08-29T00:00:00.000Z",
        engine: { name: "Project Chrono", version: "10.0.0" },
        runtime: {
          binding: "pychrono",
          pythonVersion: "3.12.0",
          serverDenoVersion: "2.0.0",
        },
        workerSourceSha256: "e".repeat(64),
        executionState: success ? "completed" : "not-converged",
        kinematicsExit: kinematicsExit(this.options.exit),
      },
      notEvaluated: [
        "collision",
        "clearance",
        "contact",
        "forces",
        "torques",
        "dynamics",
        "strength",
        "safety",
        "product fitness",
      ],
      sampleCount: total,
      sampleTimeRangeSeconds: { first: 0, last: 1 },
      samplePage: {
        sampleOffset: offset,
        sampleLimit: 64,
        total,
        returned: samples.length,
        hasMore: offset + samples.length < total,
        samples,
      },
    };
  }
}

class QualificationHost {
  readonly calls: {
    readonly action: CapabilityRuntimeJournalEntry["action"];
    readonly projectId: string | null;
  }[] = [];

  constructor(
    private readonly states: InMemoryCapabilityRuntimeStateObserver,
    private readonly failAction?: CapabilityRuntimeJournalEntry["action"],
  ) {}

  async mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
    readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    await Promise.resolve();
    const entry = input.authorization.entry;
    this.calls.push({ action: entry.action, projectId: entry.projectId });
    if (this.failAction === entry.action) {
      throw new Error(`host-${entry.action}-failed`);
    }
    for (const material of entry.materials) {
      this.states.set(material, transitionState(entry.action));
    }
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: "2026-08-29T00:00:00.000Z",
      status: "succeeded",
      observations: entry.materials.map((material) => ({
        material,
        state: transitionState(entry.action),
      })),
      detail: null,
    };
  }
}

function kinematicsExit(
  exit:
    | "success"
    | "not-converged"
    | "success-raw"
    | "reltol-update"
    | "abstol-update",
): { readonly rawCode: number; readonly rawName: string } {
  switch (exit) {
    case "success-raw":
      return { rawCode: 1, rawName: "SUCCESS" };
    case "reltol-update":
      return { rawCode: 3, rawName: "RELTOL_UPDATE" };
    case "abstol-update":
      return { rawCode: 4, rawName: "ABSTOL_UPDATE" };
    case "not-converged":
      return { rawCode: 0, rawName: "NOT_CONVERGED" };
    default:
      return { rawCode: 2, rawName: "ABSTOL_RESIDUAL" };
  }
}

function serialLock() {
  let tail = Promise.resolve();
  return {
    withLock<T>(operation: () => Promise<T>): Promise<T> {
      const run = tail.then(operation, operation);
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

function transitionState(
  action: CapabilityRuntimeJournalEntry["action"],
): CapabilityRuntimeObservedState {
  switch (action) {
    case "material-acquire":
    case "runtime-stop":
      return { material: "installed", runtime: "inactive" };
    case "runtime-start":
    case "runtime-qualification-start":
      return { material: "installed", runtime: "active" };
    case "material-remove":
      return { material: "absent", runtime: "inactive" };
  }
}
