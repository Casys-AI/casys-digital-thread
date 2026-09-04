import { assertEquals, assertRejects } from "@std/assert";
import {
  FileCapabilityRuntimeQualificationAttestationStore,
} from "../../adapters/control-plane/file-capability-runtime-qualification-attestation-store.ts";
import { FileCapabilityRuntimeHostIdentityStore } from "../../adapters/control-plane/file-capability-runtime-host-identity-store.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  type CapabilityRuntimeBindingQualificationAttestation,
  capabilityRuntimeQualificationStoppedOutcomeId,
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeObservedHost,
  sameCapabilityRuntimeQualificationRevocationScope,
  validateCapabilityRuntimeBindingQualificationAttestation,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  activateQualificationAttempt,
  createCapabilityRuntimeQualificationAttemptOutcome,
  dispatchingQualificationAttempt,
  outcomeQualificationAttempt,
  prepareQualificationAttempt,
  recordQualificationAttempt,
  stopQualificationAttempt,
  submitQualificationAttemptCase,
} from "../../domain/capability/runtime/capability-runtime-qualification-attempt.ts";
import { createCapabilityRuntimeQualificationHostStopProof } from "../../domain/capability/runtime/capability-runtime-qualification-host-proof.ts";
import { createCapabilityRuntimeQualificationIsolatedDestructionProof } from "../../domain/capability/runtime/capability-runtime-qualification-stop-proof.ts";
import { CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeCatalog,
  CapabilityRuntimeHostObservation,
  QualifiedCapabilityRuntimeBinding,
} from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "../../adapters/control-plane/first-party-capability-runtime-qualification-candidates.ts";
import { createFirstPartyCapabilityRuntimeQualificationSpecifications } from "../../adapters/control-plane/first-party-capability-runtime-qualification-specifications.ts";
import { createCapabilityRuntimeQualificationSpecification } from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import {
  capabilityRuntimeQualificationStoppedOutcomeReference,
  createChronoRuntimeQualificationAttestation,
} from "./capability-runtime-qualification-attestation-factory.ts";
import {
  evaluateCapabilityRuntimeQualifications,
  loadProvenCapabilityRuntimeQualificationAttestations,
  matchesCapabilityRuntimeQualificationCandidate,
} from "./evaluate-capability-runtime-qualifications.ts";

const HOST_A = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const HOST_B = { algorithm: "sha256" as const, digest: "b".repeat(64) };
const FIXTURE = { algorithm: "sha256" as const, digest: "c".repeat(64) };
const OUTCOME = { algorithm: "sha256" as const, digest: "d".repeat(64) };
const SPEC = { algorithm: "sha256" as const, digest: "e".repeat(64) };

Deno.test("an exact Chrono emulation attestation qualifies only its binding and material", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);

  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [proven.event],
    specs: proven.specs,
    candidates: proven.candidates,
    provenAttestations: [proven.event],
  });

  const chronoBinding = binding(effective, "chrono-prescribed-kinematics");
  assertEquals(chronoBinding.qualification, "qualified");
  assertEquals(chronoBinding.runtimeModes, [{
    material: proven.event.material,
    targetPlatform: "linux/amd64",
    mode: "emulated",
    qualificationAttestationFingerprint: proven.event.fingerprint,
  }]);
  assertEquals(
    binding(effective, "calculix-http-static-sensitivity").qualification,
    "unqualified",
  );
  assertEquals(
    binding(effective, "calculix-http-static-sensitivity").runtimeModes,
    [],
  );
});

Deno.test("Chrono factory and evaluator reject an isolated destruction stop-proof", async () => {
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const isolatedProof =
    await createCapabilityRuntimeQualificationIsolatedDestructionProof({
      runId: "isolated-qualification-test-run",
      producerGeneration: 0,
      receiptFingerprint: null,
      destruction: {
        status: "proven",
        runId: "isolated-qualification-test-run",
        proofFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      },
    });
  const stopped = { ...proven.attempt, runtimeStopProof: isolatedProof };
  await assertRejects(
    () =>
      createChronoRuntimeQualificationAttestation({
        attempt: stopped,
        candidate: proven.candidate,
        spec: proven.spec,
      }),
    TypeError,
    "requires a host stop proof",
  );
  const attested = {
    ...stopped,
    phase: "attested" as const,
    attestationFingerprint: proven.event.fingerprint,
  };
  const loaded = await loadProvenCapabilityRuntimeQualificationAttestations({
    attempts: { read: () => Promise.resolve(attested) },
    attestations: [proven.event],
    candidates: proven.candidates,
    specs: proven.specs,
    host,
  });
  assertEquals(loaded, []);
});

