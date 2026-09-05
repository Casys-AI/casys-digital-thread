/** In-memory test adapters for capability-runtime supervision contracts. */

import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  type CapabilityRuntimeLease,
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
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

  read(
    project: EngineeringProjectSnapshot,
  ): Promise<ProjectCapabilityRuntimeContext> {
    const context = this.#contexts.get(project.id);
    if (!context) {
      return Promise.reject(
        new Error(`No capability runtime context exists for ${project.id}.`),
      );
    }
    return Promise.resolve(structuredClone(context));
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

  observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    return Promise.resolve(
      new Map(
        materials.flatMap((material) => {
          const state = this.#states.get(capabilityRuntimeMaterialKey(material));
          return state
            ? [
              [capabilityRuntimeMaterialKey(material), structuredClone(state)] as const,
            ]
            : [];
        }),
      ),
    );
  }
}

export class InMemoryCapabilityRuntimeJournal implements CapabilityRuntimeJournal {
  #entries: CapabilityRuntimeJournalEntry[] = [];
  #outcomes: CapabilityRuntimeJournalOutcome[] = [];

  appendBeforeMutation(entry: CapabilityRuntimeJournalEntry): Promise<void> {
    if (this.#entries.some((candidate) => candidate.id === entry.id)) {
      return Promise.reject(
        new Error(`Capability runtime journal entry ${entry.id} already exists.`),
      );
    }
    this.#entries.push(structuredClone(entry));
    return Promise.resolve();
  }

  list(): Promise<readonly CapabilityRuntimeJournalEntry[]> {
    return Promise.resolve(structuredClone(this.#entries));
  }

  appendOutcome(outcome: CapabilityRuntimeJournalOutcome): Promise<void> {
    if (
      this.#outcomes.some((candidate) =>
        candidate.journalEntryId === outcome.journalEntryId
      )
    ) {
      return Promise.reject(
        new Error(
          `Capability runtime journal outcome ${outcome.journalEntryId} already exists.`,
        ),
      );
    }
    this.#outcomes.push(structuredClone(outcome));
    return Promise.resolve();
  }

  listOutcomes(): Promise<readonly CapabilityRuntimeJournalOutcome[]> {
    return Promise.resolve(structuredClone(this.#outcomes));
  }
}

export class InMemoryCapabilityRuntimeLeaseStore
  implements CapabilityRuntimeLeaseStore {
  #leases = new Map<string, CapabilityRuntimeLease>();

  claim(lease: CapabilityRuntimeLease): Promise<CapabilityRuntimeLeaseClaim> {
    const existing = this.#leases.get(lease.id);
    if (existing) {
      return Promise.resolve({
        status: "existing",
        lease: structuredClone(existing),
      });
    }
    this.#leases.set(lease.id, structuredClone(lease));
    return Promise.resolve({ status: "created", lease: structuredClone(lease) });
  }

  read(leaseId: string): Promise<CapabilityRuntimeLease | undefined> {
    const lease = this.#leases.get(leaseId);
    return Promise.resolve(lease ? structuredClone(lease) : undefined);
  }

  release(leaseId: string): Promise<void> {
    this.#leases.delete(leaseId);
    return Promise.resolve();
  }

  listActive(at: string): Promise<readonly CapabilityRuntimeLease[]> {
    return Promise.resolve(
      [...this.#leases.values()]
        .filter((lease) => lease.expiresAt > at)
        .map((lease) => structuredClone(lease))
        .toSorted((left, right) => left.id.localeCompare(right.id)),
    );
  }
}

/** Test-only host boundary; records call order but performs no host mutation. */
export class InMemoryCapabilityRuntimeHostMutator
  implements CapabilityRuntimeHostMutator {
  readonly calls: {
    entry: CapabilityRuntimeJournalEntry;
    removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
  }[] = [];

  mutate(input: {
    readonly authorization: AuthorizedCapabilityRuntimeHostMutation;
    readonly removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
  }): Promise<CapabilityRuntimeJournalOutcome> {
    const entry = input.authorization.entry;
    this.calls.push(structuredClone({
      entry,
      ...(input.removalPlan ? { removalPlan: input.removalPlan } : {}),
    }));
    return Promise.resolve({
      schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
      journalEntryId: entry.id,
      recordedAt: entry.plannedAt,
      status: "succeeded",
      observations: entry.materials.map((material) => ({ material, state: null })),
      detail: null,
    });
  }
}
