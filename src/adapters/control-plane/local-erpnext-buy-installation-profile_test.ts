import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroups } from "./first-party-capability-runtime-launch-groups.ts";
import {
  ERPNEXT_BUY_RUNTIME_ADAPTER_ID,
  ERPNEXT_BUY_RUNTIME_BINDING_ID,
  loadLocalErpnextBuyInstallationProfile,
  parseLocalErpnextBuyInstallationProfile,
} from "./local-erpnext-buy-installation-profile.ts";
import {
  loadLocalErpnextBuyQualificationFixture,
  parseLocalErpnextBuyQualificationFixture,
} from "./local-erpnext-buy-qualification-fixture.ts";
import {
  catalogWithErpnextBuyRuntime,
  createErpnextBuyRuntimeContribution,
  launchGroupRegistryWithErpnextBuyRuntime,
} from "./local-erpnext-buy-runtime-contribution.ts";
import { createErpnextBuyRuntimeQualificationCandidates } from "./first-party-erpnext-buy-runtime-qualification-candidates.ts";
import { createErpnextBuyRuntimeQualificationSpecifications } from "./first-party-erpnext-buy-runtime-qualification-specifications.ts";
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
import { CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { createCapabilityRuntimeQualificationAttestation } from "../../application/control-plane/capability-runtime-qualification-attestation-factory.ts";
import {
  evaluateCapabilityRuntimeQualifications,
  loadProvenCapabilityRuntimeQualificationAttestations,
} from "../../application/control-plane/evaluate-capability-runtime-qualifications.ts";
import {
  fingerprintCapabilityRuntimeObservedHost,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import { BUY_FIXTURE_SITE } from "../../domain/buy/buy-fixtures.ts";
import { capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";

const SYNTHETIC_DIGEST =
  "cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
const SYNTHETIC_IMAGE =
  `ghcr.io/casys-ai/mcp-erpnext-synthetic-test@sha256:${SYNTHETIC_DIGEST}`;
const HOST = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("absent ERP Buy installation profile is a non-qualified absence", async () => {
  const loaded = await loadLocalErpnextBuyInstallationProfile({
    path: `${await Deno.makeTempDir({ prefix: "erp-absent-" })}/missing.json`,
  });
  assertEquals(loaded.status, "absent");
});

Deno.test("absent ERP Buy qualification fixture is a non-qualified absence", async () => {
  const loaded = await loadLocalErpnextBuyQualificationFixture({
    path: `${await Deno.makeTempDir({ prefix: "erp-fixture-absent-" })}/missing.json`,
  });
  assertEquals(loaded.status, "absent");
});

Deno.test("malformed ERP Buy installation profile is rejected closed", () => {
  assertThrows(
    () =>
      parseLocalErpnextBuyInstallationProfile({
        ...syntheticProfile(),
        qualified: true,
      }),
    TypeError,
    "unsupported field qualified",
  );
});

Deno.test("ERP Buy installation profile rejects alias, digest, site and unknown-field traps", () => {
  assertThrows(
    () =>
      parseLocalErpnextBuyInstallationProfile({
        ...syntheticProfile(),
        version: "latest",
      }),
    TypeError,
    "mutable version alias",
  );
  assertThrows(
    () =>
      parseLocalErpnextBuyInstallationProfile({
        ...syntheticProfile(),
        material: {
          unitId: "casys.mcp-erpnext-synthetic",
          unitVersion: "0.0.0-synthetic",
          materialId: "mcp-erpnext-synthetic-image",
          imageReference: "ghcr.io/casys-ai/mcp-erpnext:latest",
          platforms: ["linux/arm64"],
        },
      }),
    TypeError,
    "pinned by a lowercase sha256 digest",
  );
  assertThrows(
    () =>
      parseLocalErpnextBuyInstallationProfile({
        ...syntheticProfile(),
        sourceInstance: { kind: "erpnext-site", siteId: "prod.example.com" },
      }),
    TypeError,
    "sha256:",
  );
  assertThrows(
    () =>
      parseLocalErpnextBuyInstallationProfile({
        ...syntheticProfile(),
        mcpUrl: "http://127.0.0.1:3012/mcp",
      }),
    TypeError,
    "unsupported field mcpUrl",
  );
  assertThrows(
    () =>
      parseLocalErpnextBuyInstallationProfile({
        ...syntheticProfile(),
        tools: ["erpnext_buy_capture"],
      }),
    TypeError,
    "unsupported field tools",
  );
});

Deno.test("an exact valid ERP Buy profile contributes unqualified catalog material, group, candidate and spec", async () => {
  const profile = parseLocalErpnextBuyInstallationProfile(syntheticProfile());
  const fixture = parseLocalErpnextBuyQualificationFixture(syntheticFixture());
  const contribution = await createErpnextBuyRuntimeContribution(profile);
  const catalog = await catalogWithErpnextBuyRuntime(
    await createFirstPartyCapabilityRuntimeCatalog(),
    contribution,
  );
  const groups = launchGroupRegistryWithErpnextBuyRuntime(
    await createFirstPartyCapabilityRuntimeLaunchGroups(),
    contribution,
  );
  const listed = await groups.list();
  assertEquals(
    listed.some((group) => group.id === "casys-mcp-erpnext-synthetic"),
    true,
  );
  assertEquals(
    capabilityRuntimeLaunchGroupPublishedLoopbackHostPorts(
      contribution.launchGroup,
    ),
    [3991],
  );
  const binding = catalog.bindings.find((item) =>
    item.id === ERPNEXT_BUY_RUNTIME_BINDING_ID
  );
  assertEquals(binding?.qualification, "unqualified");
  assertEquals(binding?.capability, COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY);
  assertEquals(binding?.adapter.id, ERPNEXT_BUY_RUNTIME_ADAPTER_ID);
  assertEquals("qualified" in profile, false);
  const [candidate] = await createErpnextBuyRuntimeQualificationCandidates({
    catalog,
    launchGroup: contribution.launchGroup,
    profile,
    fixture,
  });
  const [spec] = await createErpnextBuyRuntimeQualificationSpecifications(
    candidate ? [candidate] : [],
  );
  if (!candidate || !spec) throw new Error("ERP qualification contract absent.");
  assertEquals(candidate.material.imageDigest, SYNTHETIC_DIGEST);
  assertEquals(candidate.installedSourceInstance.siteId, BUY_FIXTURE_SITE);
  assertEquals(candidate.fixture.documents[0]?.name, "ITEM-SYNTHETIC-QUAL-001");
  assertEquals(spec.candidate.id, candidate.id);
  for (
    const invalid of [[], [candidate, candidate]]
  ) {
    await assertRejects(
      () => createErpnextBuyRuntimeQualificationSpecifications(invalid),
      TypeError,
      "exactly once",
    );
  }
});

Deno.test("future ERP Buy profile values are accepted without editing parser logic", () => {
  const next = parseLocalErpnextBuyInstallationProfile(syntheticProfile({
    material: {
      unitId: "casys.mcp-erpnext-synthetic",
      unitVersion: "0.0.0-synthetic",
      materialId: "mcp-erpnext-synthetic-image",
      imageReference:
        "ghcr.io/casys-ai/mcp-erpnext-synthetic-test@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      platforms: ["linux/arm64"],
    },
    launchGroup: {
      id: "casys-mcp-erpnext-synthetic",
      version: "1.0.0",
      projectName: "casys-mcp-erpnext-synthetic",
      serviceName: "mcp-erpnext-synthetic",
      loopbackHostPort: 3992,
      containerPort: 3012,
      volumes: [],
      secretSlots: [],
      readiness: {
        timeoutMs: 15_000,
        attemptTimeoutMs: 1_000,
        retryIntervalMs: 250,
      },
      security: "unknown",
    },
  }));
  assertEquals(next.launchGroup.loopbackHostPort, 3992);
  assertEquals(
    next.material.imageReference.endsWith(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ),
    true,
  );
});

Deno.test("exact recorded ERP Buy qualification uses the common attempt path and mismatch cannot qualify", async () => {
  const profile = parseLocalErpnextBuyInstallationProfile(syntheticProfile());
  const fixture = parseLocalErpnextBuyQualificationFixture(syntheticFixture());
  const contribution = await createErpnextBuyRuntimeContribution(profile);
  const catalog = await catalogWithErpnextBuyRuntime(
    await createFirstPartyCapabilityRuntimeCatalog(),
    contribution,
  );
  const [candidate] = await createErpnextBuyRuntimeQualificationCandidates({
    catalog,
    launchGroup: contribution.launchGroup,
    profile,
    fixture,
  });
  const [spec] = await createErpnextBuyRuntimeQualificationSpecifications(
    candidate ? [candidate] : [],
  );
  if (!candidate || !spec) throw new Error("ERP qualification contract absent.");
  const host = {
    schemaVersion: "capability-runtime-host-observation/1.0" as const,
    identityFingerprint: HOST,
    platform: "linux/arm64" as const,
    images: [],
  };
  const proven = await provenErp(candidate, spec, host);
  const qualified = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [proven.event],
    specs: [spec],
    candidates: [candidate],
    provenAttestations: [proven.event],
  });
  assertEquals(
    qualified.bindings.find((item) => item.id === ERPNEXT_BUY_RUNTIME_BINDING_ID)
      ?.qualification,
    "qualified",
  );

  const mismatched = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [proven.event],
    specs: [spec],
    candidates: [{
      ...candidate,
      material: { ...candidate.material, imageDigest: "f".repeat(64) },
    }],
    provenAttestations: [proven.event],
  });
  assertEquals(
    mismatched.bindings.find((item) => item.id === ERPNEXT_BUY_RUNTIME_BINDING_ID)
      ?.qualification,
    "unqualified",
  );

  const loaded = await loadProvenCapabilityRuntimeQualificationAttestations({
    attempts: {
      read: () =>
        Promise.resolve({
          ...proven.attempt,
          phase: "attested" as const,
          attestationFingerprint: proven.event.fingerprint,
        }),
    },
    attestations: [proven.event],
    candidates: [candidate],
    specs: [spec],
    host,
  });
  assertEquals(loaded.length, 1);

  const inactive = evaluateCapabilityRuntimeQualifications({
    catalog,
    host,
    attestations: [proven.event],
    specs: [spec],
    candidates: [candidate],
    provenAttestations: [],
  });
  assertEquals(
    inactive.bindings.find((item) => item.id === ERPNEXT_BUY_RUNTIME_BINDING_ID)
      ?.qualification,
    "unqualified",
  );
});

