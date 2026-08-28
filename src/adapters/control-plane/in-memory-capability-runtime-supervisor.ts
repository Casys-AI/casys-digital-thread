/** In-memory test adapters for capability-runtime supervision contracts. */

import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  type CapabilityRuntimeMaterialIdentity,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeAdministrativeRemovalPlan,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  AuthorizedCapabilityRuntimeHostMutation,
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
  CapabilityRuntimeLeaseClaim,
  CapabilityRuntimeLeaseStore,
  CapabilityRuntimeStateObserver,
  ProjectCapabilityRuntimeContext,
  ProjectCapabilityRuntimeContextReader,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";

export class InMemoryProjectCapabilityRuntimeContextReader
  implements ProjectCapabilityRuntimeContextReader {
  #contexts = new Map<string, ProjectCapabilityRuntimeContext>();

  set(projectSnapshotId: string, context: ProjectCapabilityRuntimeContext): void {
    this.#contexts.set(projectSnapshotId, structuredClone(context));
  }

  async read(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityRuntimeContext> {
    const context = this.#contexts.get(project.id);
    if (!context) {
      throw new Error(`No capability runtime context exists for ${project.id}.`);
    }
    return structuredClone(context);
  }
}

export class InMemoryCapabilityRuntimeStateObserver
  implements CapabilityRuntimeStateObserver {
  #states = new Map<string, CapabilityRuntimeObservedState>();

  set(
    material: CapabilityRuntimeMaterialIdentity,
    state: CapabilityRuntimeObservedState,
  ): void {
    this.#states.set(capabilityRuntimeMaterialKey(material), structuredClone(state));
  }

  async observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    return new Map(
      materials.flatMap((material) => {
        const state = this.#states.get(capabilityRuntimeMaterialKey(material));
        return state
          ? [[capabilityRuntimeMaterialKey(material), structuredClone(state)] as const]
          : [];
      }),
    );
  }
}

export class InMemoryCapabilityRuntimeJournal implements CapabilityRuntimeJournal {
  #entries: CapabilityRuntimeJournalEntry[] = [];
  #outcomes: CapabilityRuntimeJournalOutcome[] = [];

  async appendBeforeMutation(entry: CapabilityRuntimeJournalEntry): Promise<void> {
    if (this.#entries.some((candidate) => candidate.id === entry.id)) {
      throw new Error(`Capability runtime journal entry ${entry.id} already exists.`);
    }
    this.#entries.push(structuredClone(entry));
  }

  async list(): Promise<readonly CapabilityRuntimeJournalEntry[]> {
    return structuredClone(this.#entries);
  }

  async appendOutcome(outcome: CapabilityRuntimeJournalOutcome): Promise<void> {
    if (
      this.#outcomes.some((candidate) =>
        candidate.journalEntryId === outcome.journalEntryId
      )
    ) {
      throw new Error(
        `Capability runtime journal outcome ${outcome.journalEntryId} already exists.`,
      );
    }
    this.#outcomes.push(structuredClone(outcome));
  }

  async listOutcomes(): Promise<readonly CapabilityRuntimeJournalOutcome[]> {
    return structuredClone(this.#outcomes);
  }
}

export class InMemoryCapabilityRuntimeLeaseStore
  implements CapabilityRuntimeLeaseStore {
  #leases = new Map<string, CapabilityRuntimeLease>();

  async claim(lease: CapabilityRuntimeLease): Promise<CapabilityRuntimeLeaseClaim> {
    const existing = this.#leases.get(lease.id);
    if (existing) {
      return { status: "existing", lease: structuredClone(existing) };
    }
    this.#leases.set(lease.id, structuredClone(lease));
    return { status: "created", lease: structuredClone(lease) };
  }

  async read(leaseId: string): Promise<CapabilityRuntimeLease | undefined> {
    const lease = this.#leases.get(leaseId);
    return lease ? structuredClone(lease) : undefined;
  }

  async release(leaseId: string): Promise<void> {
    this.#leases.delete(leaseId);
  }

  async listActive(at: string): Promise<readonly CapabilityRuntimeLease[]> {
    return [...this.#leases.values()]
      .filter((lease) => lease.expiresAt > at)
      .map((lease) => structuredClone(lease))
      .toSorted((left, right) => left.id.localeCompare(right.id));
  }
}

/** Test-only host boundary; records call order but performs no host mutation. */
export class InMemoryCapabilityRuntimeHostMutator
  implements CapabilityRuntimeHostMutator {
  readonly calls: {
    entry: CapabilityRuntimeJournalEntry;
    removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
  }[] = [];

  async mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
    readonly removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry;
    this.calls.push(structuredClone({
      entry,
      ...(input.removalPlan ? { removalPlan: input.removalPlan } : {}),
    }));
    return {
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: entry.plannedAt,
      status: "succeeded",
      observation: null,
      detail: null,
    };
  }
}
