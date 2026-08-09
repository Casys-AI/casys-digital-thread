import { assertEquals, assertRejects } from "@std/assert";
import {
  closeCoffeeMachineCm01V3R11,
  CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT,
  coffeeMachineCm01R12ReconciliationOperationPolicy,
} from "./close-coffee-machine-cm01-v3-r11.ts";
import {
  CM01_V3_FAILED_R2_WORK_ITEM_ID,
  CM01_V3_R12_REQUIREMENT_CLOSEOUT_EXTENSION_ID,
  CM01_V3_R3_RECOVERY_WORK_ITEM_ID,
  CM01_V3_SUBJECT_ID,
} from "../../src/domain/cm01/cm01-v3-r11-closeout.ts";
import { EngineeringProjectCommandError } from "../../src/domain/project/engineering-project-command-service.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../src/orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";

const FAILED_OPERATION_BINDINGS = [{
  name: "approvedBrief",
  source: { kind: "approved-brief" as const },
}, {
  name: "dripTrayHeightCorrection",
  source: {
    kind: "thread-entity" as const,
    reference: {
      id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record",
      kind: "artifact" as const,
      snapshotId:
        "project:coffee-machine-cm01-v3:r9:coffee-machine-cm01-v3-cad-r2-07d462b111ea4cfe36b2bf94749e3f3117e84554e5d6416bc85a08fad049231d-extension",
      snapshotRevision: 9,
    },
  },
}, {
  name: "revisedCadStep",
  source: {
    kind: "thread-entity" as const,
    reference: {
      id:
        "coffee-machine-cm01-v3-cad-r2-07d462b111ea4cfe36b2bf94749e3f3117e84554e5d6416bc85a08fad049231d-step",
      kind: "artifact" as const,
      snapshotId:
        "project:coffee-machine-cm01-v3:r9:coffee-machine-cm01-v3-cad-r2-07d462b111ea4cfe36b2bf94749e3f3117e84554e5d6416bc85a08fad049231d-extension",
      snapshotRevision: 9,
    },
  },
}] as const;
const SUCCESSOR_OPERATION_BINDINGS = [{
  name: "approvedBrief",
  source: { kind: "approved-brief" as const },
}, {
  name: "historicalMechanicalR3Result",
  source: {
    kind: "thread-entity" as const,
    reference: {
      id:
        "coffee-machine-cm01-v3-mechanical-r2-ec23ad25f52a9a467bfc8e8fa07e62ee8da1efb48c570c0554c1066b21d48297-solve",
      kind: "artifact" as const,
      snapshotId:
        "project:coffee-machine-cm01-v3:r10:coffee-machine-cm01-v3-mechanical-r2-ec23ad25f52a9a467bfc8e8fa07e62ee8da1efb48c570c0554c1066b21d48297-extension",
      snapshotRevision: 10,
    },
  },
}] as const;

Deno.test("CM-01 R11 closeout dry-run is inert before reading or creating local state", async () => {
  await withEmptyLocalRoot(async (root) => {
    const result = await closeCoffeeMachineCm01V3R11({
      projectDirectory: `${root}/projects`,
      snapshotDirectory: `${root}/snapshots`,
    });

    assertEquals(result.status, "confirmation-required");
    if (result.status !== "confirmation-required") {
      throw new Error("Dry-run unexpectedly attempted CM-01 closeout.");
    }
    assertEquals(
      result.acknowledgement,
      CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT,
    );
    await assertMissing(`${root}/projects`);
    await assertMissing(`${root}/snapshots`);
  });
});

Deno.test("CM-01 R11 closeout rejects a wrong acknowledgement without local writes", async () => {
  await withEmptyLocalRoot(async (root) => {
    await assertRejects(
      () =>
        closeCoffeeMachineCm01V3R11({
          execute: true,
          acknowledgement: "not-the-explicit-closeout-acknowledgement",
          projectDirectory: `${root}/projects`,
          snapshotDirectory: `${root}/snapshots`,
        }),
      Error,
      "Refusing CM-01 R11 closeout",
    );
    await assertMissing(`${root}/projects`);
    await assertMissing(`${root}/snapshots`);
  });
});