function syntheticProfile(
  overlay: Record<string, unknown> = {},
): Record<string, unknown> {
  const material = {
    unitId: "casys.mcp-erpnext-synthetic",
    unitVersion: "0.0.0-synthetic",
    materialId: "mcp-erpnext-synthetic-image",
    imageReference: SYNTHETIC_IMAGE,
    platforms: ["linux/arm64"],
  };
  const launchGroup = {
    id: "casys-mcp-erpnext-synthetic",
    version: "1.0.0",
    projectName: "casys-mcp-erpnext-synthetic",
    serviceName: "mcp-erpnext-synthetic",
    loopbackHostPort: 3991,
    containerPort: 3012,
    volumes: [],
    secretSlots: [],
    readiness: {
      timeoutMs: 15_000,
      attemptTimeoutMs: 1_000,
      retryIntervalMs: 250,
    },
    security: "unknown",
  };
  return {
    schemaVersion: "local-erpnext-buy-installation-profile/1.0",
    id: "erpnext-buy-synthetic-installation",
    version: "1.0.0",
    material,
    launchGroup,
    sourceInstance: {
      kind: "erpnext-site",
      siteId: BUY_FIXTURE_SITE,
    },
    qualificationHost: {
      observedHostPlatform: "linux/arm64",
      targetPlatform: "linux/arm64",
      mode: "native",
    },
    licence: { status: "unknown", reference: null },
    ...overlay,
  };
}