Deno.test("candidate attestation matcher requires the exact fixture and every candidate axis", async () => {
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const candidate = proven.candidates[0]!;
  const observed = {
    identityFingerprint: host.identityFingerprint,
    platform: host.platform,
    fingerprint: await fingerprintCapabilityRuntimeObservedHost(
      host.platform,
      host.identityFingerprint,
    ),
  };
  assertEquals(
    matchesCapabilityRuntimeQualificationCandidate(
      proven.event,
      candidate,
      observed,
    ),
    true,
  );
  assertEquals(
    matchesCapabilityRuntimeQualificationCandidate(proven.event, {
      ...candidate,
      fixture: { ...candidate.fixture, id: "other-fixture" },
    }, observed),
    false,
  );
});

Deno.test("an attestation for a previous criteria or protocol spec no longer qualifies Chrono", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const stale = await reattest(proven.event, (event) => {
    event.qualificationSpec = { id: proven.spec.id, fingerprint: SPEC };
  });
  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [stale],
    specs: proven.specs,
    candidates: proven.candidates,
    provenAttestations: [proven.event],
  });
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").qualification,
    "unqualified",
  );
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").runtimeModes,
    [],
  );
});

Deno.test("qualification matching rejects every changed runtime identity axis", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const variants = [
    ["digest", (event: MutableAttestation) => {
      event.material.imageDigest = "e".repeat(64);
    }],
    ["profile", (event: MutableAttestation) => {
      event.profile = { id: "other-profile", version: "1", fingerprint: null };
    }],
    ["launch group", (event: MutableAttestation) => {
      event.launchGroup = {
        id: "other-group",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      };
    }],
    ["contract", (event: MutableAttestation) => {
      event.contract.source = "src/adapters/other.ts";
    }],
    ["binding", (event: MutableAttestation) => {
      event.binding.id = "other-binding";
    }],
    ["manifest", (event: MutableAttestation) => {
      event.unit.manifestFingerprint = { algorithm: "sha256", digest: "1".repeat(64) };
    }],
    ["host", (event: MutableAttestation) => {
      event.observedHost.identityFingerprint = HOST_B;
    }],
  ] as const;

  for (const [label, mutate] of variants) {
    const mismatch = await reattest(proven.event, mutate);
    const effective = evaluateCapabilityRuntimeQualifications({
      catalog,
      host,
      attestations: [mismatch],
      specs: [],
      candidates: [],
      provenAttestations: [proven.event],
    });
    assertEquals(
      binding(effective, "chrono-prescribed-kinematics").qualification,
      "unqualified",
      label,
    );
    assertEquals(
      binding(effective, "chrono-prescribed-kinematics").runtimeModes,
      [],
      label,
    );
  }
});

Deno.test("an auto-hashed Chrono attestation with arbitrary fixture never qualifies", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const forged = await reattest(proven.event, (event) => {
    event.fixture = { id: "chrono-arm64-fixture", fingerprint: FIXTURE };
  });
  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [forged],
    specs: proven.specs,
    candidates: proven.candidates,
    provenAttestations: [proven.event],
  });
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").qualification,
    "unqualified",
  );
});

Deno.test(
  "an arbitrary self-consistent outcome fingerprint does not qualify without the exact stopped WAL",
  async () => {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const host = observedHost(HOST_A);
    const proven = await provenChrono(host);
    const forged = await reattest(proven.event, (event) => {
      event.outcome = {
        id: capabilityRuntimeQualificationStoppedOutcomeId(OUTCOME),
        fingerprint: OUTCOME,
      };
    });
    const effective = evaluateCapabilityRuntimeQualifications({
      catalog,
      host,
      attestations: [forged],
      specs: proven.specs,
      candidates: proven.candidates,
      provenAttestations: [proven.event],
    });
    assertEquals(
      binding(effective, "chrono-prescribed-kinematics").qualification,
      "unqualified",
    );
    assertEquals(
      binding(effective, "chrono-prescribed-kinematics").runtimeModes,
      [],
    );
  },
);

Deno.test("a stopped-but-not-attested WAL cannot make Chrono effective", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [proven.event],
    specs: proven.specs,
    candidates: proven.candidates,
    provenAttestations: [],
  });
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").qualification,
    "unqualified",
  );
});

