import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { createEngineeringProjectCommandRuntime } from "../project/engineering-project-command-runtime.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "../shared/stores/live-thread-update-store.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { ArchitectureSysmlSourceAnalysisCaptureService } from "./agent-seal/architecture-sysml-source-analysis-capture.ts";
import { ModelSealArchitectureSysmlRunExecutor } from "./agent-seal/model-seal-architecture-sysml-run-executor.ts";
import { ModelCapturePartDefinitionsRunExecutor } from "./part-definitions/model-capture-part-definitions-run-executor.ts";
import { ModelWriteArchitectureRunExecutor } from "./renderer/model-write-architecture-run-executor.ts";
import { SysmlSourceAnalysisCaptureService } from "./renderer/sysml-source-analysis-capture.ts";
import { ModelWriteRequirementsRunExecutor } from "./requirements/model-write-requirements-run-executor.ts";
import { ModelRecaptureRequirementsRunExecutor } from "./requirements/model-recapture-requirements-run-executor.ts";
import { PrepareProjectRequirementsRecaptureReview } from "./requirements/capture-backed-requirements-recapture-reviewer.ts";
import {
  createArchitectureFoundation,
  createArchitectureProject,
} from "./server-composition.ts";
import { SysonModelSeedRunExecutor } from "./seed/syson-model-seed-run-executor.ts";
import { passthroughCapabilityRuntimeConnection } from "../../testing/capability-runtime-execution-session-test-support.ts";
import { testReopenAgentResource } from "../../testing/agent-resource-test-support.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../application/ports/out/mcp-tool-client.ts";
import type { CapabilityRuntimeBoundMcpClient } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import { CapabilityRuntimeConnectionError } from "../../application/ports/out/capability/capability-runtime-connection.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../control-plane/first-party-capability-binding-catalog.ts";
import { createFirstPartyCapabilityRuntimeLaunchGroups } from "../control-plane/first-party-capability-runtime-launch-groups.ts";
import { InMemoryCapabilityRuntimeLeaseStore } from "../control-plane/in-memory-capability-runtime-supervisor.ts";
import { createLocalFixedCapabilityRuntimeConnection } from "../control-plane/local-fixed-capability-runtime-connection.ts";
import { capabilityRuntimeLaunchGroupReference } from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { CapabilityRuntimeLease } from "../../domain/capability/runtime/capability-runtime-supervision.ts";