Deno.test("CM-01 R12 operation policy accepts only the exact pair with proven R12", async () => {
  const r12 = validR12Closeout();
  const policy = coffeeMachineCm01R12ReconciliationOperationPolicy(
    new OneSnapshotStore(r12),
  );
  const failed = COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30;
  const successor = COFFEE_MACHINE_CM01_V3_OPERATION_REFS
    .mechanicalDripTrayHeight30R3IdentityRecovery;
  const input = {
    failedWorkItemId: CM01_V3_FAILED_R2_WORK_ITEM_ID,
    failedOperation: { ...failed, bindings: FAILED_OPERATION_BINDINGS },
    successorWorkItemId: CM01_V3_R3_RECOVERY_WORK_ITEM_ID,
    successorOperation: { ...successor, bindings: SUCCESSOR_OPERATION_BINDINGS },
    successorRunSnapshot: {
      snapshotId: "project:coffee-machine-cm01-v3:r11:mechanical-r3-test",
      revision: 11,
      subjectId: CM01_V3_SUBJECT_ID,
    },
    successorSnapshot: {
      snapshotId: r12.id,
      revision: r12.revision,
      subjectId: r12.subject.id,
    },
  };

  await policy.authorize(input);
  await assertRejects(
    () =>
      policy.authorize({
        ...input,
        successorOperation: {
          id: "repair.unrelated-operation",
          version: "1",
          bindings: [],
        },
      }),
    EngineeringProjectCommandError,
    "authorizes only the exact",
  );
  await assertRejects(
    () =>
      policy.authorize({
        ...input,
        failedOperation: {
          ...input.failedOperation,
          bindings: input.failedOperation.bindings.map((binding) =>
            binding.name === "revisedCadStep"
              ? {
                ...binding,
                source: {
                  kind: "thread-entity" as const,
                  reference: {
                    ...FAILED_OPERATION_BINDINGS[2]!.source.reference,
                    id: "substituted-cad-step",
                  },
                },
              }
              : binding
          ),
        },
      }),
    EngineeringProjectCommandError,
    "authorizes only the exact",
  );
  await assertRejects(
    () =>
      policy.authorize({
        ...input,
        successorOperation: {
          ...input.successorOperation!,
          bindings: [
            ...input.successorOperation!.bindings,
            { name: "extra", source: { kind: "approved-brief" as const } },
          ],
        },
      }),
    EngineeringProjectCommandError,
    "authorizes only the exact",
  );

  const incompleteR12 = {
    ...r12,
    provenance: r12.provenance.filter((link) =>
      link.id !== "r3-displacement:supersedes:r1-displacement"
    ),
  } as ThreadSnapshot;
  const incompletePolicy = coffeeMachineCm01R12ReconciliationOperationPolicy(
    new OneSnapshotStore(incompleteR12),
  );
  await assertRejects(
    () => incompletePolicy.authorize(input),
    EngineeringProjectCommandError,
    "exact proven R12",
  );

  const alteredLinkR12 = {
    ...r12,
    provenance: r12.provenance.map((link) =>
      link.id === "r3-displacement:supersedes:r1-displacement"
        ? {
          ...link,
          to: { kind: "requirement" as const, id: "r2-displacement" },
          rationale: "A same-id but different closeout claim.",
        }
        : link
    ),
  } as ThreadSnapshot;
  const alteredLinkPolicy = coffeeMachineCm01R12ReconciliationOperationPolicy(
    new OneSnapshotStore(alteredLinkR12),
  );
  await assertRejects(
    () => alteredLinkPolicy.authorize(input),
    EngineeringProjectCommandError,
    "exact proven R12",
  );

  const wrongSnapshotIdPolicy = coffeeMachineCm01R12ReconciliationOperationPolicy(
    new WrongIdentitySnapshotStore({
      ...r12,
      id: "project:coffee-machine-cm01-v3:r12:foreign-content-id",
    }),
  );
  await assertRejects(
    () => wrongSnapshotIdPolicy.authorize(input),
    Error,
    "Exact declared ThreadSnapshot",
  );
});

