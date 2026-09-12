import { assertEquals, assertRejects } from "@std/assert";
import { createBuyErpRuntimeComposition } from "./runtime-composition.ts";
import { ErpnextBuyCaptureClient } from "./erpnext-buy-capture-client.ts";
import { BuyCaptureConfigurationCostRunExecutor } from "./buy-capture-configuration-cost-run-executor.ts";
import { BUY_CANDIDATE_CAPTURE_URI_PREFIX } from "../../domain/buy/buy-candidate-capture.ts";
import { parseLocalErpnextBuyInstallationProfile } from "../control-plane/local-erpnext-buy-installation-profile.ts";
import {
  ERPNEXT_BUY_RUNTIME_ADAPTER_SOURCE,
  ERPNEXT_BUY_RUNTIME_BINDING_ID,
} from "../control-plane/local-erpnext-buy-installation-profile.ts";
import { createErpnextBuyRuntimeContribution } from "../control-plane/local-erpnext-buy-runtime-contribution.ts";
import { LocalErpnextBuyRuntimeSecretResolver } from "../control-plane/local-erpnext-buy-runtime-secret-resolver.ts";
import {
  InMemoryCapabilityRuntimeJournal,
  InMemoryCapabilityRuntimeLeaseStore,
  InMemoryCapabilityRuntimeStateObserver,
} from "../control-plane/in-memory-capability-runtime-supervisor.ts";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import { CapabilityRuntimeConnectionError } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import {
  BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
  ERPNEXT_BUY_CAPTURE_TOOL,
} from "../../domain/buy/buy-operations.ts";
import {
  BUY_FIXTURE_PARENT,
  BUY_FIXTURE_RESOURCE,
  BUY_FIXTURE_SITE,
  BUY_FIXTURE_STEP,
  buyConfigurationFixture,
  buyPricingContext,
} from "../../domain/buy/buy-fixtures.ts";
import { encodeBuyCaptureDecisionParameters } from "../../domain/buy/buy-proposal.ts";
import { validateBuyConfiguration } from "../../domain/buy/buy-configuration.ts";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ProjectCapabilityRuntimeContext } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeJournalEntry,
  CapabilityRuntimeJournalOutcome,
  CapabilityRuntimeLease,
  ResolvedCapabilityRuntimeOperation,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";

import type { CapabilityRuntimeSecretSnapshot } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { CapabilityRuntimeLaunchGroupSupervisor } from "../../application/control-plane/capability-runtime-launch-group-supervisor.ts";
import { CapabilityRuntimeExecutionSessionCoordinator } from "../../application/control-plane/capability-runtime-execution-session.ts";
import { FixedCapabilityRuntimeLaunchGroupRegistry } from "../../application/control-plane/capability-runtime-launch-group-registry.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { DESIGN_WRITE_GEOMETRY_TOOL } from "../../domain/cad/canonical/canonical-write-geometry-step.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";

const NOW = "2026-09-12T12:00:00.000Z";
const SYNTHETIC_DIGEST =
  "cafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe";
const WRONG_SITE =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const SYNTHETIC_SLOT_ID = "erpnext-buy-synthetic-api-key";
const SYNTHETIC_SLOT_ENV = "ERPNEXT_SYNTHETIC_API_KEY";
const SYNTHETIC_SLOT_VALUE = "synthetic-erp-slot-token-not-a-credential";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };
const FINGERPRINT = { algorithm: "sha256" as const, digest: "e".repeat(64) };

Deno.test("missing ERP Buy installation yields unresolved and zero MCP calls", async () => {
  const calls: string[] = [];
  const composition = await createBuyErpRuntimeComposition({
    contribution: undefined,
    contexts: {
      read: () => {
        throw new Error("contexts must not be read without an installation");
      },
    },
    launchGroups: {
      require: () => Promise.reject(new Error("unused")),
      list: () => Promise.resolve([]),
    },
    leases: new InMemoryCapabilityRuntimeLeaseStore(),
    fetch: ((input) => {
      calls.push(String(input));
      return Promise.reject(new Error("must not fetch"));
    }) as typeof fetch,
    now: () => NOW,
  });
  const resolution = await composition.bindings.resolve({
    project: {
      project: { id: "project-synthetic-erp" },
    } as EngineeringProjectSnapshot,
  });
  assertEquals(resolution.status, "unresolved");
  assertEquals(composition.capabilityRuntimeConnection, undefined);
  assertEquals(calls, []);
});

