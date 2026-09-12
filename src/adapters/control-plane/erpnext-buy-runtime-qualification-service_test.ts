import { assertEquals, assertRejects } from "@std/assert";
import {
  ErpnextBuyRuntimeQualificationError,
  ErpnextBuyRuntimeQualificationService,
} from "./erpnext-buy-runtime-qualification-service.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroups } from "./first-party-capability-runtime-launch-groups.ts";
import { FileCapabilityRuntimeQualificationAttemptStore } from "./file-capability-runtime-qualification-attempt-store.ts";
import { FileCapabilityRuntimeQualificationAttestationStore } from "./file-capability-runtime-qualification-attestation-store.ts";
import {
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
  InMemoryCapabilityRuntimeStateObserver,
} from "./in-memory-capability-runtime-supervisor.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "../../application/control-plane/capability-runtime-launch-group-supervisor.ts";
import type { CapabilityRuntimeQualificationAttemptStore } from "../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeHostMutator,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { ERPNEXT_BUY_CAPTURE_TOOL } from "../../domain/buy/buy-operations.ts";
import { BUY_FIXTURE_MODIFIED } from "../../domain/buy/buy-fixtures.ts";
import {
  parseLocalErpnextBuyInstallationProfile,
} from "./local-erpnext-buy-installation-profile.ts";
import { parseLocalErpnextBuyQualificationFixture } from "./local-erpnext-buy-qualification-fixture.ts";
import {
  catalogWithErpnextBuyRuntime,
  createErpnextBuyRuntimeContribution,
  launchGroupRegistryWithErpnextBuyRuntime,
} from "./local-erpnext-buy-runtime-contribution.ts";
import { createErpnextBuyRuntimeQualificationCandidates } from "./first-party-erpnext-buy-runtime-qualification-candidates.ts";
import { createErpnextBuyRuntimeQualificationSpecifications } from "./first-party-erpnext-buy-runtime-qualification-specifications.ts";

const HOST_IDENTITY = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const SYNTHETIC_DIGEST =
  "cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
const LEASE_ID = "capability-runtime-qualification-erpnext-buy-source-v1";

Deno.test("ERP Buy recover continues a recorded WAL to attestation without recapture", async () => {
  const runtime = await fixture({ crashAfterMarkRecorded: 1 });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    await assertRejects(
      () => runtime.service.apply(runtime.candidate.id, review.reviewFingerprint, true),
      Error,
      "crash-after-mark-recorded",
    );
    assertEquals(runtime.captures, 1);
    const recovered = await runtime.service.recover(runtime.candidate.id);
    assertEquals(recovered.phase, "attested");
    if (recovered.phase !== "attested") throw new Error("attested WAL absent");
    assertEquals(recovered.outcome.status, "qualified");
    assertEquals(runtime.captures, 1);
    assertEquals((await runtime.attestations.list()).length, 1);
    assertEquals(await runtime.leases.read(LEASE_ID), undefined);
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-stop").length,
      1,
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("ERP Buy recover continues a stopped WAL to attestation and is idempotent", async () => {
  const runtime = await fixture({ crashAfterMarkStopped: 1 });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    await assertRejects(
      () => runtime.service.apply(runtime.candidate.id, review.reviewFingerprint, true),
      Error,
      "crash-after-mark-stopped",
    );
    assertEquals(runtime.captures, 1);
    const recovered = await runtime.service.recover(runtime.candidate.id);
    assertEquals(recovered.phase, "attested");
    if (recovered.phase !== "attested") throw new Error("attested WAL absent");
    assertEquals(recovered.outcome.status, "qualified");
    const again = await runtime.service.recover(runtime.candidate.id);
    assertEquals(again.phase, "attested");
    if (again.phase !== "attested") throw new Error("attested WAL absent");
    assertEquals(again.attestationFingerprint, recovered.attestationFingerprint);
    assertEquals(runtime.captures, 1);
    assertEquals((await runtime.attestations.list()).length, 1);
    assertEquals(await runtime.leases.read(LEASE_ID), undefined);
  } finally {
    await runtime.close();
  }
});

Deno.test("ERP Buy recover refuses an ambiguous active dispatch without recapture", async () => {
  const runtime = await fixture({ crashAfterClaimDispatching: 1 });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    await assertRejects(
      () => runtime.service.apply(runtime.candidate.id, review.reviewFingerprint, true),
      Error,
      "crash-after-claim-dispatching",
    );
    assertEquals(runtime.captures, 0);
    await assertRejects(
      () => runtime.service.recover(runtime.candidate.id),
      ErpnextBuyRuntimeQualificationError,
      "ambiguous active dispatch",
    );
    assertEquals(runtime.captures, 0);
    assertEquals((await runtime.attestations.list()).length, 0);
    runtime.advance(5 * 60 * 1000 + 1);
    const expired = await runtime.service.recover(runtime.candidate.id);
    assertEquals(expired.phase, "stopped");
    if (expired.phase !== "stopped") throw new Error("stopped WAL absent");
    assertEquals(expired.outcome.status, "unavailable");
    assertEquals(runtime.captures, 0);
    assertEquals((await runtime.attestations.list()).length, 0);
    assertEquals(await runtime.leases.read(LEASE_ID), undefined);
  } finally {
    await runtime.close();
  }
});

