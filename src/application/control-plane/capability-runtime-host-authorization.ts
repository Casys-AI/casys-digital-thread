/** One-use mutation capabilities created after a durable host intent. */

import type { CapabilityRuntimeJournalEntry } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { validateCapabilityRuntimeJournalEntry } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeJournal,
} from "../ports/out/capability/capability-runtime-supervisor.ts";

const pending = new WeakSet<AuthorizedCapabilityRuntimeHostMutation>();

/** @internal Runtime supervisors mint this only after a durable exact intent. */
export async function authorizeDurableCapabilityRuntimeHostMutation(
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
  const authorization = Object.freeze({
    entry: validateCapabilityRuntimeJournalEntry(entry),
  });
  pending.add(authorization);
  return authorization;
}

/** @internal Raw host adapters consume the capability before invoking Docker. */
export function consumeAuthorizedCapabilityRuntimeHostMutation(
  value: AuthorizedCapabilityRuntimeHostMutation,
): CapabilityRuntimeJournalEntry | undefined {
  if (!pending.delete(value)) return undefined;
  return value.entry;
}