Deno.test("unauthorized or unqualified ERP Buy context yields unresolved and zero MCP", async () => {
  const fixture = await compositionFixture();
  const unauthorized = await createBuyErpRuntimeComposition({
    ...fixture.options,
    contexts: fakeContexts(fixture, { authorized: false, qualified: true }),
  });
  const unqualified = await createBuyErpRuntimeComposition({
    ...fixture.options,
    contexts: fakeContexts(fixture, { authorized: true, qualified: false }),
  });
  assertEquals(
    (await unauthorized.bindings.resolve({ project: fixture.project })).status,
    "unresolved",
  );
  assertEquals(
    (await unqualified.bindings.resolve({ project: fixture.project })).status,
    "unresolved",
  );
  assertEquals(fixture.calls, []);
});

Deno.test("exact synthetic qualified ERP Buy session opens the derived loopback and captures erpnext_buy_capture documents", async () => {
  const fixture = await compositionFixture();
  const composition = await createBuyErpRuntimeComposition({
    ...fixture.options,
    contexts: fakeContexts(fixture, { authorized: true, qualified: true }),
  });
  const resolution = await composition.bindings.resolve({
    project: fixture.project,
  });
  if (resolution.status !== "qualified") {
    throw new Error(resolution.reason);
  }
  assertEquals(resolution.binding.sourceInstance.siteId, BUY_FIXTURE_SITE);
  const handle = await composition.capabilityRuntimeConnection!.broker.connect({
    lease: fixture.lease,
    binding: fixture.binding,
    launchGroup: fixture.launchGroup,
  });
  const client = await composition.capabilityRuntimeConnection!.openMcpClient(
    handle,
  );
  const envelope = await new ErpnextBuyCaptureClient(client).capture([
    { doctype: "Item", name: "ITEM-SYNTHETIC-QUAL-001" },
  ]);
  assertEquals(fixture.calls.length, 1);
  assertEquals(fixture.calls[0]?.url, "http://127.0.0.1:3991/mcp");
  assertEquals(fixture.calls[0]?.tool, ERPNEXT_BUY_CAPTURE_TOOL);
  assertEquals(fixture.calls[0]?.arguments, {
    documents: [{ doctype: "Item", name: "ITEM-SYNTHETIC-QUAL-001" }],
  });
  assertEquals(envelope.capture.sourceInstance.siteId, BUY_FIXTURE_SITE);
  assertEquals("fleetMcpUrl" in fixture.options, false);
});

