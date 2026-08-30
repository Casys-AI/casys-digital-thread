/**
 * Purpose-specific H1 authority for the one SysON rollover host mutation.
 *
 * This intentionally mirrors the normal runtime host-mutation boundary while
 * staying separate from its one-group journal: a rollover names two exact
 * topologies and cannot safely be represented as an ordinary group action.
 */

import {
  assertCapabilityRuntimeRolloverIdentity,
  type CapabilityRuntimeRolloverIdentity,
  capabilityRuntimeRolloverKeyFor,
} from "../../domain/capability/runtime/capability-runtime-rollover-saga.ts";
import type {
  AuthorizedCapabilityRuntimeRolloverHostMutation,
} from "../ports/out/capability/capability-runtime-rollover-host.ts";
import type { CapabilityRuntimeRolloverSagaStore } from "../ports/out/capability/capability-runtime-rollover-saga-store.ts";

type RolloverHostAction = "successor-material-acquire" | "successor-runtime-start";

interface AuthorizedRolloverMutation {
  readonly identity: CapabilityRuntimeRolloverIdentity;
  readonly action: RolloverHostAction;
}

const authorizations = new WeakMap<
  AuthorizedCapabilityRuntimeRolloverHostMutation,
  AuthorizedRolloverMutation
>();

export async function authorizeDurableRolloverSuccessorMaterialAcquire(
  identity: CapabilityRuntimeRolloverIdentity,
  sagas: CapabilityRuntimeRolloverSagaStore,
): Promise<AuthorizedCapabilityRuntimeRolloverHostMutation> {
  return await authorize(
    identity,
    sagas,
    "successor-material-acquire",
    "intent-recorded",
  );
}

export async function authorizeDurableRolloverSuccessorRuntimeStart(
  identity: CapabilityRuntimeRolloverIdentity,
  sagas: CapabilityRuntimeRolloverSagaStore,
): Promise<AuthorizedCapabilityRuntimeRolloverHostMutation> {
  return await authorize(
    identity,
    sagas,
    "successor-runtime-start",
    "successor-material-observed",
  );
}

/** Adapter-only consumption: a capability cannot be replayed after one call. */
export function consumeAuthorizedRolloverSuccessorMaterialAcquire(
  value: AuthorizedCapabilityRuntimeRolloverHostMutation,
): CapabilityRuntimeRolloverIdentity {
  return consume(value, "successor-material-acquire");
}

/** Adapter-only consumption: a capability cannot be replayed after one call. */
export function consumeAuthorizedRolloverSuccessorRuntimeStart(
  value: AuthorizedCapabilityRuntimeRolloverHostMutation,
): CapabilityRuntimeRolloverIdentity {
  return consume(value, "successor-runtime-start");
}

async function authorize(
  identity: CapabilityRuntimeRolloverIdentity,
  sagas: CapabilityRuntimeRolloverSagaStore,
  action: RolloverHostAction,
  expectedPhase: "intent-recorded" | "successor-material-observed",
): Promise<AuthorizedCapabilityRuntimeRolloverHostMutation> {
  const saga = await sagas.read(capabilityRuntimeRolloverKeyFor(identity));
  if (!saga) {
    throw new Error(
      "Capability runtime rollover host mutation requires one durable intent.",
    );
  }
  assertCapabilityRuntimeRolloverIdentity(saga, identity);
  if (saga.phase !== expectedPhase) {
    throw new Error(
      `Capability runtime rollover ${action} requires exact phase ${expectedPhase}.`,
    );
  }
  const authorization = {} as AuthorizedCapabilityRuntimeRolloverHostMutation;
  authorizations.set(authorization, { identity, action });
  return authorization;
}

function consume(
  value: AuthorizedCapabilityRuntimeRolloverHostMutation,
  expectedAction: RolloverHostAction,
): CapabilityRuntimeRolloverIdentity {
  const authorized = authorizations.get(value);
  authorizations.delete(value);
  if (!authorized || authorized.action !== expectedAction) {
    throw new Error(
      "Capability runtime rollover host mutation authorization is absent or consumed.",
    );
  }
  return authorized.identity;
}