function syntheticFixture(): Record<string, unknown> {
  return {
    schemaVersion: "local-erpnext-buy-qualification-fixture/1.0",
    id: "erpnext-buy-qualification-fixture-synthetic-v1",
    documents: [
      { doctype: "Item", name: "ITEM-SYNTHETIC-QUAL-001" },
      { doctype: "Item Price", name: "ITEM-PRICE-SYNTHETIC-QUAL-001" },
    ],
    boundary:
      "Host runtime contract fixture only; no product, Thread, purchase, or spend verdict.",
  };
}

async function provenErp(
  candidate: Awaited<
    ReturnType<typeof createErpnextBuyRuntimeQualificationCandidates>
  >[number],
  spec: Awaited<
    ReturnType<typeof createErpnextBuyRuntimeQualificationSpecifications>
  >[number],
  host: {
    readonly identityFingerprint: typeof HOST;
    readonly platform: "linux/arm64";
  },
) {
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
      schemaVersion: "test-erpnext-buy-qualification-review/1.0",
      host: host.identityFingerprint,
    }),
    requestId: "erpnext-buy-runtime-qualification-request-v1",
    sourceFingerprint: spec.sourceFingerprint,
    loweringFingerprint: spec.loweringFingerprint,
    caseFingerprint: spec.caseFingerprint,
    runRequestFingerprint: await sha256Fingerprint({
      schemaVersion: "test-erpnext-buy-qualification-run-request/1.0",
      spec: spec.fingerprint,
    }),
    qualificationSpecFingerprint: spec.fingerprint,
  };
  let attempt = prepareQualificationAttempt(
    identity,
    undefined,
    "2026-08-29T00:00:00.000Z",
  );
  attempt = activateQualificationAttempt(attempt, {
    runtimeStartFingerprint: await sha256Fingerprint({
      schemaVersion: "test-erpnext-buy-qualification-start/1.0",
    }),
  });
  attempt = submitQualificationAttemptCase(attempt, {
    caseSha256: identity.caseFingerprint.digest,
    caseUri: `erpnext-buy-qualification-case:sha256:${identity.caseFingerprint.digest}`,
  });
  const dispatching = dispatchingQualificationAttempt(attempt, {
    claimedAt: "2026-08-29T00:00:00.000Z",
    deadlineAt: "2026-08-29T00:05:00.000Z",
  });
  if (!dispatching) throw new Error("Expected a dispatching qualification attempt.");
  const receipt = await sha256Fingerprint({
    schemaVersion: "test-erpnext-buy-qualification-receipt/1.0",
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
    runtimeStopProof: await testStopProof(candidate),
  });
  if (attempt.phase !== "stopped") throw new Error("Expected a stopped attempt.");
  const event = await createCapabilityRuntimeQualificationAttestation({
    attempt,
    candidate,
    spec,
  });
  return { attempt, event };
}