Deno.test("expired or mismatched ERP Buy lease refuses with zero transport", async () => {
  const fixture = await compositionFixture();
  const expired = await createBuyErpRuntimeComposition({
    ...fixture.options,
    now: () => "2026-09-13T00:00:00.000Z",
  });
  await assertRejects(
    () =>
      expired.capabilityRuntimeConnection!.broker.connect({
        lease: fixture.lease,
        binding: fixture.binding,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
  assertEquals(fixture.calls, []);

  const otherLeases = new InMemoryCapabilityRuntimeLeaseStore();
  const wrong = await createBuyErpRuntimeComposition({
    ...fixture.options,
    leases: otherLeases,
  });
  await assertRejects(
    () =>
      wrong.capabilityRuntimeConnection!.broker.connect({
        lease: fixture.lease,
        binding: fixture.binding,
        launchGroup: fixture.launchGroup,
      }),
    CapabilityRuntimeConnectionError,
    "not bound to an active lease",
  );
  assertEquals(fixture.calls, []);
});

Deno.test("JIT Buy capture with a synthetic secret slot dispatches locked erpnext_buy_capture documents", async () => {
  const fixture = await jitExecutorFixture();
  const completed = await fixture.executor.execute(AGENT, fixture.command);
  assertEquals(completed.agentRuns[0]?.status, "completed");
  assertEquals(fixture.calls.length, 1);
  assertEquals(fixture.calls[0]?.url, "http://127.0.0.1:3991/mcp");
  assertEquals(fixture.calls[0]?.tool, ERPNEXT_BUY_CAPTURE_TOOL);
  assertEquals(fixture.calls[0]?.arguments, {
    documents: [{ doctype: "Item Price", name: "ITEM-PRICE-SYNTHETIC-001" }],
  });
  assertEquals(fixture.host.secretSnapshots.length, 1);
  assertEquals(
    JSON.stringify(fixture.host.secretSnapshots[0]).includes(
      SYNTHETIC_SLOT_VALUE,
    ),
    false,
  );
  assertEquals(fixture.captures.size, 1);
});

Deno.test("absent ERP secret snapshot fails before any MCP call", async () => {
  const fixture = await jitExecutorFixture({ secretValue: undefined });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "unavailable",
  );
  assertEquals(fixture.calls, []);
  assertEquals(fixture.host.secretSnapshots, []);
  assertEquals(fixture.captures.size, 0);
});

Deno.test("wrong authorized ERP site fails before any MCP call", async () => {
  const fixture = await jitExecutorFixture({ authorizedSite: WRONG_SITE });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "Authorized ERP site fingerprint does not match",
  );
  assertEquals(fixture.calls, []);
  assertEquals(fixture.host.secretSnapshots, []);
  assertEquals(fixture.captures.size, 0);
});

Deno.test("executor rejects a post-capture ERP site mismatch and publishes no candidate", async () => {
  const fixture = await jitExecutorFixture({ captureSite: WRONG_SITE });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "Capture sourceInstance does not match the authorized ERP site binding",
  );
  assertEquals(fixture.calls.length, 1);
  assertEquals(fixture.calls[0]?.tool, ERPNEXT_BUY_CAPTURE_TOOL);
  assertEquals(fixture.captures.size, 0);
  assertEquals(fixture.project.agentRuns[0]?.status, "failed");
});

async function compositionFixture(
  extras: { readonly captureSite?: string } = {},
) {
  const contribution = await createErpnextBuyRuntimeContribution(
    parseLocalErpnextBuyInstallationProfile(syntheticProfile()),
  );
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const binding = {
    id: ERPNEXT_BUY_RUNTIME_BINDING_ID,
    version: contribution.binding.version,
  };
  const launchGroup = capabilityRuntimeLaunchGroupReference(
    contribution.launchGroup,
  );
  const lease: CapabilityRuntimeLease = {
    id: "capability-jit-erpnext-buy-synthetic",
    projectId: "project-synthetic-erp",
    bindingIds: [binding.id],
    materialKeys: [
      `${contribution.unit.id}\u0000${contribution.profile.material.materialId}`,
    ],
    launchGroups: [launchGroup],
    acquiredAt: NOW,
    expiresAt: "2026-09-12T18:00:00.000Z",
  };
  await leases.claim(lease);
  const calls: Array<{
    readonly url: string;
    readonly tool: string;
    readonly arguments: unknown;
  }> = [];
  const wrapper = await captureWrapper(extras.captureSite ?? BUY_FIXTURE_SITE);
  const fetchImpl: typeof fetch = (input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      readonly method?: string;
      readonly params?: {
        readonly name?: string;
        readonly arguments?: unknown;
      };
    };
    calls.push({
      url: String(input),
      tool: String(body.params?.name ?? ""),
      arguments: body.params?.arguments,
    });
    return Promise.resolve(Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        content: [{ type: "text", text: "synthetic erp capture" }],
        structuredContent: wrapper,
      },
    }));
  };
  return {
    contribution,
    lease,
    binding,
    launchGroup,
    calls,
    project: {
      project: { id: "project-synthetic-erp" },
    } as EngineeringProjectSnapshot,
    options: {
      contribution,
      contexts: fakeContexts({ contribution }, {
        authorized: true,
        qualified: true,
      }),
      launchGroups: {
        require: () => Promise.resolve(contribution.launchGroup),
        list: () => Promise.resolve([contribution.launchGroup]),
      },
      leases,
      fetch: fetchImpl,
      now: () => NOW,
    },
  };
}

