import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../engineering-project.ts";
import type { ThreadSnapshot } from "../../thread/thread-snapshot.ts";

export function allEvidenceRefs(
  project: EngineeringProjectSnapshot,
): Array<{ reference: EngineeringThreadEntityRef; path: string }> {
  const result: Array<{ reference: EngineeringThreadEntityRef; path: string }> = [];
  const add = (references: readonly EngineeringThreadEntityRef[], path: string) => {
    references.forEach((reference, index) =>
      result.push({ reference, path: `${path}[${index}]` })
    );
  };
  project.phases.forEach((item, index) =>
    add(item.evidenceRefs, `$.phases[${index}].evidenceRefs`)
  );
  project.workItems.forEach((item, index) =>
    add(item.evidenceRefs, `$.workItems[${index}].evidenceRefs`)
  );
  project.workItems.forEach((item, index) => {
    if (!item.reconciliation) return;
    add(
      item.reconciliation.successorEvidenceRefs,
      `$.workItems[${index}].reconciliation.successorEvidenceRefs`,
    );
  });
  project.agentRuns.forEach((item, index) =>
    add(item.evidenceRefs, `$.agentRuns[${index}].evidenceRefs`)
  );
  project.decisions.forEach((item, index) =>
    add(item.inputEvidenceRefs, `$.decisions[${index}].inputEvidenceRefs`)
  );
  project.approvals.forEach((item, index) =>
    add(item.inputEvidenceRefs, `$.approvals[${index}].inputEvidenceRefs`)
  );
  return result;
}

export function operationThreadEntityRefs(
  project: EngineeringProjectSnapshot,
): Array<{ reference: EngineeringThreadEntityRef; path: string }> {
  const result: Array<{ reference: EngineeringThreadEntityRef; path: string }> = [];
  project.workItems.forEach((item, workItemIndex) => {
    item.operation?.bindings.forEach((binding, bindingIndex) => {
      if (binding.source.kind !== "thread-entity") return;
      result.push({
        reference: binding.source.reference,
        path:
          `$.workItems[${workItemIndex}].operation.bindings[${bindingIndex}].source.reference`,
      });
    });
  });
  return result;
}

export function executionBindings(
  project: EngineeringProjectSnapshot,
): Array<{ baseSnapshot: EngineeringThreadSnapshotRef; path: string }> {
  const result: Array<{ baseSnapshot: EngineeringThreadSnapshotRef; path: string }> =
    [];
  project.agentRuns.forEach((item, index) => {
    if (item.baseSnapshot) {
      result.push({
        baseSnapshot: item.baseSnapshot,
        path: `$.agentRuns[${index}].baseSnapshot`,
      });
    }
    if (item.basis?.kind === "thread-snapshot") {
      result.push({
        baseSnapshot: item.basis,
        path: `$.agentRuns[${index}].basis`,
      });
    }
  });
  project.decisions.forEach((item, index) => {
    if (item.baseSnapshot) {
      result.push({
        baseSnapshot: item.baseSnapshot,
        path: `$.decisions[${index}].baseSnapshot`,
      });
    }
  });
  project.approvals.forEach((item, index) => {
    if (item.baseSnapshot) {
      result.push({
        baseSnapshot: item.baseSnapshot,
        path: `$.approvals[${index}].baseSnapshot`,
      });
    }
  });
  return result;
}

export function threadEntityExists(
  snapshot: ThreadSnapshot,
  reference: EngineeringThreadEntityRef,
): boolean {
  const ids = (items: readonly { id: string }[]) =>
    items.some((item) => item.id === reference.id);
  switch (reference.kind) {
    case "artifact":
      return ids(snapshot.artifacts);
    case "consumption":
      return ids(snapshot.consumptions);
    case "observation":
      return ids(snapshot.observations);
    case "requirement":
      return ids(snapshot.requirements);
    case "evaluation":
      return ids(snapshot.evaluations);
    case "violation":
      return ids(snapshot.violations);
    case "change":
      return ids(snapshot.changeSet.changes);
    case "action":
      return ids(snapshot.proposedActions);
  }
}

export function evidenceKey(reference: EngineeringThreadEntityRef): string {
  return `${
    snapshotKey(reference.snapshotId, reference.snapshotRevision)
  }\u0000${reference.kind}\u0000${reference.id}`;
}

export function snapshotKey(id: string, revision: number): string {
  return `${id}\u0000${revision}`;
}
