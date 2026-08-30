import type {
  CapabilityRuntimeExecutionSession,
  CapabilityRuntimeExecutionSessionCoordinator,
} from "../application/control-plane/capability-runtime-execution-session.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../domain/capability/runtime/capability-runtime-supervision.ts";

export interface RecordingCapabilityRuntimeSession {
  readonly events: string[];
  readonly releases: number;
  readonly retains: number;
  begin: CapabilityRuntimeExecutionSessionCoordinator["begin"];
}

export function recordingCapabilityRuntimeSession(
  beginImpl?: CapabilityRuntimeExecutionSessionCoordinator["begin"],
): RecordingCapabilityRuntimeSession {
  const state = { events: [] as string[], releases: 0, retains: 0 };
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
    begin: beginImpl ?? (async (input) => {
      state.events.push("begin");
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
    }),
  };
}

export function testResolvedCapabilityRuntimeOperation(input: {
  readonly projectId: string;
  readonly operation: { readonly id: string; readonly version: string };
  readonly capabilityId: string;
}): ResolvedCapabilityRuntimeOperation {
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  const material = {
    unitId: "casys.syson-stack",
    materialId: "mcp-syson-image",
    imageDigest: "b".repeat(64),
  };
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
      binding: { id: `${input.capabilityId}-binding`, version: "1" },
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
      hostLifecycles: [{
        material,
        kind: "persistent-compose",
        launchGroup: {
          id: "casys-syson",
          version: "1.0.0",
          fingerprint,
        },
      }],
    }],
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