function fakeContexts(
  fixture: {
    readonly contribution: Awaited<
      ReturnType<typeof createErpnextBuyRuntimeContribution>
    >;
  },
  flags: { readonly authorized: boolean; readonly qualified: boolean },
): {
  read(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityRuntimeContext>;
} {
  const binding = {
    ...fixture.contribution.binding,
    qualification: flags.qualified ? "qualified" as const : "unqualified" as const,
  };
  return {
    read: (project) =>
      Promise.resolve({
        catalog: {
          schemaVersion: "capability-runtime-catalog/1.0",
          productionEligible: false,
          units: [fixture.contribution.unit],
          bindings: [binding],
        },
        authorization: flags.authorized
          ? {
            projectId: project.project.id,
            status: "authorized" as const,
            fingerprint: {
              algorithm: "sha256" as const,
              digest: "e".repeat(64),
            },
            allowedCapabilities: [{
              id: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id,
              version: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.version,
              use: "execution" as const,
              qualification: "qualified" as const,
            }],
            allowedUnits: [{
              id: fixture.contribution.unit.id,
              version: fixture.contribution.unit.version,
              manifestFingerprint: fixture.contribution.unit.manifestFingerprint,
            }],
            allowedBindings: [{
              capability: {
                id: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id,
                version: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.version,
                use: "execution" as const,
              },
              binding: {
                id: fixture.contribution.binding.id,
                version: fixture.contribution.binding.version,
              },
              adapter: fixture.contribution.binding.adapter,
              profile: null,
              unitIds: [fixture.contribution.unit.id],
              materials: [{
                unitId: fixture.contribution.unit.id,
                materialId: fixture.contribution.profile.material.materialId,
                imageDigest: SYNTHETIC_DIGEST,
              }],
            }],
          }
          : undefined,
        demand: {} as ProjectCapabilityRuntimeContext["demand"],
        plan: {} as ProjectCapabilityRuntimeContext["plan"],
        lock: {
          schemaVersion: "capability-runtime-admin-lock/1.0",
          units: [],
        },
      } as unknown as ProjectCapabilityRuntimeContext),
  };
}

function syntheticProfile(
  extras: {
    readonly secretSlots?: readonly Record<string, string>[];
    readonly security?: "reviewed" | "unknown";
  } = {},
): Record<string, unknown> {
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
      secretSlots: extras.secretSlots ?? [],
      readiness: {
        timeoutMs: 15_000,
        attemptTimeoutMs: 1_000,
        retryIntervalMs: 250,
      },
      security: extras.security ?? "unknown",
    },
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
  };
}

async function captureWrapper(
  siteId: string,
): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(
    new URL("./fixtures/buy-source-capture.wrapper.json", import.meta.url),
  );
  const wrapper = JSON.parse(text) as {
    capture: { sourceInstance: { siteId: string }; canonicalText?: string };
    canonicalText: string;
    byteCount: number;
    fingerprint: string;
  };
  if (siteId === BUY_FIXTURE_SITE) return wrapper as Record<string, unknown>;
  const canonicalText = wrapper.canonicalText.replaceAll(
    wrapper.capture.sourceInstance.siteId,
    siteId,
  );
  const capture = JSON.parse(canonicalText);
  const bytes = new TextEncoder().encode(canonicalText);
  const digest = await sha256Hex(bytes);
  return {
    ...wrapper,
    capture,
    canonicalText,
    byteCount: bytes.byteLength,
    fingerprint: `sha256:${digest}`,
  };
}

