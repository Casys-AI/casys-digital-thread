/**
 * Narrow application boundary for a server-owned runtime preparation lease.
 *
 * A caller may begin preparation only for the exact project and registered
 * operation it already holds. The port deliberately exposes neither a lease
 * identity nor a runtime/provider detail.
 */

import type {
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";

export interface CapabilityRuntimePreparationSession {
  /** The draft was durably captured and reread. */
  releaseSuccess(): Promise<void>;
  /** A provider call may have dispatched, but its outcome is not certain. */
  retainForRecovery(): void;
}

export interface CapabilityRuntimePreparationSessionPort {
  begin(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<CapabilityRuntimePreparationSession>;
}

/**
 * Replay cleanup is deliberately separate from activation: it releases an
 * exact durable lease without starting a host runtime or provider.
 */
export interface CapabilityRuntimePreparationRecoveryPort {
  releaseRecorded(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly operation: EngineeringOperationRef;
  }): Promise<void>;
}

/** The canonical export path needs both preparation and replay cleanup. */
export type CapabilityRuntimePreparationPort =
  & CapabilityRuntimePreparationSessionPort
  & CapabilityRuntimePreparationRecoveryPort;