Deno.test("architecture composition seals without SysON and writes only through the lease-bound runtime connection", async () => {
  const root = await Deno.makeTempDir({
    prefix: "casys-architecture-composition-",
  });
  try {
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const runtime = await createEngineeringProjectCommandRuntime({
      activeDirectory: `${root}/projects`,
      evidenceSnapshots: snapshots,
    });
    const foundation = createArchitectureFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      sourceAnalysisCaptures: new FileCaptureStore({
        kind: "source-analysis",
        directory: `${root}/source-analysis`,
        uriNamespace: "source-analysis",
        label: "Source analysis",
      }),
      sysmlSourceCaptureDirectory: `${root}/sysml`,
      sysonModelSeedCaptureDirectory: `${root}/seed`,
      architectureCaptureDirectory: `${root}/architecture`,
      requirementsCaptureDirectory: `${root}/requirements`,
      resources: testReopenAgentResource(`${root}/agent-resources`),
    });
    const shared = {
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots,
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      liveUpdates: new FileLiveThreadUpdateStore(`${root}/live`),
      foundation,
      sysonModelSeedAttemptDirectory: `${root}/seed-attempts`,
      architectureAttemptDirectory: `${root}/architecture-attempts`,
      partDefinitionsCaptureDirectory: `${root}/part-defs`,
      partDefinitionsPublicationDirectory: `${root}/part-pubs`,
      requirementsAttemptDirectory: `${root}/requirements-attempts`,
      requirementsRecapturePublicationDirectory: `${root}/requirements-recapture-pubs`,
    };
    const withoutSyson = createArchitectureProject(shared);
    assertInstanceOf(
      withoutSyson.modelSealArchitectureSysml,
      ModelSealArchitectureSysmlRunExecutor,
    );
    assertInstanceOf(
      withoutSyson.requirementsRecaptureReview,
      PrepareProjectRequirementsRecaptureReview,
    );
    assertEquals(withoutSyson.genericModelWriteArchitecture, undefined);
    assertEquals(withoutSyson.genericModelWriteRequirements, undefined);
    assertEquals(withoutSyson.genericModelCapturePartDefinitions, undefined);
    assertEquals(withoutSyson.genericModelRecaptureRequirements, undefined);
    assertEquals(withoutSyson.sysonModelSeed, undefined);

    const withConnection = createArchitectureProject({
      ...shared,
      sysonRuntimeConnection: passthroughCapabilityRuntimeConnection(
        new CompositionSeedSyson(),
      ),
      sysonInspectRuntimeConnection: passthroughCapabilityRuntimeConnection(
        new CompositionSeedSyson(),
      ),
    });
    assertInstanceOf(
      withConnection.genericModelWriteArchitecture,
      ModelWriteArchitectureRunExecutor,
    );
    assertInstanceOf(
      withConnection.genericModelWriteRequirements,
      ModelWriteRequirementsRunExecutor,
    );
    assertInstanceOf(
      withConnection.genericModelCapturePartDefinitions,
      ModelCapturePartDefinitionsRunExecutor,
    );
    assertInstanceOf(
      withConnection.genericModelRecaptureRequirements,
      ModelRecaptureRequirementsRunExecutor,
    );
    assertInstanceOf(
      withConnection.modelSealArchitectureSysml,
      ModelSealArchitectureSysmlRunExecutor,
    );
    assertInstanceOf(withConnection.sysonModelSeed, SysonModelSeedRunExecutor);

    assertInstanceOf(
      foundation.sysmlSourceAnalysis,
      SysmlSourceAnalysisCaptureService,
    );
    assertInstanceOf(
      foundation.architectureSysmlSourceAnalysis,
      ArchitectureSysmlSourceAnalysisCaptureService,
    );
    const probe = { algorithm: "sha256" as const, digest: "0".repeat(64) };
    assertEquals(
      foundation.requirementsCaptures.uriFor(probe),
      `casys://requirements-capture/sha256/${probe.digest}`,
    );

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
    assertEquals(source.includes("HttpMcpToolClient"), false);
    assertEquals(source.includes("sysonMcpUrl"), false);
    assertEquals(
      source.split("capabilityRuntimeConnection: sysonRuntimeConnection")
        .length - 1,
      3,
    );
    assertEquals(
      source.split("capabilityRuntimeConnection: sysonInspectRuntimeConnection")
        .length - 1,
      2,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

class CompositionSeedSyson implements McpToolClient {
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(new Error(`unused (${call.name})`));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    return Promise.reject(new Error(`unused (${call.name})`));
  }
}

const SYSON_FLEET_MCP_URL = "http://127.0.0.1:3009/mcp";
const SYSON_LEASE_NOW = "2026-08-30T12:00:00.000Z";

Deno.test(
  "architecture composition dispatches author and inspect SysON bindings separately and never falls back",
  async () => {
    const composition = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(
      composition.split("capabilityRuntimeConnection: sysonRuntimeConnection")
        .length - 1,
      3,
    );
    assertEquals(
      composition.split(
        "capabilityRuntimeConnection: sysonInspectRuntimeConnection",
      ).length - 1,
      2,
    );
    assertEquals(
      composition.includes("sysonInspectRuntimeConnection ?? sysonRuntimeConnection"),
      false,
    );
    assertEquals(
      composition.includes("sysonRuntimeConnection ?? sysonInspectRuntimeConnection"),
      false,
    );
    assertEquals(composition.includes("CreateConsoleServerOptions"), false);
    assertEquals(composition.includes("HttpMcpToolClient"), false);
    assertEquals(composition.includes("sysonMcpUrl"), false);

    const server = await Deno.readTextFile(
      new URL("../../../server.ts", import.meta.url),
    );
    assertEquals(server.includes('"syson-author-system"'), true);
    assertEquals(server.includes('"syson-inspect-system"'), true);
    assertEquals(server.includes("sysonInspectRuntimeConnection"), true);
    assertEquals(server.includes("?? sysonRuntimeConnection"), false);
    assertEquals(server.includes("?? sysonInspectRuntimeConnection"), false);

    const root = await Deno.makeTempDir({
      prefix: "casys-architecture-inspect-binding-",
    });
    try {
      const shared = await architectureShared(root);
      const author = passthroughCapabilityRuntimeConnection(
        new CompositionSeedSyson(),
      );
      const inspect = passthroughCapabilityRuntimeConnection(
        new CompositionSeedSyson(),
      );

      const authorOnly = createArchitectureProject({
        ...shared,
        sysonRuntimeConnection: author,
      });
      assertInstanceOf(authorOnly.sysonModelSeed, SysonModelSeedRunExecutor);
      assertInstanceOf(
        authorOnly.genericModelWriteArchitecture,
        ModelWriteArchitectureRunExecutor,
      );
      assertInstanceOf(
        authorOnly.genericModelWriteRequirements,
        ModelWriteRequirementsRunExecutor,
      );
      assertEquals(authorOnly.genericModelCapturePartDefinitions, undefined);
      assertEquals(authorOnly.genericModelRecaptureRequirements, undefined);

      const inspectOnly = createArchitectureProject({
        ...shared,
        sysonInspectRuntimeConnection: inspect,
      });
      assertEquals(inspectOnly.sysonModelSeed, undefined);
      assertEquals(inspectOnly.genericModelWriteArchitecture, undefined);
      assertEquals(inspectOnly.genericModelWriteRequirements, undefined);
      assertInstanceOf(
        inspectOnly.genericModelCapturePartDefinitions,
        ModelCapturePartDefinitionsRunExecutor,
      );
      assertInstanceOf(
        inspectOnly.genericModelRecaptureRequirements,
        ModelRecaptureRequirementsRunExecutor,
      );
      assertEquals(
        partDefinitionsRuntimeConnection(
          inspectOnly.genericModelCapturePartDefinitions,
        ) === inspect,
        true,
      );

      const both = createArchitectureProject({
        ...shared,
        sysonRuntimeConnection: author,
        sysonInspectRuntimeConnection: inspect,
      });
      assertInstanceOf(both.sysonModelSeed, SysonModelSeedRunExecutor);
      assertInstanceOf(
        both.genericModelWriteArchitecture,
        ModelWriteArchitectureRunExecutor,
      );
      assertInstanceOf(
        both.genericModelWriteRequirements,
        ModelWriteRequirementsRunExecutor,
      );
      assertInstanceOf(
        both.genericModelCapturePartDefinitions,
        ModelCapturePartDefinitionsRunExecutor,
      );
      assertInstanceOf(
        both.genericModelRecaptureRequirements,
        ModelRecaptureRequirementsRunExecutor,
      );
      assertEquals(
        partDefinitionsRuntimeConnection(both.genericModelCapturePartDefinitions),
        inspect,
      );
      assertEquals(
        partDefinitionsRuntimeConnection(
          both.genericModelCapturePartDefinitions,
        ) === author,
        false,
      );

      const routes = await sysonAuthorAndInspectRoutes();
      const routed = createArchitectureProject({
        ...shared,
        sysonRuntimeConnection: routes.author.bound,
        sysonInspectRuntimeConnection: routes.inspect.bound,
      });
      const wiredInspect = partDefinitionsRuntimeConnection(
        routed.genericModelCapturePartDefinitions!,
      );
      assertEquals(wiredInspect === routes.inspect.bound, true);
      assertEquals(wiredInspect === routes.author.bound, false);

      await routes.author.bound.broker.connect({
        lease: routes.lease,
        binding: routes.author.binding,
        launchGroup: routes.launchGroup,
      });
      await wiredInspect.broker.connect({
        lease: routes.lease,
        binding: routes.inspect.binding,
        launchGroup: routes.launchGroup,
      });
      await assertRejects(
        () =>
          routes.author.bound.broker.connect({
            lease: routes.lease,
            binding: routes.inspect.binding,
            launchGroup: routes.launchGroup,
          }),
        CapabilityRuntimeConnectionError,
        "exact trusted binding and launch group",
      );
      await assertRejects(
        () =>
          wiredInspect.broker.connect({
            lease: routes.lease,
            binding: routes.author.binding,
            launchGroup: routes.launchGroup,
          }),
        CapabilityRuntimeConnectionError,
        "exact trusted binding and launch group",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

async function architectureShared(root: string) {
  const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
  const runtime = await createEngineeringProjectCommandRuntime({
    activeDirectory: `${root}/projects`,
    evidenceSnapshots: snapshots,
  });
  const foundation = createArchitectureFoundation({
    recordedAnalysisDirectory: `${root}/analysis`,
    sourceAnalysisCaptures: new FileCaptureStore({
      kind: "source-analysis",
      directory: `${root}/source-analysis`,
      uriNamespace: "source-analysis",
      label: "Source analysis",
    }),
    sysmlSourceCaptureDirectory: `${root}/sysml`,
    sysonModelSeedCaptureDirectory: `${root}/seed`,
    architectureCaptureDirectory: `${root}/architecture`,
    requirementsCaptureDirectory: `${root}/requirements`,
    resources: testReopenAgentResource(`${root}/agent-resources`),
  });
  return {
    projects: runtime.projects,
    commands: runtime.commands,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${root}/leases`),
    liveUpdates: new FileLiveThreadUpdateStore(`${root}/live`),
    foundation,
    sysonModelSeedAttemptDirectory: `${root}/seed-attempts`,
    architectureAttemptDirectory: `${root}/architecture-attempts`,
    partDefinitionsCaptureDirectory: `${root}/part-defs`,
    partDefinitionsPublicationDirectory: `${root}/part-pubs`,
    requirementsAttemptDirectory: `${root}/requirements-attempts`,
    requirementsRecapturePublicationDirectory: `${root}/requirements-recapture-pubs`,
  };
}

function partDefinitionsRuntimeConnection(
  executor: ModelCapturePartDefinitionsRunExecutor,
): CapabilityRuntimeBoundMcpClient {
  const connection = (executor as unknown as {
    readonly d: {
      readonly capabilityRuntimeConnection?: CapabilityRuntimeBoundMcpClient;
    };
  }).d.capabilityRuntimeConnection;
  if (connection === undefined) {
    throw new Error(
      "PartDefinitions executor is missing its bound runtime connection.",
    );
  }
  return connection;
}

async function sysonAuthorAndInspectRoutes() {
  const leases = new InMemoryCapabilityRuntimeLeaseStore();
  const groups = await createFirstPartyCapabilityRuntimeLaunchGroups();
  const group = groups.find((candidate) => candidate.id === "casys-syson");
  if (!group) throw new Error("casys-syson launch group is absent.");
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const authorBinding = requiredCatalogBinding(catalog, "syson-author-system");
  const inspectBinding = requiredCatalogBinding(catalog, "syson-inspect-system");
  const launchGroup = capabilityRuntimeLaunchGroupReference(group);
  const lease = await claimedLease(leases, {
    id: "capability-jit-syson-author-inspect",
    projectId: "project-review-demo",
    bindingIds: [authorBinding.id, inspectBinding.id],
    materialKeys: ["casys.syson-stack\u0000mcp-syson-image"],
    launchGroups: [launchGroup],
    acquiredAt: SYSON_LEASE_NOW,
    expiresAt: "2026-08-30T18:00:00.000Z",
  });
  const authorConnection = await createLocalFixedCapabilityRuntimeConnection({
    leases,
    binding: authorBinding,
    launchGroup: group,
    fleetMcpUrl: SYSON_FLEET_MCP_URL,
    now: () => SYSON_LEASE_NOW,
  });
  const inspectConnection = await createLocalFixedCapabilityRuntimeConnection({
    leases,
    binding: inspectBinding,
    launchGroup: group,
    fleetMcpUrl: SYSON_FLEET_MCP_URL,
    now: () => SYSON_LEASE_NOW,
  });
  return {
    lease,
    launchGroup,
    author: { bound: authorConnection.boundClient(), binding: authorBinding },
    inspect: {
      bound: inspectConnection.boundClient(),
      binding: inspectBinding,
    },
  };
}

function requiredCatalogBinding(
  catalog: {
    readonly bindings: readonly { readonly id: string; readonly version: string }[];
  },
  id: string,
): { readonly id: string; readonly version: string } {
  const matches = catalog.bindings.filter((binding) => binding.id === id);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one catalogue binding ${id}.`);
  }
  return { id: matches[0]!.id, version: matches[0]!.version };
}

async function claimedLease(
  leases: InMemoryCapabilityRuntimeLeaseStore,
  lease: CapabilityRuntimeLease,
): Promise<CapabilityRuntimeLease> {
  const claimed = await leases.claim(lease);
  return claimed.lease;
}
