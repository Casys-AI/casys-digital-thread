/** Durable append-only record of one exact capability-runtime rollover. */

import type {
  CapabilityRuntimeRolloverAdvanceInput,
  CapabilityRuntimeRolloverIdentity,
  CapabilityRuntimeRolloverKey,
  CapabilityRuntimeRolloverSaga,
} from "../../../../domain/capability/runtime/capability-runtime-rollover-saga.ts";

export interface CapabilityRuntimeRolloverSagaStore {
  read(
    key: CapabilityRuntimeRolloverKey,
  ): Promise<CapabilityRuntimeRolloverSaga | undefined>;
  prepare(
    identity: CapabilityRuntimeRolloverIdentity,
  ): Promise<CapabilityRuntimeRolloverSaga>;
  advance(
    identity: CapabilityRuntimeRolloverIdentity,
    input: CapabilityRuntimeRolloverAdvanceInput,
  ): Promise<CapabilityRuntimeRolloverSaga>;
}
