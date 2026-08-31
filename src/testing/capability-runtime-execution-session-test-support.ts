import type {
  CapabilityRuntimeExecutionSession,
  CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeMicrosandboxExecutionProfile,
} from "../application/control-plane/capability-runtime-execution-session.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeBoundMcpClient,
  CapabilityRuntimeConnectionHandle,
} from "../application/ports/out/capability/capability-runtime-connection.ts";
import type { McpToolClient } from "../application/ports/out/mcp-tool-client.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../domain/capability/runtime/capability-runtime-supervision.ts";

export interface RecordingCapabilityRuntimeSession {
  readonly events: string[];
  readonly releases: number;
  readonly retains: number;
  readonly recordedReleases: number;
  readonly microsandboxExecutionProfiles:
    | readonly CapabilityRuntimeMicrosandboxExecutionProfile[]
    | undefined;
  begin: CapabilityRuntimeExecutionSessionCoordinator["begin"];
  releaseRecorded: CapabilityRuntimeExecutionSessionCoordinator["releaseRecorded"];
}

export function recordingCapabilityRuntimeSession(
  beginImpl?: CapabilityRuntimeExecutionSessionCoordinator["begin"],
): RecordingCapabilityRuntimeSession {
  const state = {
    events: [] as string[],
    releases: 0,
    retains: 0,
    recordedReleases: 0,
    microsandboxExecutionProfiles: undefined as
      | readonly CapabilityRuntimeMicrosandboxExecutionProfile[]
      | undefined,
  };
  return {
    get events() {
      return state.events;
    },
    get releases() {
      return state.releases;
    },
    get retains() {
      return state.retains;
    },
    get recordedReleases() {
      return state.recordedReleases;
    },
    get microsandboxExecutionProfiles() {
      return state.microsandboxExecutionProfiles;
    },
    begin: async (input) => {
      state.events.push("begin");
      state.microsandboxExecutionProfiles = input.microsandboxExecutionProfiles;
      if (beginImpl) return await beginImpl(input);
      await input.recheck();
      return {
        lease: { id: "capability-jit-test" } as CapabilityRuntimeExecutionSession[
          "lease"
        ],
        releaseTerminal: () => {
          state.releases++;
          return Promise.resolve();
        },
        retainForRecovery: () => {
          state.retains++;
        },
      };
    },
    releaseRecorded: () => {
      state.events.push("releaseRecorded");
      state.recordedReleases++;
      return Promise.resolve();
    },
  };
}

export function testResolvedCapabilityRuntimeOperation(input: {
  readonly projectId: string;
  readonly operation: { readonly id: string; readonly version: string };
  readonly capabilityId: string;
  readonly binding?: { readonly id: string; readonly version: string };
  readonly unitId?: string;
  readonly materialId?: string;
  readonly imageDigest?: string;
  readonly launchGroup?: CapabilityRuntimeLaunchGroupReference;
  readonly hostLifecycleKind?: "persistent-compose" | "ephemeral-microsandbox";
}): ResolvedCapabilityRuntimeOperation {
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  const material = {
    unitId: input.unitId ?? "casys.syson-stack",
    materialId: input.materialId ?? "mcp-syson-image",
    imageDigest: input.imageDigest ?? "b".repeat(64),
  };
  const hostLifecycleKind = input.hostLifecycleKind ?? "persistent-compose";
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId: input.projectId,
    operation: { id: input.operation.id, version: input.operation.version },
    authorizationFingerprint: fingerprint,
    demandFingerprint: fingerprint,
    registryFingerprint: fingerprint,
    bindings: [{
      capability: {
        id: input.capabilityId,
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: input.binding ?? { id: `${input.capabilityId}-binding`, version: "1" },
      effectiveQualification: "qualified",
      adapter: {
        id: "syson-architecture-adapter",
        version: "1.0.0",
        source: "server",
      },
      profile: null,
      materials: [material],
      runtimeModes: [{
        material,
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [
        hostLifecycleKind === "ephemeral-microsandbox"
          ? {
            material,
            kind: "ephemeral-microsandbox" as const,
            launchGroup: null,
          }
          : {
            material,
            kind: "persistent-compose" as const,
            launchGroup: input.launchGroup ?? {
              id: "casys-syson",
              version: "1.0.0",
              fingerprint,
            },
          },
      ],
    }],
  };
}

export function passthroughCapabilityRuntimeConnection(
  syson: McpToolClient,
  events?: string[],
): CapabilityRuntimeBoundMcpClient & {
  readonly opens: number;
} {
  const handles = new WeakSet<object>();
  const state = { opens: 0 };
  return {
    get opens() {
      return state.opens;
    },
    broker: {
      connect: () => {
        events?.push("connect");
        const handle = Object.freeze({}) as CapabilityRuntimeConnectionHandle;
        handles.add(handle);
        return Promise.resolve(handle);
      },
    },
    openMcpClient: (handle) => {
      events?.push("open");
      if (!handles.has(handle)) {
        return Promise.reject(
          new Error("unknown capability runtime connection handle"),
        );
      }
      state.opens++;
      return Promise.resolve(syson);
    },
  };
}

export function successfulCapabilityRuntimeFor(
  projectId: string,
  operation: { readonly id: string; readonly version: string },
  capabilityId: string,
): {
  readonly capabilityRuntime: CapabilityRuntimeExecutionEligibility;
  readonly capabilityRuntimeSession: RecordingCapabilityRuntimeSession;
} {
  const session = recordingCapabilityRuntimeSession();
  return {
    capabilityRuntime: {
      requireExecution: () =>
        Promise.resolve(testResolvedCapabilityRuntimeOperation({
          projectId,
          operation,
          capabilityId,
        })),
    },
    capabilityRuntimeSession: session,
  };
}
