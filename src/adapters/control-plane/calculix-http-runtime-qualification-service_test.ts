import { assertEquals, assertRejects } from "@std/assert";
import {
  CalculixHttpRuntimeQualificationError,
  CalculixHttpRuntimeQualificationService,
} from "./calculix-http-runtime-qualification-service.ts";
import {
  createFirstPartyCalculixHttpRuntimeQualificationCandidates,
  readCalculixHttpRuntimeQualificationFixtureStepBytes,
} from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import { createFirstPartyCalculixHttpRuntimeQualificationSpecifications } from "./first-party-calculix-http-runtime-qualification-specifications.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroupRegistry } from "./first-party-capability-runtime-launch-groups.ts";
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
import type { CapabilitySessionSolverInputStagerFactory } from "../../application/ports/out/solver-input-stager.ts";
import {
  createCapabilityRuntimeBindingQualificationAttestation,
  fingerprintCapabilityRuntimeBindingQualificationAttestation,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import {
  CALCULIX_RECORDED_RESOURCE_ORDER,
  lowerRecordedCalculixStaticRequest,
  type RecordedCalculixSensitivityProvider,
} from "../sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
import type { JsonValue } from "../../domain/compile/rop/resolved-operation-plan.ts";
import type { SensitivityRecordedProviderResource } from "../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";
import { evaluateCapabilityRuntimeQualifications } from "../../application/control-plane/evaluate-capability-runtime-qualifications.ts";
import { McpResourceReadError } from "../shared/mcp/http-mcp-resource-reader.ts";

const HOST_IDENTITY = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const RUN_ID = "r-11111111-1111-1111-1111-111111111111";
const EXECUTION_IDENTITY = {
  schema_version: "1.0",
  server: { package: "@casys/mcp-calculix", version: "0.8.2" },
  method: { id: "calculix_solve_static_recorded", version: "1.0" },
  lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
  engines: {
    gmsh: { command: "gmsh", version: "4.11.1" },
    ccx: { command: "ccx", version: "CalculiX 2.21" },
  },
  image: { status: "unattested" },
} as const;

Deno.test("CalculiX qualification performs one exact dispatch, reads nine resources, stops, and attests", async () => {
  const runtime = await fixture();
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const result = await runtime.service.apply(review);
    assertEquals(result.phase, "attested");
    if (result.phase !== "attested") throw new Error("attested WAL absent");
    assertEquals(result.outcome.status, "qualified");
    assertEquals(runtime.provider.dispatches, 1);
    assertEquals(runtime.provider.readbacks, 1);
    assertEquals(runtime.provider.resourceLists, 1);
    assertEquals(runtime.provider.requestId, review.requestId);
    assertEquals(
      runtime.provider.requestId === runtime.candidate.fixture.case.requestId,
      false,
    );
    assertEquals(runtime.resourceReads, 9);
    assertEquals(runtime.stager.stages, 1);
    assertEquals(runtime.stager.sawMutationTipBeforeStaging, true);
    assertEquals(runtime.stager.sawLeaseBeforeStaging, true);
    assertEquals(runtime.host.calls.map((call) => call.action), [
      "runtime-qualification-start",
      "runtime-stop",
    ]);
    assertEquals(
      (await runtime.states.observe([runtime.candidate.material])).get(
        capabilityRuntimeMaterialKey(runtime.candidate.material),
      )?.runtime,
      "inactive",
    );
    assertEquals((await runtime.attestations.list()).length, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX repeated apply reuses the exact attested WAL without redispatch or duplicate overlay", async () => {
  const runtime = await fixture();
  try {
    const firstReview = await runtime.service.review(runtime.candidate.id);
    assertEquals((await runtime.service.apply(firstReview)).phase, "attested");
    const secondReview = await runtime.service.review(runtime.candidate.id);
    assertEquals((await runtime.service.apply(secondReview)).phase, "attested");
    assertEquals(runtime.provider.dispatches, 1);
    const events = await runtime.attestations.list();
    assertEquals(events.length, 1);
    const effective = evaluateCapabilityRuntimeQualifications({
      catalog: runtime.catalog,
      host: {
        schemaVersion: "capability-runtime-host-observation/1.0",
        identityFingerprint: HOST_IDENTITY,
        platform: "linux/arm64",
        images: [],
      },
      attestations: events,
      candidates: [runtime.candidate],
      specs: [runtime.spec],
      provenAttestations: events,
    });
    assertEquals(
      effective.bindings.find((binding) => binding.id === runtime.candidate.binding.id)
        ?.qualification,
      "qualified",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX dispatch acknowledgement loss is recovered by readback only, never a second dispatch", async () => {
  const runtime = await fixture({
    dispatch: "throw",
    readbacks: ["absent", "complete"],
  });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const first = await runtime.service.apply(review);
    assertEquals(first.phase, "quarantined");
    assertEquals(runtime.provider.dispatches, 1);
    const recovered = await runtime.service.recover(runtime.candidate.id);
    assertEquals(recovered.phase, "attested");
    assertEquals(runtime.provider.dispatches, 1);
    assertEquals(runtime.provider.readbacks, 2);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX classifies structured incomplete readback states without parsing them as completed", async () => {
  for (const readback of ["not_found", "outcome_unknown"] as const) {
    const runtime = await fixture({ readbacks: [readback] });
    try {
      const review = await runtime.service.review(runtime.candidate.id);
      const result = await runtime.service.apply(review);
      assertEquals(result.phase, "quarantined");
      assertEquals(runtime.quarantines, [{
        reason: "absent",
        stage: "provider-readback",
      }]);
      assertEquals(runtime.provider.dispatches, 1);
      assertEquals((await runtime.attestations.list()).length, 0);
    } finally {
      await runtime.close();
    }
  }
});

Deno.test("CalculiX replays a durable recorded WAL after a post-record crash without redispatch", async () => {
  const runtime = await fixture({ crashAfterMarkRecorded: 1 });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    await assertRejects(
      () => runtime.service.apply(review),
      Error,
      "crash-after-mark-recorded",
    );
    const recovered = await runtime.service.recover(runtime.candidate.id);
    assertEquals(recovered.phase, "attested");
    assertEquals(runtime.provider.dispatches, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX prepared WAL uses its durable start proof on recovery without a second host start", async () => {
  const runtime = await fixture({ crashBeforeMarkActive: 1 });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    await assertRejects(
      () => runtime.service.apply(review),
      Error,
      "crash-before-mark-active",
    );
    const recovered = await runtime.service.recover(runtime.candidate.id);
    assertEquals(recovered.phase, "attested");
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-qualification-start")
        .length,
      1,
    );
    assertEquals(runtime.provider.dispatches, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX terminalizes a prepared WAL after cleaning one exact failed host start", async () => {
  const runtime = await fixture({ failQualificationStart: true });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    await assertRejects(
      () => runtime.service.apply(review),
      Error,
      "without an exact active group observation",
    );
    const cleaned = await runtime.service.recover(runtime.candidate.id);
    assertEquals(cleaned.phase, "start-failed-cleaned");
    assertEquals(runtime.provider.dispatches, 0);
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-stop").length,
      1,
    );
    const again = await runtime.service.recover(runtime.candidate.id);
    assertEquals(again.phase, "start-failed-cleaned");
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-stop").length,
      1,
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX records a failed bounded-criteria outcome, stops the host, and does not attest", async () => {
  const runtime = await fixture({ displacementMm: 50.1 });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const result = await runtime.service.apply(review);
    assertEquals(result.phase, "stopped");
    if (result.phase !== "stopped") throw new Error("stopped WAL absent");
    assertEquals(result.outcome.status, "failed");
    assertEquals((await runtime.attestations.list()).length, 0);
    assertEquals(
      (await runtime.states.observe([runtime.candidate.material])).get(
        capabilityRuntimeMaterialKey(runtime.candidate.material),
      )?.runtime,
      "inactive",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX quarantine deadline resolves unavailable through the terminal stop path", async () => {
  const runtime = await fixture({ readbacks: ["absent", "absent"] });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const first = await runtime.service.apply(review);
    assertEquals(first.phase, "quarantined");
    runtime.advance(5 * 60 * 1000 + 1);
    const stopped = await runtime.service.recover(runtime.candidate.id);
    assertEquals(stopped.phase, "stopped");
    if (stopped.phase !== "stopped") throw new Error("stopped WAL absent");
    assertEquals(stopped.outcome.status, "unavailable");
    assertEquals(runtime.provider.dispatches, 1);
    assertEquals(
      runtime.host.calls.filter((call) => call.action === "runtime-stop").length,
      1,
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX recovers a malformed dispatch acknowledgement by exact readback without redispatch", async () => {
  const runtime = await fixture({
    dispatch: "malformed",
    readbacks: ["absent", "complete"],
  });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const first = await runtime.service.apply(review);
    assertEquals(first.phase, "quarantined");
    assertEquals(runtime.quarantines, [{
      reason: "uncertain",
      stage: "provider-readback",
    }]);
    const recovered = await runtime.service.recover(runtime.candidate.id);
    assertEquals(recovered.phase, "attested");
    assertEquals(runtime.provider.dispatches, 1);
    assertEquals(runtime.provider.readbacks, 2);
    assertEquals((await runtime.attestations.list()).length, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX accepts a complete exact readback after a malformed dispatch acknowledgement", async () => {
  const runtime = await fixture({ dispatch: "malformed" });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const result = await runtime.service.apply(review);
    assertEquals(result.phase, "attested");
    assertEquals(runtime.provider.dispatches, 1);
    assertEquals(runtime.provider.readbacks, 1);
    assertEquals(runtime.provider.resourceLists, 1);
    assertEquals(runtime.resourceReads, 9);
    assertEquals((await runtime.attestations.list()).length, 1);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX rejects a non-bijective resources/list", async () => {
  const runtime = await fixture({
    dispatch: "malformed",
    resourceList: "empty",
  });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const result = await runtime.service.apply(review);
    assertEquals(result.phase, "stopped");
    if (result.phase !== "stopped") throw new Error("stopped WAL absent");
    assertEquals(result.outcome.status, "unavailable");
    assertEquals(runtime.quarantines, [{
      reason: "malformed",
      stage: "provider-resource-list",
    }]);
    assertEquals((await runtime.attestations.list()).length, 0);
    assertEquals(
      (await runtime.states.observe([runtime.candidate.material])).get(
        capabilityRuntimeMaterialKey(runtime.candidate.material),
      )?.runtime,
      "inactive",
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX records a closed resource-content stage without provider detail", async () => {
  const runtime = await fixture({ resourceRead: "throw" });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const result = await runtime.service.apply(review);
    assertEquals(result.phase, "stopped");
    assertEquals(runtime.quarantines, [{
      reason: "malformed",
      stage: "provider-resource-content",
      resourceRole: "input.step",
      resourceFailure: "read-error",
      resourceErrorKind: "unexpected",
    }]);
    assertEquals((await runtime.attestations.list()).length, 0);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX retains only the closed MCP resource reader error kind", async () => {
  const runtime = await fixture({ resourceRead: "mcp-http-rejection" });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const result = await runtime.service.apply(review);
    assertEquals(result.phase, "stopped");
    assertEquals(runtime.quarantines, [{
      reason: "malformed",
      stage: "provider-resource-content",
      resourceRole: "input.step",
      resourceFailure: "read-error",
      resourceErrorKind: "http-rejection",
    }]);
    assertEquals(
      JSON.stringify(runtime.quarantines).includes("provider secret"),
      false,
    );
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX records a closed post-read integrity diagnosis", async () => {
  const runtime = await fixture({ resourceRead: "drift" });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    const result = await runtime.service.apply(review);
    assertEquals(result.phase, "stopped");
    assertEquals(runtime.quarantines, [{
      reason: "malformed",
      stage: "provider-resource-content",
      resourceRole: "input.step",
      resourceFailure: "byte-or-digest-mismatch",
    }]);
    assertEquals((await runtime.attestations.list()).length, 0);
  } finally {
    await runtime.close();
  }
});

Deno.test("CalculiX revocation before start prevents mutations; revocation after active cleans up without dispatch", async () => {
  const beforeStart = await fixture();
  try {
    const review = await beforeStart.service.review(beforeStart.candidate.id);
    await beforeStart.appendRevocation(review);
    await assertRejects(
      () => beforeStart.service.apply(review),
      CalculixHttpRuntimeQualificationError,
      "revoked",
    );
    assertEquals(beforeStart.host.calls, []);
    assertEquals(beforeStart.provider.dispatches, 0);
  } finally {
    await beforeStart.close();
  }
  const active = await fixture({ crashAfterMarkActive: 1 });
  try {
    const review = await active.service.review(active.candidate.id);
    await assertRejects(
      () => active.service.apply(review),
      Error,
      "crash-after-mark-active",
    );
    await active.appendRevocation(review);
    const result = await active.service.recover(active.candidate.id);
    assertEquals(result.phase, "stopped");
    if (result.phase !== "stopped") throw new Error("stopped WAL absent");
    assertEquals(result.outcome.status, "unavailable");
    assertEquals(active.provider.dispatches, 0);
    assertEquals(
      (await active.states.observe([active.candidate.material])).get(
        capabilityRuntimeMaterialKey(active.candidate.material),
      )?.runtime,
      "inactive",
    );
  } finally {
    await active.close();
  }
});

Deno.test("CalculiX attested WAL rejects absent or divergent stored attestations on recovery", async () => {
  for (const readMode of ["absent", "divergent"] as const) {
    const runtime = await fixture();
    try {
      const review = await runtime.service.review(runtime.candidate.id);
      const applied = await runtime.service.apply(review);
      assertEquals(applied.phase, "attested");
      runtime.attestationReadMode = readMode;
      await assertRejects(
        () => runtime.service.recover(runtime.candidate.id),
        CalculixHttpRuntimeQualificationError,
        "does not match the stored event",
      );
    } finally {
      await runtime.close();
    }
  }
});

Deno.test("CalculiX will not attest if the group reactivates after its attestation append", async () => {
  const runtime = await fixture({ reactivateAfterAttestationAppend: 1 });
  try {
    const review = await runtime.service.review(runtime.candidate.id);
    await assertRejects(
      () => runtime.service.apply(review),
      CalculixHttpRuntimeQualificationError,
      "still active after stop",
    );
    assertEquals(runtime.markAttestedCalls, 0);
    runtime.states.set(runtime.candidate.material, {
      material: "installed",
      runtime: "inactive",
    });
    const recovered = await runtime.service.recover(runtime.candidate.id);
    assertEquals(recovered.phase, "attested");
    assertEquals(runtime.markAttestedCalls, 1);
  } finally {
    await runtime.close();
  }
});

async function fixture(options: {
  readonly dispatch?: "complete" | "throw" | "malformed";
  readonly resourceList?: "exact" | "empty";
  readonly readbacks?: readonly (
    | "complete"
    | "absent"
    | "not_found"
    | "outcome_unknown"
  )[];
  readonly displacementMm?: number;
  readonly resourceRead?:
    | "exact"
    | "throw"
    | "mcp-http-rejection"
    | "drift";
  readonly crashBeforeMarkActive?: number;
  readonly crashAfterMarkActive?: number;
  readonly crashAfterMarkRecorded?: number;
  readonly reactivateAfterAttestationAppend?: number;
  readonly failQualificationStart?: boolean;
} = {}) {
  const directory = await Deno.makeTempDir({ prefix: "calculix-qualification-test-" });
  const [candidate] =
    await createFirstPartyCalculixHttpRuntimeQualificationCandidates();
  const [spec] = await createFirstPartyCalculixHttpRuntimeQualificationSpecifications();
  if (!candidate || !spec) throw new Error("CalculiX qualification fixtures absent");
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const launchGroups = await createFirstPartyCapabilityRuntimeLaunchGroupRegistry();
  const states = new InMemoryCapabilityRuntimeStateObserver();
  states.set(candidate.material, { material: "installed", runtime: "inactive" });
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const journal = new InMemoryCapabilityRuntimeJournal();
  const host = new QualificationHost(states, options.failQualificationStart === true);
  let nowMs = Date.parse("2026-09-08T00:00:00.000Z");
  const now = () => new Date(nowMs).toISOString();
  const groups = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: launchGroups,
    journal,
    leases,
    states,
    host,
    secrets: { observe: async () => new Map() },
    lock: serialLock(),
    now,
  });
  let mutationTips = 0;
  const originalMutationTip = groups.requireQualificationMutationTip.bind(groups);
  groups.requireQualificationMutationTip = async (input) => {
    mutationTips++;
    return await originalMutationTip(input);
  };
  const innerAttempts = new FileCapabilityRuntimeQualificationAttemptStore(
    `${directory}/attempts`,
    { now },
  );
  let remainingBeforeActive = options.crashBeforeMarkActive ?? 0;
  let remainingAfterActive = options.crashAfterMarkActive ?? 0;
  let remainingAfterRecorded = options.crashAfterMarkRecorded ?? 0;
  let markAttestedCalls = 0;
  const quarantineInputs: Parameters<
    CapabilityRuntimeQualificationAttemptStore["markQuarantined"]
  >[1][] = [];
  const attempts = new HookedAttemptStore(innerAttempts, {
    beforeMarkActive: () => {
      if (remainingBeforeActive-- > 0) throw new Error("crash-before-mark-active");
    },
    afterMarkActive: () => {
      if (remainingAfterActive-- > 0) throw new Error("crash-after-mark-active");
    },
    afterMarkRecorded: () => {
      if (remainingAfterRecorded-- > 0) {
        throw new Error("crash-after-mark-recorded");
      }
    },
    beforeMarkAttested: () => {
      markAttestedCalls++;
    },
    beforeMarkQuarantined: (input) => quarantineInputs.push(input),
  });
  const innerAttestations = new FileCapabilityRuntimeQualificationAttestationStore(
    `${directory}/attestations`,
  );
  let attestationReadMode: "normal" | "absent" | "divergent" = "normal";
  let remainingReactivations = options.reactivateAfterAttestationAppend ?? 0;
  const attestations = {
    list: () => innerAttestations.list(),
    append: (value: Parameters<typeof innerAttestations.append>[0]) =>
      innerAttestations.append(value),
    appendQualifiedUnlessRevoked: async (
      value: Parameters<typeof innerAttestations.appendQualifiedUnlessRevoked>[0],
    ) => {
      const appended = await innerAttestations.appendQualifiedUnlessRevoked(value);
      if (remainingReactivations-- > 0) {
        states.set(candidate.material, { material: "installed", runtime: "active" });
      }
      return appended;
    },
    read: async (fingerprint: Parameters<typeof innerAttestations.read>[0]) => {
      const stored = await innerAttestations.read(fingerprint);
      if (attestationReadMode === "absent") return undefined;
      if (attestationReadMode === "divergent" && stored) {
        return {
          ...stored,
          fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
        };
      }
      return stored;
    },
  };
  const provider = await FixtureProvider.create(candidate, {
    dispatch: options.dispatch ?? "complete",
    resourceList: options.resourceList ?? "exact",
    readbacks: options.readbacks ?? ["complete"],
    displacementMm: options.displacementMm ?? 0.1,
  });
  let resourceReads = 0;
  const stager = {
    stages: 0,
    sawMutationTipBeforeStaging: false,
    sawLeaseBeforeStaging: false,
    stage: async (input: { readonly fingerprint: { readonly digest: string } }) => {
      stager.stages++;
      stager.sawMutationTipBeforeStaging = mutationTips > 0;
      stager.sawLeaseBeforeStaging = (await leases.listActive(now())).length === 1;
      return {
        stagedAsset: { location: `/inputs/fea-${input.fingerprint.digest}.step` },
      };
    },
    read: async () => undefined,
  };
  const stagers: CapabilitySessionSolverInputStagerFactory = {
    forActiveCapabilitySession: async () => stager,
  };
  const service = new CalculixHttpRuntimeQualificationService({
    candidates: [candidate],
    specs: [spec],
    catalog,
    policy: {
      read: async () => ({
        schemaVersion: "capability-runtime-admin-policy/1.0",
        disabledBindingIds: [],
        preferences: [],
      }),
    },
    lock: {
      read: async () => ({
        schemaVersion: "capability-runtime-admin-lock/1.0",
        revision: 0,
        previous: null,
        units: [],
      }),
    },
    launchGroups,
    states,
    attempts,
    attestations,
    groups,
    host: {
      read: async () => ({
        platform: "linux/arm64",
        identityFingerprint: HOST_IDENTITY,
      }),
    },
    stagers,
    provider,
    readResource: async (resource) => {
      resourceReads++;
      assertEquals(Object.keys(resource).sort(), [
        "byteCount",
        "mediaType",
        "sha256",
        "uri",
      ]);
      if (options.resourceRead === "throw") {
        throw new Error("provider detail must not enter qualification WAL");
      }
      if (options.resourceRead === "mcp-http-rejection") {
        throw new McpResourceReadError(
          "http-rejection",
          "provider secret must not enter qualification WAL",
        );
      }
      if (options.resourceRead === "drift") return new Uint8Array();
      return provider.resource(resource.sha256);
    },
    now,
  });
  return {
    service,
    candidate,
    spec,
    catalog,
    provider,
    host,
    states,
    stager,
    get resourceReads() {
      return resourceReads;
    },
    get attestationReadMode() {
      return attestationReadMode;
    },
    set attestationReadMode(value: "normal" | "absent" | "divergent") {
      attestationReadMode = value;
    },
    get markAttestedCalls() {
      return markAttestedCalls;
    },
    get quarantines() {
      return quarantineInputs;
    },
    attestations,
    advance: (milliseconds: number) => {
      nowMs += milliseconds;
    },
    appendRevocation: async (review: Awaited<ReturnType<typeof service.review>>) => {
      const body = {
        schemaVersion:
          "capability-runtime-binding-qualification-attestation/1.1" as const,
        state: "revoked" as const,
        recordedAt: now(),
        binding: candidate.binding,
        selector: candidate.selector,
        contract: candidate.contract,
        profile: candidate.profile,
        unit: candidate.unit,
        material: candidate.material,
        targetPlatform: candidate.targetPlatform,
        mode: candidate.mode,
        launchGroup: candidate.launchGroup,
        observedHost: review.observedHost,
        fixture: {
          id: candidate.fixture.id,
          fingerprint: candidate.fixture.sourceFingerprint,
        },
        qualificationSpec: { id: spec.id, fingerprint: spec.fingerprint },
        outcome: {
          id: `capability-runtime-qualification-stopped-${"d".repeat(64)}`,
          fingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
        },
      };
      await attestations.append(
        await createCapabilityRuntimeBindingQualificationAttestation({
          ...body,
          fingerprint:
            await fingerprintCapabilityRuntimeBindingQualificationAttestation(body),
        }),
      );
    },
    close: () => Deno.remove(directory, { recursive: true }),
  };
}

class HookedAttemptStore implements CapabilityRuntimeQualificationAttemptStore {
  constructor(
    private readonly inner: CapabilityRuntimeQualificationAttemptStore,
    private readonly hooks: {
      readonly beforeMarkActive?: () => void;
      readonly afterMarkActive?: () => void;
      readonly afterMarkRecorded?: () => void;
      readonly beforeMarkAttested?: () => void;
      readonly beforeMarkQuarantined?: (
        input: Parameters<
          CapabilityRuntimeQualificationAttemptStore["markQuarantined"]
        >[1],
      ) => void;
    },
  ) {}
  read(...args: Parameters<CapabilityRuntimeQualificationAttemptStore["read"]>) {
    return this.inner.read(...args);
  }
  prepare(...args: Parameters<CapabilityRuntimeQualificationAttemptStore["prepare"]>) {
    return this.inner.prepare(...args);
  }
  async markActive(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markActive"]>
  ) {
    this.hooks.beforeMarkActive?.();
    const value = await this.inner.markActive(...args);
    this.hooks.afterMarkActive?.();
    return value;
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
  claimDispatching(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["claimDispatching"]>
  ) {
    return this.inner.claimDispatching(...args);
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
    this.hooks.beforeMarkQuarantined?.(args[1]);
    return this.inner.markQuarantined(...args);
  }
  markOutcome(
    ...args: Parameters<CapabilityRuntimeQualificationAttemptStore["markOutcome"]>
  ) {
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

class QualificationHost implements CapabilityRuntimeHostMutator {
  readonly calls: { readonly action: CapabilityRuntimeJournalEntry["action"] }[] = [];
  constructor(
    private readonly states: InMemoryCapabilityRuntimeStateObserver,
    private readonly failQualificationStart = false,
  ) {}
  async mutate(
    input: { readonly authorization: AuthorizedCapabilityRuntimeHostMutation },
  ): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry;
    this.calls.push({ action: entry.action });
    if (
      this.failQualificationStart && entry.action === "runtime-qualification-start"
    ) {
      const state = { material: "installed", runtime: "degraded" } as const;
      for (const material of entry.materials) this.states.set(material, state);
      return {
        schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
        journalEntryId: entry.id,
        recordedAt: entry.plannedAt,
        status: "failed",
        observations: entry.materials.map((material) => ({ material, state })),
        detail: "fixture terminal failed start",
      };
    }
    const state = transitionState(entry.action);
    for (const material of entry.materials) this.states.set(material, state);
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: entry.plannedAt,
      status: "succeeded",
      observations: entry.materials.map((material) => ({ material, state })),
      detail: null,
    };
  }
}

class FixtureProvider implements RecordedCalculixSensitivityProvider {
  dispatches = 0;
  readbacks = 0;
  resourceLists = 0;
  #resources: readonly SensitivityRecordedProviderResource[] = [];
  #bytes = new Map<string, Uint8Array>();
  #requestSha256 = "";
  #requestId = "";
  readonly #candidate: Awaited<
    ReturnType<typeof createFirstPartyCalculixHttpRuntimeQualificationCandidates>
  >[number];
  readonly #step: Uint8Array;
  readonly #displacementMm: number;
  #nextReadback: (
    | "complete"
    | "absent"
    | "not_found"
    | "outcome_unknown"
  )[];
  #dispatch: "complete" | "throw" | "malformed";
  readonly #resourceList: "exact" | "empty";
  private constructor(
    input: {
      readonly candidate: Awaited<
        ReturnType<typeof createFirstPartyCalculixHttpRuntimeQualificationCandidates>
      >[number];
      readonly step: Uint8Array;
      readonly displacementMm: number;
      readonly readbacks: readonly (
        | "complete"
        | "absent"
        | "not_found"
        | "outcome_unknown"
      )[];
      readonly dispatch: "complete" | "throw" | "malformed";
      readonly resourceList: "exact" | "empty";
    },
  ) {
    this.#candidate = input.candidate;
    this.#step = input.step;
    this.#displacementMm = input.displacementMm;
    this.#nextReadback = [...input.readbacks];
    this.#dispatch = input.dispatch;
    this.#resourceList = input.resourceList;
  }
  static async create(
    candidate: Awaited<
      ReturnType<typeof createFirstPartyCalculixHttpRuntimeQualificationCandidates>
    >[number],
    options: {
      readonly dispatch: "complete" | "throw" | "malformed";
      readonly resourceList: "exact" | "empty";
      readonly readbacks: readonly (
        | "complete"
        | "absent"
        | "not_found"
        | "outcome_unknown"
      )[];
      readonly displacementMm: number;
    },
  ): Promise<FixtureProvider> {
    const step = await readCalculixHttpRuntimeQualificationFixtureStepBytes(candidate);
    return new FixtureProvider({ candidate, step, ...options });
  }
  async callRecorded(request: Readonly<Record<string, JsonValue>>): Promise<unknown> {
    this.dispatches++;
    await this.#prepare(request);
    if (this.#dispatch === "throw") throw new Error("transport acknowledgement lost");
    if (this.#dispatch === "malformed") return {};
    return {
      schemaVersion: "2.0",
      kind: "static-solve-recorded",
      inputArtifact: {},
      mesh: {},
      constraints: {},
      metrics: {},
      run: this.#run(this.#requestId),
    };
  }
  async getRun(requestId: string): Promise<unknown> {
    this.readbacks++;
    const readback = this.#nextReadback.shift() ?? "complete";
    if (readback === "absent") {
      throw new Error("not_found");
    }
    if (readback === "not_found" || readback === "outcome_unknown") {
      return { schemaVersion: "1.0", status: readback };
    }
    return {
      schemaVersion: "1.0",
      status: "completed",
      lookup: { kind: "request_id", value: requestId },
      requestId,
      runId: RUN_ID,
      run: this.#run(requestId),
    };
  }
  async listResources(): Promise<unknown> {
    this.resourceLists++;
    if (this.#resourceList === "empty") return { resources: [] };
    return {
      resources: this.#resources.map((resource) => ({
        uri: resource.uri,
        name: resource.role,
        mimeType: resource.mediaType,
        size: resource.byteCount,
      })),
    };
  }
  get requestId(): string {
    return this.#requestId;
  }
  resource(sha256: string): Uint8Array {
    const value = this.#bytes.get(sha256);
    if (!value) throw new Error(`missing fake resource ${sha256}`);
    return value;
  }
  async #prepare(request: Readonly<Record<string, JsonValue>>): Promise<void> {
    this.#requestId = String(request.request_id);
    const requestBytes = new TextEncoder().encode(
      `${deterministicJson({ ...request, execution_identity: EXECUTION_IDENTITY })}\n`,
    );
    const resultBytes = new TextEncoder().encode(JSON.stringify(resultJson(
      this.#candidate.fixture.step.sha256,
      this.#candidate.fixture.step.byteCount,
      this.#displacementMm,
    )));
    const empty = new Uint8Array();
    const [requestSha256, resultSha256, emptyDigest] = await Promise.all([
      fingerprintResourceBytes(requestBytes),
      fingerprintResourceBytes(resultBytes),
      fingerprintResourceBytes(empty),
    ]);
    this.#requestSha256 = requestSha256;
    this.#bytes = new Map([
      [this.#candidate.fixture.step.sha256, this.#step],
      [requestSha256, requestBytes],
      [resultSha256, resultBytes],
      [emptyDigest, empty],
    ]);
    this.#resources = CALCULIX_RECORDED_RESOURCE_ORDER.map((role) => ({
      role,
      uri: `casys://calculix/runs/${RUN_ID}/${role}`,
      mediaType: mediaType(role),
      byteCount: role === "input.step"
        ? this.#step.byteLength
        : role === "request.json"
        ? requestBytes.byteLength
        : role === "result.json"
        ? resultBytes.byteLength
        : 0,
      sha256: role === "input.step"
        ? this.#candidate.fixture.step.sha256
        : role === "request.json"
        ? requestSha256
        : role === "result.json"
        ? resultSha256
        : emptyDigest,
    }));
  }
  #run(requestId: string) {
    const input = this.#resources[0]!;
    return {
      schemaVersion: "2.0",
      state: "completed",
      runId: RUN_ID,
      requestId,
      requestSha256: this.#requestSha256,
      inputArtifact: {
        uri: input.uri,
        mimeType: input.mediaType,
        sha256: input.sha256,
        bytes: input.byteCount,
      },
      createdAt: "2026-09-08T00:00:00.000Z",
      artifacts: this.#resources.map((resource) => ({
        name: resource.role,
        uri: resource.uri,
        mimeType: resource.mediaType,
        bytes: resource.byteCount,
        sha256: resource.sha256,
      })),
    };
  }
}

function resultJson(stepSha256: string, stepBytes: number, displacementMm: number) {
  return {
    schemaVersion: "2.0",
    kind: "static-solve-recorded",
    inputArtifact: {
      uri: `casys://calculix/runs/${RUN_ID}/input.step`,
      mimeType: "model/step",
      sha256: stepSha256,
      bytes: stepBytes,
    },
    mesh: { nodes: 4, elements: 1, nodesPerSelection: {} },
    constraints: {
      fixedSelections: ["FIXED"],
      loads: [{ selection: "LOADED", forceN: [0, 0, -500] }],
    },
    metrics: {
      maxDisplacement: {
        value: displacementMm,
        unit: "mm",
        nodeId: 1,
        vectorMm: [0, 0, -displacementMm],
      },
      maxVonMises: { value: 12, unit: "MPa", elementId: 1 },
    },
  };
}
function mediaType(role: string): string {
  return role === "input.step"
    ? "model/step"
    : role === "request.json" || role === "result.json"
    ? "application/json"
    : "text/plain";
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
