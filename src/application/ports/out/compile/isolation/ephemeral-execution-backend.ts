import type {
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeProfileRef,
  IsolatedCodeRuntimeAttestation,
  IsolatedCodeTermination,
  IsolatedOutputProducerGeneration,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

/** Internal request presented to a selected ephemeral-execution backend. */
export interface EphemeralExecutionBackendRequest {
  readonly runId: string;
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly profile: IsolatedCodeProfileRef;
  readonly source: {
    readonly bytes: Uint8Array;
    readonly sha256: string;
  };
  readonly policy: IsolatedCodePolicyRef;
  readonly outputs: readonly IsolatedCodeOutputDeclaration[];
  readonly runtime: IsolatedCodeRuntimeAttestation;
}

export interface EphemeralExecutionLog {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

export interface EphemeralExecutionReport {
  /** Backend attestation; the broker compares it to the server-owned policy. */
  readonly runtime: {
    readonly isolationClass: string;
    readonly imageDigest: ContentFingerprint;
    readonly requestedLimits: IsolatedCodeRuntimeAttestation["requestedLimits"];
    readonly limitAssurance: IsolatedCodeRuntimeAttestation["limitAssurance"];
  };
  readonly termination: IsolatedCodeTermination;
  readonly logs: {
    readonly stdout: EphemeralExecutionLog;
    readonly stderr: EphemeralExecutionLog;
  };
}

export type EphemeralOutputKind =
  | "file"
  | "directory"
  | "symlink"
  | "hardlink"
  | "device"
  | "socket"
  | "other";

/**
 * Untrusted inventory metadata. Its size and digest are only claims until the
 * broker reads the bytes and computes both values outside the backend.
 */
export interface EphemeralOutputInventoryEntry<OutputHandle> {
  readonly handle: OutputHandle;
  readonly basename: string;
  readonly kind: EphemeralOutputKind;
  readonly claimedByteCount: number;
  readonly claimedSha256: string;
}

export type EphemeralExecutionDestruction =
  | {
    readonly status: "proven";
    readonly runId: string;
    readonly proofFingerprint: ContentFingerprint;
  }
  | {
    readonly status: "acknowledged-unattested";
    readonly runId: string;
    readonly acknowledgementFingerprint: ContentFingerprint;
  }
  | {
    readonly status: "unproven";
    readonly runId: string;
    readonly reason: string;
  };

/**
 * Technology-neutral driven port for one disposable execution environment.
 * Lease and output handles are adapter-owned generic types and never leave the
 * broker through its public `IsolatedCodeRunner` interface.
 */
export interface EphemeralExecutionBackend<Lease = unknown, OutputHandle = unknown> {
  create(request: EphemeralExecutionBackendRequest): Promise<Lease>;
  /**
   * Idempotently destroy every environment associated with this server-issued
   * run id. The broker calls this after `create` rejects because the rejection
   * may be a lost acknowledgement for an environment that was already
   * allocated. Calling it when no environment exists must remain safe.
   */
  destroyByRunId(runId: string): Promise<EphemeralExecutionDestruction>;
  execute(lease: Lease): Promise<EphemeralExecutionReport>;
  inventory(
    lease: Lease,
  ): Promise<readonly EphemeralOutputInventoryEntry<OutputHandle>[]>;
  /**
   * Read at most the supplied bound. An adapter must reject an output that does
   * not fit instead of allocating unbounded bytes; the broker still rechecks
   * the returned length and digest independently.
   */
  readOutput(
    lease: Lease,
    handle: OutputHandle,
    maximumBytesToRead: number,
  ): Promise<Uint8Array>;
  destroy(lease: Lease): Promise<EphemeralExecutionDestruction>;
}
