/** In-memory test adapters for capability-runtime supervision contracts. */

import {
  type CapabilityRuntimeJournalEntry,
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
  CapabilityRuntimeHostMutator,
  CapabilityRuntimeJournal,
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

  async appendBeforeMutation(entry: CapabilityRuntimeJournalEntry): Promise<void> {
    if (this.#entries.some((candidate) => candidate.id === entry.id)) {
      throw new Error(`Capability runtime journal entry ${entry.id} already exists.`);
    }
    this.#entries.push(structuredClone(entry));
  }

  async list(): Promise<readonly CapabilityRuntimeJournalEntry[]> {
    return structuredClone(this.#entries);
  }
}

export class InMemoryCapabilityRuntimeLeaseStore
  implements CapabilityRuntimeLeaseStore {
  #leases = new Map<string, CapabilityRuntimeLease>();

  async acquire(lease: CapabilityRuntimeLease): Promise<void> {
    if (this.#leases.has(lease.id)) {
      throw new Error(`Capability runtime lease ${lease.id} already exists.`);
    }
    this.#leases.set(lease.id, structuredClone(lease));
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
    readonly entry: CapabilityRuntimeJournalEntry;
    readonly removalPlan?: CapabilityRuntimeAdministrativeRemovalPlan;
  }): Promise<void> {
    this.calls.push(structuredClone(input));
  }
}