async function testStopProof(
  candidate: Awaited<
    ReturnType<typeof createErpnextBuyRuntimeQualificationCandidates>
  >[number],
) {
  return await createCapabilityRuntimeQualificationHostStopProof({
    schemaVersion: "capability-runtime-qualification-host-stop-proof/1.0",
    journalEntry: {
      id: "capability-group-runtime-stop-erpnext-buy-test",
      action: "runtime-stop",
      materials: [candidate.material],
      launchGroup: candidate.launchGroup,
      projectId: CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
      plannedAt: "2026-08-29T00:00:00.000Z",
      previousObservations: [{
        material: candidate.material,
        state: { material: "installed", runtime: "active" },
      }],
      effectiveRuntimeProjection: null,
      qualificationStartAuthority: null,
      administrativeRemovalPlanFingerprint: null,
    },
    outcome: {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: "capability-group-runtime-stop-erpnext-buy-test",
      recordedAt: "2026-08-29T00:00:00.000Z",
      status: "succeeded",
      observations: [{
        material: candidate.material,
        state: { material: "installed", runtime: "inactive" },
      }],
      detail: null,
    },
    convergence: "host-outcome-succeeded",
    observations: [{
      material: candidate.material,
      state: { material: "installed", runtime: "inactive" },
    }],
    observedAt: "2026-08-29T00:00:00.000Z",
    startProofFingerprint: await sha256Fingerprint({
      schemaVersion: "test-erpnext-buy-qualification-start-proof/1.0",
    }),
  });
}