Deno.test("an attested fingerprint mismatch cannot make Chrono effective", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const mismatch = await reattest(proven.event, (event) => {
    event.recordedAt = "2026-08-29T00:00:01.000Z";
  });
  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [proven.event],
    specs: proven.specs,
    candidates: proven.candidates,
    provenAttestations: [mismatch],
  });
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").qualification,
    "unqualified",
  );
});

Deno.test("S1 revocation blocks S2 even when the current spec no longer matches", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const revoked = await reattest(proven.event, (event) => {
    event.state = "revoked";
    event.recordedAt = "2026-08-29T00:00:01.000Z";
  });
  const s2 = await createCapabilityRuntimeQualificationSpecification({
    schemaVersion: "capability-runtime-qualification-specification/1.0",
    id: proven.spec.id,
    version: proven.spec.version,
    candidate: proven.spec.candidate,
    sourceFingerprint: proven.spec.sourceFingerprint,
    loweringFingerprint: proven.spec.loweringFingerprint,
    caseFingerprint: proven.spec.caseFingerprint,
    protocolFingerprint: proven.spec.protocolFingerprint,
    criteriaFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
  });
  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [revoked],
    specs: [s2],
    candidates: proven.candidates,
    provenAttestations: [],
  });
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").qualification,
    "revoked",
  );
  assertEquals(binding(effective, "chrono-prescribed-kinematics").runtimeModes, []);
});

Deno.test("an exact revocation remains a monotone block and historic code-owned native qualification remains usable", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const host = observedHost(HOST_A);
  const proven = await provenChrono(host);
  const revoked = await reattest(proven.event, (event) => {
    event.state = "revoked";
    event.recordedAt = "2026-08-29T00:00:01.000Z";
  });

  const effective = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [proven.event, revoked],
    specs: proven.specs,
    candidates: proven.candidates,
    provenAttestations: [proven.event],
  });
  assertEquals(
    binding(effective, "chrono-prescribed-kinematics").qualification,
    "revoked",
  );
  assertEquals(binding(effective, "chrono-prescribed-kinematics").runtimeModes, []);

  const staticBinding = binding(effective, "calculix-static-structural");
  assertEquals(staticBinding.qualification, "qualified");
  assertEquals(staticBinding.runtimeModes.length, 1);
  assertEquals(staticBinding.runtimeModes[0]?.mode, "native");
  assertEquals(
    staticBinding.runtimeModes[0]?.qualificationAttestationFingerprint,
    null,
  );
});

