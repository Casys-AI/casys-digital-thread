/** One-use, action-specific host-mutation capabilities after durable intent. */

import type {
  CapabilityRuntimeAdministrativeRemovalPlan,
  CapabilityRuntimeJournalEntry,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { validateCapabilityRuntimeJournalEntry } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeJournal,
} from "../ports/out/capability/capability-runtime-supervisor.ts";

const materialAcquire = new WeakSet<AuthorizedCapabilityRuntimeHostMutation>();
const normalRuntimeStart = new WeakSet<AuthorizedCapabilityRuntimeHostMutation>();
const qualificationRuntimeStart = new WeakSet<
  AuthorizedCapabilityRuntimeHostMutation
>();
const runtimeStop = new WeakSet<AuthorizedCapabilityRuntimeHostMutation>();
const administrativeRemoval = new WeakSet<AuthorizedCapabilityRuntimeHostMutation>();

async function durable(
  entry: CapabilityRuntimeJournalEntry,
  journal: CapabilityRuntimeJournal,
): Promise<AuthorizedCapabilityRuntimeHostMutation> {
  const matches = (await journal.list()).filter((candidate) =>
    candidate.id === entry.id
  );
  if (
    matches.length !== 1 || deterministicJson(matches[0]) !== deterministicJson(entry)
  ) {
    throw new Error(
      "Capability runtime mutation intent is not the exact durable journal entry.",
    );
  }
  if (
    (await journal.listOutcomes()).some((outcome) =>
      outcome.journalEntryId === entry.id
    )
  ) {
    throw new Error(
      "Capability runtime mutation intent already has a terminal outcome.",
    );
  }
  return Object.freeze({ entry: await validateCapabilityRuntimeJournalEntry(entry) });
}

/** @internal acquire needs topology only; it must never carry a start authority. */
export async function authorizeDurableMaterialAcquire(
  entry: CapabilityRuntimeJournalEntry,
  journal: CapabilityRuntimeJournal,
): Promise<AuthorizedCapabilityRuntimeHostMutation> {
  if (
    entry.action !== "material-acquire" ||
    entry.effectiveRuntimeProjection !== null ||
    entry.qualificationStartAuthority !== null
  ) {
    throw new Error(
      "Material acquisition requires a null-projection material-acquire intent.",
    );
  }
  const authorization = await durable(entry, journal);
  materialAcquire.add(authorization);
  return authorization;
}

/** @internal normal start is impossible without the exact persisted projection. */
export async function authorizeDurableNormalRuntimeStart(
  entry: CapabilityRuntimeJournalEntry,
  journal: CapabilityRuntimeJournal,
): Promise<AuthorizedCapabilityRuntimeHostMutation> {
  if (
    entry.action !== "runtime-start" ||
    entry.effectiveRuntimeProjection === null ||
    entry.qualificationStartAuthority !== null
  ) {
    throw new Error(
      "Normal runtime start requires its exact effective runtime projection.",
    );
  }
  const authorization = await durable(entry, journal);
  normalRuntimeStart.add(authorization);
  return authorization;
}

/** @internal qualification start is separately branded from every operation start. */
export async function authorizeDurableQualificationRuntimeStart(
  entry: CapabilityRuntimeJournalEntry,
  journal: CapabilityRuntimeJournal,
): Promise<AuthorizedCapabilityRuntimeHostMutation> {
  if (
    entry.action !== "runtime-qualification-start" ||
    entry.effectiveRuntimeProjection !== null ||
    entry.qualificationStartAuthority === null
  ) {
    throw new Error(
      "Qualification runtime start requires its exact private qualification authority and no ROP projection.",
    );
  }
  const authorization = await durable(entry, journal);
  qualificationRuntimeStart.add(authorization);
  return authorization;
}

/** @internal stop remains available for recovery after qualification/secret loss. */
export async function authorizeDurableRuntimeStop(
  entry: CapabilityRuntimeJournalEntry,
  journal: CapabilityRuntimeJournal,
): Promise<AuthorizedCapabilityRuntimeHostMutation> {
  if (
    entry.action !== "runtime-stop" ||
    entry.effectiveRuntimeProjection !== null ||
    entry.qualificationStartAuthority !== null
  ) {
    throw new Error("Runtime stop requires a null-projection runtime-stop intent.");
  }
  const authorization = await durable(entry, journal);
  runtimeStop.add(authorization);
  return authorization;
}

/** @internal removal remains tied to the independently reviewed exact plan. */
export async function authorizeDurableAdministrativeMaterialRemoval(
  entry: CapabilityRuntimeJournalEntry,
  plan: CapabilityRuntimeAdministrativeRemovalPlan,
  journal: CapabilityRuntimeJournal,
): Promise<AuthorizedCapabilityRuntimeHostMutation> {
  if (
    entry.action !== "material-remove" ||
    entry.effectiveRuntimeProjection !== null ||
    entry.qualificationStartAuthority !== null ||
    entry.administrativeRemovalPlanFingerprint?.digest !== plan.fingerprint.digest ||
    entry.administrativeRemovalPlanFingerprint?.algorithm !== plan.fingerprint.algorithm
  ) {
    throw new Error("Administrative removal requires its exact reviewed removal plan.");
  }
  const authorization = await durable(entry, journal);
  administrativeRemoval.add(authorization);
  return authorization;
}

/** @internal Raw host adapters consume exactly one purpose-specific capability. */
export function consumeAuthorizedMaterialAcquire(
  value: AuthorizedCapabilityRuntimeHostMutation,
): CapabilityRuntimeJournalEntry | undefined {
  return materialAcquire.delete(value) ? value.entry : undefined;
}

/** @internal Raw host adapters consume exactly one purpose-specific capability. */
export function consumeAuthorizedNormalRuntimeStart(
  value: AuthorizedCapabilityRuntimeHostMutation,
): CapabilityRuntimeJournalEntry | undefined {
  return normalRuntimeStart.delete(value) ? value.entry : undefined;
}

/** @internal Raw host adapters consume exactly one purpose-specific capability. */
export function consumeAuthorizedQualificationRuntimeStart(
  value: AuthorizedCapabilityRuntimeHostMutation,
): CapabilityRuntimeJournalEntry | undefined {
  return qualificationRuntimeStart.delete(value) ? value.entry : undefined;
}

/** @internal Raw host adapters consume exactly one purpose-specific capability. */
export function consumeAuthorizedRuntimeStop(
  value: AuthorizedCapabilityRuntimeHostMutation,
): CapabilityRuntimeJournalEntry | undefined {
  return runtimeStop.delete(value) ? value.entry : undefined;
}

/** @internal Raw host adapters consume exactly one purpose-specific capability. */
export function consumeAuthorizedAdministrativeMaterialRemoval(
  value: AuthorizedCapabilityRuntimeHostMutation,
): CapabilityRuntimeJournalEntry | undefined {
  return administrativeRemoval.delete(value) ? value.entry : undefined;
}