async function jitExecutorFixture(
  extras: {
    readonly secretValue?: string;
    readonly authorizedSite?: string;
    readonly captureSite?: string;
  } = {},
) {
  const contribution = await createErpnextBuyRuntimeContribution(
    parseLocalErpnextBuyInstallationProfile(syntheticProfile({
      security: "reviewed",
      secretSlots: [{
        id: SYNTHETIC_SLOT_ID,
        composeEnvironmentKey: SYNTHETIC_SLOT_ENV,
      }],
    })),
  );
  const secretValue = Object.hasOwn(extras, "secretValue")
    ? extras.secretValue
    : SYNTHETIC_SLOT_VALUE;
  const secrets = new LocalErpnextBuyRuntimeSecretResolver({
    profile: contribution.profile,
    group: capabilityRuntimeLaunchGroupReference(contribution.launchGroup),
    readValue: () => secretValue,
  });
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const states = new InMemoryCapabilityRuntimeStateObserver();
  for (const member of contribution.launchGroup.materials) {
    states.set(member.material, { material: "absent", runtime: "inactive" });
  }
  const host = new SyntheticErpHost(states);
  const registry = new FixedCapabilityRuntimeLaunchGroupRegistry([
    contribution.launchGroup,
  ]);
  const groups = new CapabilityRuntimeLaunchGroupSupervisor({
    groups: registry,
    journal: new InMemoryCapabilityRuntimeJournal(),
    leases,
    states,
    host,
    secrets,
    lock: { withLock: (operation) => operation() },
    now: () => NOW,
  });
  const calls: Array<{
    readonly url: string;
    readonly tool: string;
    readonly arguments: unknown;
  }> = [];
  const wrapper = await captureWrapper(extras.captureSite ?? BUY_FIXTURE_SITE);
  const compositionWithFetch = await createBuyErpRuntimeComposition({
    contribution,
    contexts: fakeContexts({ contribution }, {
      authorized: true,
      qualified: true,
    }),
    launchGroups: registry,
    leases,
    secrets,
    fetch: ((input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        readonly params?: {
          readonly name?: string;
          readonly arguments?: unknown;
        };
      };
      calls.push({
        url: String(input),
        tool: String(body.params?.name ?? ""),
        arguments: body.params?.arguments,
      });
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "synthetic erp capture" }],
          structuredContent: wrapper,
        },
      }));
    }) as typeof fetch,
    now: () => NOW,
  });
  const operational = operationalCapability(contribution);
  const projectFixture = await buyCaptureProject(
    extras.authorizedSite ?? BUY_FIXTURE_SITE,
  );
  const coordinator = new CapabilityRuntimeExecutionSessionCoordinator({
    contexts: fakeContexts({ contribution }, {
      authorized: true,
      qualified: true,
    }),
    leases,
    groups,
    hasAnyRemainingJitDemand: {
      hasAnyRemainingDemand: () => Promise.resolve(false),
    },
    now: () => NOW,
  });
  const executor = new BuyCaptureConfigurationCostRunExecutor({
    projects: storeFor(projectFixture.project),
    commands: new MemoryCommands(projectFixture.project),
    snapshots: projectFixture.snapshots,
    captures: projectFixture.captures,
    configurations: {
      read: () => Promise.resolve(projectFixture.configurationText),
    },
    bindings: compositionWithFetch.bindings,
    lease: { withLease: (_projectId, _scope, operation) => operation() },
    capabilityRuntime: {
      requireExecution: () => Promise.resolve(operational),
    },
    capabilityRuntimeSession: {
      begin: coordinator.begin.bind(coordinator),
      releaseRecorded: coordinator.releaseRecorded.bind(coordinator),
    },
    capabilityRuntimeConnection: compositionWithFetch.capabilityRuntimeConnection,
    erpInstallation: compositionWithFetch.installation,
    erpLaunchGroup: capabilityRuntimeLaunchGroupReference(
      contribution.launchGroup,
    ),
    capabilityRuntimeSecrets: compositionWithFetch.secrets,
  });
  return {
    executor,
    command: projectFixture.command,
    calls,
    host,
    captures: projectFixture.captures,
    project: projectFixture.project,
  };
}

function operationalCapability(
  contribution: Awaited<ReturnType<typeof createErpnextBuyRuntimeContribution>>,
): ResolvedCapabilityRuntimeOperation {
  const material = {
    unitId: contribution.unit.id,
    materialId: contribution.profile.material.materialId,
    imageDigest: SYNTHETIC_DIGEST,
  };
  const launchGroup = capabilityRuntimeLaunchGroupReference(
    contribution.launchGroup,
  );
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: PROJECT_ID,
    operation: {
      id: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
      version: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.version,
    },
    authorizationFingerprint: FINGERPRINT,
    demandFingerprint: FINGERPRINT,
    registryFingerprint: FINGERPRINT,
    bindings: [{
      capability: {
        id: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id,
        version: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.version,
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: {
        id: ERPNEXT_BUY_RUNTIME_BINDING_ID,
        version: contribution.binding.version,
      },
      effectiveQualification: "qualified",
      adapter: {
        id: contribution.binding.adapter.id,
        version: contribution.binding.adapter.version,
        source: ERPNEXT_BUY_RUNTIME_ADAPTER_SOURCE,
      },
      profile: null,
      materials: [material],
      runtimeModes: [{
        material,
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material,
        kind: "persistent-compose",
        launchGroup,
      }],
    }],
  };
}