async function fixture(options: {
  readonly crashAfterMarkRecorded?: number;
  readonly crashAfterMarkStopped?: number;
  readonly crashAfterClaimDispatching?: number;
} = {}) {
  const directory = await Deno.makeTempDir({ prefix: "erp-buy-qualification-test-" });
  const profile = parseLocalErpnextBuyInstallationProfile(syntheticProfile());
  const fixtureDocuments = parseLocalErpnextBuyQualificationFixture(
    syntheticFixture(),
  );
  const contribution = await createErpnextBuyRuntimeContribution(profile);
  const catalog = await catalogWithErpnextBuyRuntime(
    await createFirstPartyCapabilityRuntimeCatalog(),
    contribution,
  );
  const launchGroups = launchGroupRegistryWithErpnextBuyRuntime(
    await createFirstPartyCapabilityRuntimeLaunchGroups(),
    contribution,
  );
  const [candidate] = await createErpnextBuyRuntimeQualificationCandidates({
    catalog,
    launchGroup: contribution.launchGroup,
    profile,
    fixture: fixtureDocuments,
  });
  const [spec] = await createErpnextBuyRuntimeQualificationSpecifications(
    candidate ? [candidate] : [],
  );
  if (!candidate || !spec) throw new Error("ERP Buy qualification fixtures absent");
  const states = new InMemoryCapabilityRuntimeStateObserver();
  states.set(candidate.material, { material: "installed", runtime: "inactive" });
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const journal = new InMemoryCapabilityRuntimeJournal();
  const host = new QualificationHost(states);
  let nowMs = Date.parse("2026-09-12T00:00:00.000Z");
  const now = () => new Date(nowMs).toISOString();
  const groups = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: launchGroups,
    journal,
    leases,
    states,
    host,
    secrets: { observe: () => Promise.resolve(new Map()) },
    lock: serialLock(),
    now,
  });
  const innerAttempts = new FileCapabilityRuntimeQualificationAttemptStore(
    `${directory}/attempts`,
    { now },
  );
  let remainingAfterRecorded = options.crashAfterMarkRecorded ?? 0;
  let remainingAfterStopped = options.crashAfterMarkStopped ?? 0;
  let remainingAfterClaim = options.crashAfterClaimDispatching ?? 0;
  const attempts = new HookedAttemptStore(innerAttempts, {
    afterMarkRecorded: () => {
      if (remainingAfterRecorded-- > 0) throw new Error("crash-after-mark-recorded");
    },
    afterMarkStopped: () => {
      if (remainingAfterStopped-- > 0) throw new Error("crash-after-mark-stopped");
    },
    afterClaimDispatching: () => {
      if (remainingAfterClaim-- > 0) throw new Error("crash-after-claim-dispatching");
    },
  });
  const attestations = new FileCapabilityRuntimeQualificationAttestationStore(
    `${directory}/attestations`,
  );
  const wrapper = await loadCaptureWrapper();
  let captures = 0;
  const fetchImpl: typeof fetch = (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      readonly id?: unknown;
      readonly method?: string;
      readonly params?: { readonly name?: string };
    };
    if (body.params?.name === ERPNEXT_BUY_CAPTURE_TOOL) captures++;
    return Promise.resolve(Response.json({
      jsonrpc: "2.0",
      id: body.id ?? 1,
      result: {
        resultType: "complete",
        content: [{ type: "text", text: "synthetic erp capture" }],
        structuredContent: wrapper,
      },
    }));
  };
  const service = new ErpnextBuyRuntimeQualificationService({
    candidates: [candidate],
    specs: [spec],
    catalog,
    profile,
    fixture: fixtureDocuments,
    policy: {
      read: () =>
        Promise.resolve({
          schemaVersion: "capability-runtime-admin-policy/1.0",
          disabledBindingIds: [],
          preferences: [],
        }),
    },
    lock: {
      read: () =>
        Promise.resolve({
          schemaVersion: "capability-runtime-admin-lock/1.0",
          revision: 0,
          previous: null,
          units: [],
        }),
    },
    launchGroups,
    attempts,
    attestations,
    groups,
    leases,
    host: {
      read: () =>
        Promise.resolve({
          platform: "linux/arm64",
          identityFingerprint: HOST_IDENTITY,
        }),
    },
    now,
    fetch: fetchImpl,
  });
  return {
    service,
    candidate,
    host,
    leases,
    attestations,
    advance: (milliseconds: number) => {
      nowMs += milliseconds;
    },
    get captures() {
      return captures;
    },
    close: () => Deno.remove(directory, { recursive: true }),
  };
}