class OneSnapshotStore implements ThreadSnapshotStore {
  constructor(private readonly snapshot: ThreadSnapshot) {}

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(snapshotId === this.snapshot.id ? this.snapshot : undefined);
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(
      subjectId === this.snapshot.subject.id ? this.snapshot : undefined,
    );
  }

  save(): Promise<void> {
    return Promise.resolve();
  }
}

class WrongIdentitySnapshotStore implements ThreadSnapshotStore {
  constructor(private readonly snapshot: ThreadSnapshot) {}

  get(): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.snapshot);
  }

  latest(): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.snapshot);
  }

  save(): Promise<void> {
    return Promise.resolve();
  }
}

function validR12Closeout(): ThreadSnapshot {
  const requirement = (id: string, metric: string, artifact: string) => ({
    id,
    criterion: {
      metric,
      operator: "<=",
      limit: {
        value: metric === "displacement" ? 1 : 20,
        unit: metric === "displacement" ? "mm" : "MPa",
      },
    },
    trace: {
      sourceArtifactId: `${artifact}-proof`,
      elementId: id,
      targetArtifactIds: [artifact],
    },
  });
  const evaluation = (requirementId: string, stale = false) => ({
    requirementId,
    status: "pass",
    freshness: stale
      ? {
        status: "stale",
        changedAt: "2026-08-03T12:00:00.000Z",
        reason: "corrected",
        invalidatedByChangeIds: [
          "coffee-machine-cm01-v3-drip-tray-height-28-to-30:applied",
        ],
      }
      : {
        status: "fresh",
        changedAt: "2026-08-03T13:00:00.000Z",
        invalidatedByChangeIds: [],
      },
  });
  const supersedes = (
    kind: "artifact" | "requirement",
    from: string,
    to: string,
    rationale = "fixture",
  ) => ({
    id: `${from}:supersedes:${to}`,
    relation: "supersedes",
    from: { kind, id: from },
    to: { kind, id: to },
    rationale,
  });

  return {
    id:
      `project:coffee-machine-cm01-v3:r12:${CM01_V3_R12_REQUIREMENT_CLOSEOUT_EXTENSION_ID}`,
    revision: 12,
    subject: { id: CM01_V3_SUBJECT_ID, name: "CoffeeMachine CM-01 V3" },
    requirements: [
      requirement("r1-displacement", "displacement", "r1-step"),
      requirement("r1-von-mises", "von-mises", "r1-step"),
      requirement("r2-displacement", "displacement", "r2-step"),
      requirement("r2-von-mises", "von-mises", "r2-step"),
      requirement("r3-displacement", "displacement", "r3-step"),
      requirement("r3-von-mises", "von-mises", "r3-step"),
    ],
    evaluations: [
      evaluation("r1-displacement", true),
      evaluation("r1-von-mises", true),
      evaluation("r2-displacement"),
      evaluation("r2-von-mises"),
      evaluation("r3-displacement"),
      evaluation("r3-von-mises"),
    ],
    provenance: [
      supersedes("artifact", "r3-step", "r2-step"),
      supersedes("artifact", "r2-step", "r1-step"),
      supersedes("requirement", "r3-displacement", "r2-displacement"),
      supersedes("requirement", "r3-von-mises", "r2-von-mises"),
      supersedes(
        "requirement",
        "r3-displacement",
        "r1-displacement",
        "The fresh R3 criterion and passing evaluation close the stale R1 criterion after the explicit 28 mm to 30 mm correction.",
      ),
      supersedes(
        "requirement",
        "r3-von-mises",
        "r1-von-mises",
        "The fresh R3 criterion and passing evaluation close the stale R1 criterion after the explicit 28 mm to 30 mm correction.",
      ),
    ],
  } as unknown as ThreadSnapshot;
}

async function withEmptyLocalRoot(
  test: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "cm01-r11-closeout-test-" });
  try {
    await test(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function assertMissing(path: string): Promise<void> {
  await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
}