class SyntheticErpHost {
  readonly secretSnapshots: CapabilityRuntimeSecretSnapshot[] = [];
  constructor(
    private readonly states: InMemoryCapabilityRuntimeStateObserver,
  ) {}

  mutate(input: {
    readonly authorization: { readonly entry: CapabilityRuntimeJournalEntry };
    readonly secretSnapshot?: CapabilityRuntimeSecretSnapshot;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry;
    if (input.secretSnapshot !== undefined) {
      this.secretSnapshots.push(input.secretSnapshot);
    }
    const state = entry.action === "material-acquire"
      ? { material: "installed" as const, runtime: "inactive" as const }
      : { material: "installed" as const, runtime: "active" as const };
    for (const material of entry.materials) {
      this.states.set(material, state);
    }
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

async function buyCaptureProject(authorizedSite: string) {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  const configurationDigest = (await sha256Fingerprint(configuration)).digest;
  const configurationText = deterministicJson(configuration);
  const parameters = encodeBuyCaptureDecisionParameters({
    configurationDigest,
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    schemaVersion: configuration.schemaVersion,
    projectId: PROJECT_ID,
    subjectId: SUBJECT_ID,
    configurationRevision: 1,
    basisSnapshotId: "snapshot.buy.r1",
    basisRevision: 1,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "ITEM-PRICE-SYNTHETIC-001" }],
    pricing: buyPricingContext(),
    authorizedSiteFingerprint: authorizedSite,
    providerTool: ERPNEXT_BUY_CAPTURE_TOOL,
  });
  const artifacts: ThreadArtifact[] = [
    {
      id: "artifact.brief",
      name: "Brief",
      kind: "document",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.brief",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: NOW,
        invalidatedByChangeIds: [],
      },
    },
    {
      id: `geometry-${BUY_FIXTURE_PARENT}`,
      name: "Geometry",
      kind: "cad-model",
      version: BUY_FIXTURE_PARENT,
      fingerprint: { algorithm: "sha256", digest: BUY_FIXTURE_PARENT },
      uri: `casys://geometry-capture/sha256/${BUY_FIXTURE_PARENT}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: DESIGN_WRITE_GEOMETRY_TOOL,
        runId: "run.geometry",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: NOW,
        invalidatedByChangeIds: [],
      },
    },
    {
      id: `cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
      name: "STEP",
      kind: "step",
      version: BUY_FIXTURE_STEP,
      fingerprint: { algorithm: "sha256", digest: BUY_FIXTURE_STEP },
      uri: `/api/thread/assets/${BUY_FIXTURE_STEP}.step`,
      mediaType: "model/step",
      producer: {
        serverId: "build123d-sandbox",
        tool: "build123d_export",
        runId: "run.geometry",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: NOW,
        invalidatedByChangeIds: [],
      },
    },
  ];
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.buy.r1",
    revision: 1,
    generatedAt: NOW,
    subject: {
      id: SUBJECT_ID,
      name: "Buy fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: { status: "fresh", changedAt: NOW, invalidatedByChangeIds: [] },
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: NOW,
      appliedAt: NOW,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Created the brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes",
      from: { kind: "change", id: "change.brief" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The applied change introduced the brief.",
    }],
    proposedActions: [],
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    id: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
    version: "1",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary: "Capture Buy costs.", parameters },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: "work.buy-capture",
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: "decision.buy-capture",
      inputFingerprint: decisionFingerprint,
    }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: NOW,
    project: {
      id: PROJECT_ID,
      name: "Buy fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Buy", statement: "Capture costs." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Buy evidence.",
      workItemIds: ["work.buy-capture"],
      requiredDecisionIds: ["decision.buy-capture"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.buy-capture",
      activityId: "activity:work.buy-capture",
      phaseId: "phase.industrialize",
      title: "Capture Buy costs.",
      description: "Capture Buy costs.",
      kind: "industrialize",
      operation,
      status: "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["decision.buy-capture"],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run.buy-capture",
      workItemId: "work.buy-capture",
      status: "queued",
      summary: "Capture Buy costs.",
      queuedAt: NOW,
      basis: runBasis,
      inputFingerprint: runFingerprint,
      evidenceRefs: [],
    }],
    decisions: [{
      id: "decision.buy-capture",
      phaseId: "phase.industrialize",
      title: "Capture Buy costs.",
      question: "Capture Buy costs?",
      status: "approved",
      requestedAt: NOW,
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: ["approval.buy-capture"],
      proposal: {
        summary: "Capture Buy costs.",
        parameters,
        proposedAt: NOW,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: "approval.buy-capture",
      decisionId: "decision.buy-capture",
      status: "approved",
      requestedAt: NOW,
      decidedAt: NOW,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Reviewed.",
      baseSnapshot: reviewBasis,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [],
    commandReceipts: [],
  } as unknown as EngineeringProjectSnapshot & { revision: number };
  const snapshots = new MemorySnapshots(basisSnapshot);
  const captures = new MemoryCaptures(BUY_CANDIDATE_CAPTURE_URI_PREFIX);
  return {
    project,
    snapshots,
    captures,
    configurationText,
    command: {
      commandId: "command.buy-capture",
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: NOW,
      runId: "run.buy-capture",
    },
  };
}

function storeFor(project: EngineeringProjectSnapshot) {
  return {
    get: () => Promise.resolve(project),
    getRevision: () => Promise.resolve(project),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
}

class MemorySnapshots {
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(snapshotId: string) {
    return Promise.resolve(this.#byId.get(snapshotId));
  }
  getFresh(snapshotId: string) {
    return this.get(snapshotId);
  }
  latest() {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class MemoryCaptures {
  readonly #byDigest = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  get size() {
    return this.#byDigest.size;
  }
  save(fingerprint: ContentFingerprint, text: string) {
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({
      uri: this.uriFor(fingerprint),
      path: `${fingerprint.digest}.json`,
    });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `${this.prefix}${fingerprint.digest}`;
  }
}

class MemoryCommands {
  constructor(
    readonly project: EngineeringProjectSnapshot & { revision: number },
  ) {}
  claimRun(
    origin: { readonly actorId: string },
    _command: { readonly runId: string },
  ) {
    const run = this.project.agentRuns.find((item) => item.status === "queued") ??
      this.project.agentRuns.at(-1)!;
    if (run.status === "queued") {
      (run as { status: string }).status = "running";
      (run as { startedAt?: string }).startedAt = NOW;
      (run as { claimedAt?: string }).claimedAt = NOW;
      (run as { claimedBy?: { id: string; origin: "agent" } }).claimedBy = {
        id: origin.actorId,
        origin: "agent",
      };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    const run = this.project.agentRuns.find((item) => item.status === "running") ??
      this.project.agentRuns.at(-1)!;
    (run as { status: string }).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  completeRun(
    _origin: { readonly actorId: string },
    command: {
      readonly runId: string;
      readonly resultSnapshot?: unknown;
      readonly evidenceRefs?: unknown;
    },
  ) {
    const run = this.project.agentRuns.find((item) => item.id === command.runId) ??
      this.project.agentRuns.at(-1)!;
    (run as { status: string }).status = "completed";
    (run as { completedAt?: string }).completedAt = NOW;
    (run as { resultSnapshot?: unknown }).resultSnapshot = command.resultSnapshot;
    (run as { evidenceRefs?: unknown }).evidenceRefs = command.evidenceRefs;
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  failRun(
    _origin: { readonly actorId: string },
    command: { readonly runId: string },
  ) {
    const run = this.project.agentRuns.find((item) => item.id === command.runId) ??
      this.project.agentRuns.at(-1)!;
    (run as { status: string }).status = "failed";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}

Deno.test("qualified ERP catalog cannot substitute the installed binding, adapter or units", async () => {
  const fixture = await compositionFixture();
  const context = await fakeContexts(fixture, { authorized: true, qualified: true })
    .read(fixture.project);
  const binding = context.catalog.bindings[0]!;
  const mutations = [
    { ...binding, version: "foreign-version" },
    { ...binding, adapter: { ...binding.adapter, id: "foreign-adapter" } },
    { ...binding, adapter: { ...binding.adapter, version: "foreign-version" } },
    { ...binding, adapter: { ...binding.adapter, source: "foreign-source" } },
    { ...binding, unitIds: [...binding.unitIds, "foreign-unit"] },
    { ...binding, profile: { id: "foreign-profile", version: "1", fingerprint: null } },
  ];
  for (const changed of mutations) {
    const composition = await createBuyErpRuntimeComposition({
      ...fixture.options,
      contexts: {
        read: () =>
          Promise.resolve({
            ...context,
            catalog: { ...context.catalog, bindings: [changed] },
          }),
      },
    });
    assertEquals(
      (await composition.bindings.resolve({ project: fixture.project })).status,
      "unresolved",
    );
  }
  assertEquals(fixture.calls, []);
});

Deno.test("qualified ERP rejects installed unit and full authorization substitutions without calls", async () => {
  const fixture = await compositionFixture();
  const context = await fakeContexts(fixture, { authorized: true, qualified: true })
    .read(fixture.project);
  const unit = context.catalog.units[0]!;
  const authorization = context.authorization!;
  const allowed = authorization.allowedBindings[0]!;
  const approvedUnit = authorization.allowedUnits[0]!;
  const foreignFingerprint = { algorithm: "sha256" as const, digest: "f".repeat(64) };
  const changedBindings = [
    { ...allowed, adapter: { ...allowed.adapter, id: "foreign-adapter" } },
    { ...allowed, adapter: { ...allowed.adapter, version: "foreign-version" } },
    { ...allowed, adapter: { ...allowed.adapter, source: "foreign-source" } },
    { ...allowed, profile: { id: "foreign-profile", version: "1", fingerprint: null } },
    { ...allowed, unitIds: [...allowed.unitIds, "foreign-unit"] },
    { ...allowed, materials: [] },
    {
      ...allowed,
      materials: [{
        ...allowed.materials[0]!,
        imageDigest: "sha256:" + "f".repeat(64),
      }],
    },
    {
      ...allowed,
      materials: [{ ...allowed.materials[0]!, materialId: "foreign-material" }],
    },
    { ...allowed, materials: [{ ...allowed.materials[0]!, unitId: "foreign-unit" }] },
  ];
  const changedContexts: ProjectCapabilityRuntimeContext[] = [
    ...[
      { ...unit, version: "foreign-version" },
      { ...unit, manifestFingerprint: foreignFingerprint },
    ].map((changed) => ({
      ...context,
      catalog: { ...context.catalog, units: [changed] },
    })),
    ...changedBindings.map((changed) => ({
      ...context,
      authorization: { ...authorization, allowedBindings: [changed] },
    })),
    ...[
      { ...approvedUnit, version: "foreign-version" },
      { ...approvedUnit, manifestFingerprint: foreignFingerprint },
    ].map((changed) => ({
      ...context,
      authorization: { ...authorization, allowedUnits: [changed] },
    })),
    { ...context, authorization: { ...authorization, projectId: "foreign-project" } },
    {
      ...context,
      authorization: {
        ...authorization,
        allowedBindings: [allowed, changedBindings[0]!],
      },
    },
    { ...context, authorization: { ...authorization, allowedUnits: [] } },
    {
      ...context,
      authorization: { ...authorization, allowedUnits: [approvedUnit, approvedUnit] },
    },
  ];
  for (const changed of changedContexts) {
    const composition = await createBuyErpRuntimeComposition({
      ...fixture.options,
      contexts: { read: () => Promise.resolve(changed) },
    });
    assertEquals(
      (await composition.bindings.resolve({ project: fixture.project })).status,
      "unresolved",
    );
  }
  assertEquals(fixture.calls, []);
});