class HookedAttemptStore implements CapabilityRuntimeQualificationAttemptStore {
  constructor(
    private readonly inner: CapabilityRuntimeQualificationAttemptStore,
    private readonly hooks: {
      readonly afterMarkRecorded?: () => void;
      readonly afterMarkStopped?: () => void;
      readonly afterClaimDispatching?: () => void;
    },
  ) {}
  read(...args: Parameters<CapabilityRuntimeQualificationAttemptStore["read"]>) {
    return this.inner.read(...args);
  }
  prepare(...args: Parameters<CapabilityRuntimeQualificationAttemptStore["prepare"]>) {
    return this.inner.prepare(...args);
  }
  markActive(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markActive"]>
  ) {
    return this.inner.markActive(...args);
  }
  markStartFailedCleaned(
    ...args: Parameters<
      CapabilityRuntimeQualificationAttemptStore["markStartFailedCleaned"]
    >
  ) {
    return this.inner.markStartFailedCleaned(...args);
  }
  markCaseSubmitted(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markCaseSubmitted"]>
  ) {
    return this.inner.markCaseSubmitted(...args);
  }
  async claimDispatching(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["claimDispatching"]>
  ) {
    const value = await this.inner.claimDispatching(...args);
    this.hooks.afterClaimDispatching?.();
    return value;
  }
  async markRecorded(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markRecorded"]>
  ) {
    const value = await this.inner.markRecorded(...args);
    this.hooks.afterMarkRecorded?.();
    return value;
  }
  sealDispatchDeadline(
    ...args: Parameters<
      CapabilityRuntimeQualificationAttemptStore["sealDispatchDeadline"]
    >
  ) {
    return this.inner.sealDispatchDeadline(...args);
  }
  markQuarantined(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markQuarantined"]>
  ) {
    return this.inner.markQuarantined(...args);
  }
  markOutcome(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markOutcome"]>
  ) {
    return this.inner.markOutcome(...args);
  }
  async markStopped(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markStopped"]>
  ) {
    const value = await this.inner.markStopped(...args);
    this.hooks.afterMarkStopped?.();
    return value;
  }
  markAttested(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markAttested"]>
  ) {
    return this.inner.markAttested(...args);
  }
}

class QualificationHost implements CapabilityRuntimeHostMutator {
  readonly calls: { readonly action: CapabilityRuntimeJournalEntry["action"] }[] = [];
  constructor(private readonly states: InMemoryCapabilityRuntimeStateObserver) {}
  mutate(
    input: { readonly authorization: AuthorizedCapabilityRuntimeHostMutation },
  ): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry;
    this.calls.push({ action: entry.action });
    const state = transitionState(entry.action);
    for (const material of entry.materials) this.states.set(material, state);
    return Promise.resolve({
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: entry.plannedAt,
      status: "succeeded",
      observations: entry.materials.map((material) => ({ material, state })),
      detail: null,
    });
  }
}

function transitionState(
  action: CapabilityRuntimeJournalEntry["action"],
): CapabilityRuntimeObservedState {
  return action === "runtime-qualification-start" || action === "runtime-start"
    ? { material: "installed", runtime: "active" }
    : { material: "installed", runtime: "inactive" };
}

function serialLock() {
  let tail = Promise.resolve();
  return {
    withLock<T>(operation: () => Promise<T>): Promise<T> {
      const current = tail.then(operation, operation);
      tail = current.then(() => undefined, () => undefined);
      return current;
    },
  };
}

function syntheticProfile(): Record<string, unknown> {
  return {
    schemaVersion: "local-erpnext-buy-installation-profile/1.0",
    id: "erpnext-buy-synthetic-installation",
    version: "1.0.0",
    material: {
      unitId: "casys.mcp-erpnext-synthetic",
      unitVersion: "0.0.0-synthetic",
      materialId: "mcp-erpnext-synthetic-image",
      imageReference:
        `ghcr.io/casys-ai/mcp-erpnext-synthetic-test@sha256:${SYNTHETIC_DIGEST}`,
      platforms: ["linux/arm64"],
    },
    launchGroup: {
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
      security: "reviewed",
    },
    sourceInstance: {
      kind: "erpnext-site",
      siteId: "sha256:d13ef23b272020d7984b1010e4f26c1770332f8c805abd60dc0f5dcc771c360d",
    },
    qualificationHost: {
      observedHostPlatform: "linux/arm64",
      targetPlatform: "linux/arm64",
      mode: "native",
    },
    licence: { status: "unknown", reference: null },
  };
}

function syntheticFixture(): Record<string, unknown> {
  return {
    schemaVersion: "local-erpnext-buy-qualification-fixture/1.0",
    id: "erpnext-buy-qualification-fixture-synthetic-v1",
    documents: [
      {
        doctype: "Item",
        name: "ITEM-SYNTHETIC-001",
        expectedModified: BUY_FIXTURE_MODIFIED,
      },
      { doctype: "BOM", name: "BOM-SYNTHETIC-001" },
      { doctype: "Item Price", name: "ITEM-PRICE-SYNTHETIC-001" },
      { doctype: "Supplier Quotation", name: "SQ-SYNTHETIC-001" },
    ],
    boundary:
      "Host runtime contract fixture only; no product, Thread, purchase, or spend verdict.",
  };
}

async function loadCaptureWrapper(): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(
    new URL("../buy/fixtures/buy-source-capture.wrapper.json", import.meta.url),
  );
  return JSON.parse(text) as Record<string, unknown>;
}