Deno.test("the local qualification store is canonical, append-only, and rejects secret-shaped fields", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-qualification-" });
  try {
    const proven = await provenChrono(observedHost(HOST_A));
    const store = new FileCapabilityRuntimeQualificationAttestationStore(directory);
    await store.append(proven.event);
    await store.append(proven.event);
    assertEquals(await store.read(proven.event.fingerprint), proven.event);
    assertEquals(await store.list(), [proven.event]);

    await Deno.writeTextFile(
      `${directory}/.00000000-0000-4000-8000-000000000000.tmp`,
      "partial private write",
    );
    assertEquals(await store.list(), [proven.event]);
    await Deno.writeTextFile(`${directory}/foreign.tmp`, "foreign");
    await assertRejects(() => store.list(), Error, "unsupported entry foreign.tmp");
    await Deno.remove(`${directory}/foreign.tmp`);

    assertEquals(JSON.stringify(proven.event).includes("headers"), false);
    assertEquals(JSON.stringify(proven.event).includes("payload"), false);
    assertEquals(JSON.stringify(proven.event).includes("token"), false);

    await assertRejects(
      () =>
        validateCapabilityRuntimeBindingQualificationAttestation({
          ...proven.event,
          headers: { authorization: "secret" },
        } as unknown),
      TypeError,
      "headers",
    );

    const revoked = await reattest(proven.event, (event) => {
      event.state = "revoked";
      event.recordedAt = "2026-08-29T00:00:01.000Z";
    });
    assertEquals(
      sameCapabilityRuntimeQualificationRevocationScope(proven.event, revoked),
      true,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("attestation lock order lets qualification win then a later revocation stand", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-qualification-" });
  try {
    const proven = await provenChrono(observedHost(HOST_A));
    const store = new FileCapabilityRuntimeQualificationAttestationStore(directory);
    assertEquals(
      await store.appendQualifiedUnlessRevoked(proven.event),
      { status: "appended" },
    );
    assertEquals(
      await store.appendQualifiedUnlessRevoked(proven.event),
      { status: "existing" },
    );
    const revoked = await reattest(proven.event, (event) => {
      event.state = "revoked";
      event.recordedAt = "2026-08-29T00:00:01.000Z";
    });
    await store.append(revoked);
    assertEquals(
      await store.appendQualifiedUnlessRevoked(proven.event),
      { status: "existing" },
    );
    const events = await store.list();
    assertEquals(events.some((event) => event.state === "qualified"), true);
    assertEquals(events.some((event) => event.state === "revoked"), true);
    const otherHost = await reattest(proven.event, (event) => {
      event.observedHost.identityFingerprint = HOST_B;
    });
    assertEquals(
      sameCapabilityRuntimeQualificationRevocationScope(proven.event, otherHost),
      false,
    );
    assertEquals(
      await store.appendQualifiedUnlessRevoked(otherHost),
      { status: "appended" },
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a durable revocation linearizes before qualification and blocks the qualified append", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-qualification-" });
  try {
    const proven = await provenChrono(observedHost(HOST_A));
    const store = new FileCapabilityRuntimeQualificationAttestationStore(directory);
    const revoked = await reattest(proven.event, (event) => {
      event.state = "revoked";
      event.recordedAt = "2026-08-29T00:00:01.000Z";
    });
    await store.append(revoked);
    assertEquals(
      await store.appendQualifiedUnlessRevoked(proven.event),
      { status: "revoked" },
    );
    assertEquals(
      (await store.list()).some((event) => event.state === "qualified"),
      false,
    );
    assertEquals(await store.read(proven.event.fingerprint), undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a null launch-group revocation blocks the exact null launch-group qualification", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-qualification-" });
  try {
    const proven = await provenChrono(observedHost(HOST_A));
    const qualified = await reattest(proven.event, (event) => {
      event.launchGroup = null;
    });
    const revoked = await reattest(qualified, (event) => {
      event.state = "revoked";
      event.recordedAt = "2026-08-29T00:00:01.000Z";
    });
    assertEquals(
      sameCapabilityRuntimeQualificationRevocationScope(revoked, qualified),
      true,
    );
    const store = new FileCapabilityRuntimeQualificationAttestationStore(directory);
    await store.append(revoked);
    assertEquals(
      await store.appendQualifiedUnlessRevoked(qualified),
      { status: "revoked" },
    );
    assertEquals(await store.read(qualified.fingerprint), undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test({
  name: "attestation read and list refuse a symlink store root",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "attestation-root-symlink-" }),
    );
    try {
      const proven = await provenChrono(observedHost(HOST_A));
      const realRoot = `${base}/real`;
      const linkedRoot = `${base}/linked`;
      await Deno.mkdir(realRoot, { mode: 0o700 });
      await new FileCapabilityRuntimeQualificationAttestationStore(realRoot)
        .append(proven.event);
      await Deno.symlink(realRoot, linkedRoot);
      const store = new FileCapabilityRuntimeQualificationAttestationStore(linkedRoot);
      await assertRejects(() => store.list(), Error, "real directories");
      await assertRejects(
        () => store.read(proven.event.fingerprint),
        Error,
        "real directories",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name: "attestation read and list refuse a symlink event file",
  ignore: Deno.build.os === "windows",
  async fn() {
    const directory = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "attestation-file-symlink-" }),
    );
    try {
      const proven = await provenChrono(observedHost(HOST_A));
      const store = new FileCapabilityRuntimeQualificationAttestationStore(directory);
      await store.append(proven.event);
      const path = `${directory}/${proven.event.fingerprint.digest}.json`;
      const outside = `${directory}/outside.json`;
      await Deno.copyFile(path, outside);
      await Deno.remove(path);
      await Deno.symlink(outside, path);
      await assertRejects(() => store.list(), Error, "regular file");
      await assertRejects(
        () => store.read(proven.event.fingerprint),
        Error,
        "regular file",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "attestation lock refuses ancestor replacement before open and after lock",
  ignore: Deno.build.os === "windows",
  async fn() {
    const proven = await provenChrono(observedHost(HOST_A));
    await rejectAncestorReplacement(proven.event, "afterAnchoredDirectoryReady");
    await rejectAncestorReplacement(proven.event, "afterLockAcquired");
  },
});

Deno.test("host qualification identity is stable and opaque rather than a platform fingerprint", async () => {
  const directory = await Deno.makeTempDir({ prefix: "capability-host-identity-" });
  try {
    const firstStore = new FileCapabilityRuntimeHostIdentityStore(
      `${directory}/host-identity.json`,
    );
    const first = await firstStore.read();
    assertEquals(await firstStore.read(), first);

    const second = await new FileCapabilityRuntimeHostIdentityStore(
      `${directory}/another-host-identity.json`,
    ).read();
    assertEquals(first.algorithm, "sha256");
    assertEquals(first.digest.length, 64);
    assertEquals(first.digest === second.digest, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function rejectAncestorReplacement(
  event: CapabilityRuntimeBindingQualificationAttestation,
  seam: "afterAnchoredDirectoryReady" | "afterLockAcquired",
): Promise<void> {
  const base = await Deno.realPath(
    await Deno.makeTempDir({ prefix: `attestation-${seam}-` }),
  );
  try {
    const trusted = `${base}/trusted`;
    const storeRoot = `${trusted}/store`;
    const outside = `${base}/outside`;
    await Deno.mkdir(storeRoot, { recursive: true, mode: 0o700 });
    await Deno.mkdir(outside, { mode: 0o700 });
    let replaced = false;
    const replace = async () => {
      if (replaced) return;
      replaced = true;
      await Deno.rename(trusted, `${base}/trusted-real`);
      await Deno.symlink(outside, trusted);
    };
    const store = new FileCapabilityRuntimeQualificationAttestationStore(storeRoot, {
      [seam]: replace,
    });
    await assertRejects(() => store.append(event), Error, "real directories");
    assertEquals((await Array.fromAsync(Deno.readDir(outside))).length, 0);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

function observedHost(
  identityFingerprint: typeof HOST_A,
): CapabilityRuntimeHostObservation {
  return {
    schemaVersion: "capability-runtime-host-observation/1.0",
    identityFingerprint,
    platform: "linux/arm64",
    images: [],
  };
}

async function currentChrono() {
  const [candidates, specs] = await Promise.all([
    createFirstPartyCapabilityRuntimeQualificationCandidates(),
    createFirstPartyCapabilityRuntimeQualificationSpecifications(),
  ]);
  const spec = specs[0];
  if (!spec) throw new Error("Expected the Chrono qualification spec.");
  return { candidates, specs, spec };
}

async function provenChrono(host: CapabilityRuntimeHostObservation) {
  const current = await currentChrono();
  const candidate = current.candidates[0];
  if (!candidate) throw new Error("Expected the Chrono qualification candidate.");
  const observedHost = {
    identityFingerprint: host.identityFingerprint,
    platform: host.platform,
    fingerprint: await fingerprintCapabilityRuntimeObservedHost(
      host.platform,
      host.identityFingerprint,
    ),
  };
  const identity = {
    candidate: { id: candidate.id, fingerprint: candidate.fingerprint },
    observedHost,
    reviewFingerprint: await sha256Fingerprint({
      schemaVersion: "test-qualification-review/1.0",
      host: host.identityFingerprint,
    }),
    requestId: "chrono-runtime-qualification-request-v1",
    sourceFingerprint: current.spec.sourceFingerprint,
    loweringFingerprint: current.spec.loweringFingerprint,
    caseFingerprint: current.spec.caseFingerprint,
    runRequestFingerprint: await sha256Fingerprint({
      schemaVersion: "test-qualification-run-request/1.0",
      spec: current.spec.fingerprint,
    }),
    qualificationSpecFingerprint: current.spec.fingerprint,
  };
  let attempt = prepareQualificationAttempt(
    identity,
    undefined,
    "2026-08-29T00:00:00.000Z",
  );
  attempt = activateQualificationAttempt(attempt, {
    runtimeStartFingerprint: await sha256Fingerprint({
      schemaVersion: "test-qualification-start/1.0",
    }),
  });
  attempt = submitQualificationAttemptCase(attempt, {
    caseSha256: identity.caseFingerprint.digest,
    caseUri: `chrono-case:sha256:${identity.caseFingerprint.digest}`,
  });
  const dispatching = dispatchingQualificationAttempt(attempt, {
    claimedAt: "2026-08-29T00:00:00.000Z",
    deadlineAt: "2026-08-29T00:05:00.000Z",
  });
  if (!dispatching) throw new Error("Expected a dispatching qualification attempt.");
  const receipt = await sha256Fingerprint({
    schemaVersion: "test-qualification-receipt/1.0",
  });
  attempt = recordQualificationAttempt(dispatching, {
    receiptSha256: receipt.digest,
    receiptFingerprint: receipt,
  });
  attempt = await outcomeQualificationAttempt(
    attempt,
    await createCapabilityRuntimeQualificationAttemptOutcome({
      schemaVersion: "capability-runtime-qualification-attempt-outcome/1.0",
      status: "qualified",
      basis: "recorded",
      recordedAt: "2026-08-29T00:01:00.000Z",
      basisFingerprint: receipt,
    }),
  );
  attempt = await stopQualificationAttempt(attempt, {
    runtimeStopProof: await testStopProof(),
  });
  if (attempt.phase !== "stopped") throw new Error("Expected a stopped attempt.");
  const event = await createChronoRuntimeQualificationAttestation({
    attempt,
    candidate,
    spec: current.spec,
  });
  return {
    ...current,
    candidate,
    attempt,
    event,
    stoppedOutcome: await capabilityRuntimeQualificationStoppedOutcomeReference(
      attempt,
    ),
  };
}

async function testStopProof() {
  const startProofFingerprint = await sha256Fingerprint({
    schemaVersion: "test-qualification-start-proof/1.0",
  });
  const material = {
    unitId: "casys.test",
    materialId: "image",
    imageDigest: "a".repeat(64),
  };
  const launchGroup = {
    id: "casys-test",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint({
      schemaVersion: "test-qualification-launch-group/1.0",
    }),
  };
  return await createCapabilityRuntimeQualificationHostStopProof({
    schemaVersion: "capability-runtime-qualification-host-stop-proof/1.0",
    journalEntry: {
      id: "capability-group-runtime-stop-test",
      action: "runtime-stop",
      materials: [material],
      launchGroup,
      projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
      plannedAt: "2026-08-29T00:00:00.000Z",
      previousObservations: [{
        material,
        state: { material: "installed", runtime: "active" },
      }],
      effectiveRuntimeProjection: null,
      qualificationStartAuthority: null,
      administrativeRemovalPlanFingerprint: null,
    },
    outcome: {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: "capability-group-runtime-stop-test",
      recordedAt: "2026-08-29T00:00:00.000Z",
      status: "succeeded",
      observations: [{
        material,
        state: { material: "installed", runtime: "inactive" },
      }],
      detail: null,
    },
    convergence: "host-outcome-succeeded",
    observations: [{
      material,
      state: { material: "installed", runtime: "inactive" },
    }],
    observedAt: "2026-08-29T00:00:00.000Z",
    startProofFingerprint,
  });
}

type MutableAttestation = {
  -readonly [Key in keyof CapabilityRuntimeBindingQualificationAttestation]:
    CapabilityRuntimeBindingQualificationAttestation[Key] extends object
      ? Record<string, unknown>
      : CapabilityRuntimeBindingQualificationAttestation[Key];
};

async function reattest(
  source: CapabilityRuntimeBindingQualificationAttestation,
  mutate: (event: MutableAttestation) => void,
): Promise<CapabilityRuntimeBindingQualificationAttestation> {
  const event = structuredClone(source) as unknown as MutableAttestation;
  mutate(event);
  const observedHost = event.observedHost as unknown as {
    identityFingerprint: typeof HOST_A;
    platform: "linux/arm64" | "linux/amd64";
    fingerprint: typeof HOST_A;
  };
  observedHost.fingerprint = await fingerprintCapabilityRuntimeObservedHost(
    observedHost.platform,
    observedHost.identityFingerprint,
  );
  const { fingerprint: _previous, ...body } = event as unknown as
    & Omit<
      CapabilityRuntimeBindingQualificationAttestation,
      "fingerprint"
    >
    & { fingerprint: typeof HOST_A };
  return await createCapabilityRuntimeBindingQualificationAttestation({
    ...body,
    fingerprint: await fingerprintCapabilityRuntimeBindingQualificationAttestation(
      body,
    ),
  });
}

function binding(
  catalog: CapabilityRuntimeCatalog,
  id: string,
): QualifiedCapabilityRuntimeBinding {
  const selected = catalog.bindings.find((candidate) => candidate.id === id);
  if (!selected) throw new Error(`Missing test binding ${id}.`);
  return selected;
}
