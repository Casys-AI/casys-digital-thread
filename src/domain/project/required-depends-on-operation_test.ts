import { assertEquals } from "@std/assert";
import { engineeringActivityIdFromRootRevision } from "./engineering-activity.ts";
import {
  collectRequiredDependsOnOperationIssues,
  type RequiredDependsOnOperationRevision,
  resolveRequiredDependsOnOperation,
} from "./required-depends-on-operation.ts";

const REQUIRED = { id: "verify.seal-example", version: "1" };
const PLANNED = {
  id: "analyze.evaluate-example",
  version: "1",
  requiresDependsOnOperation: REQUIRED,
};

Deno.test(
  "a named successor of the required operation is accepted while a superseded revision remains",
  () => {
    const root = revision("work-seal");
    const successor = revision("work-seal-r2", {
      activityId: root.activityId,
      predecessorRevisionId: root.id,
    });
    const otherActivity = revision("work-other-seal");
    const planned = {
      id: "work-eval",
      dependsOnWorkItemIds: [successor.id],
    };

    assertEquals(
      resolveRequiredDependsOnOperation(
        planned,
        PLANNED,
        [otherActivity, successor, root],
      ),
      { status: "resolved", selected: successor },
    );
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        planned,
        PLANNED,
        [otherActivity, successor, root],
      ),
      [],
    );
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        planned,
        PLANNED,
        [root, otherActivity, successor],
      ),
      collectRequiredDependsOnOperationIssues(
        planned,
        PLANNED,
        [successor, otherActivity, root],
      ),
    );
  },
);

Deno.test(
  "a successor of the required-operation revision may still name that predecessor",
  () => {
    const root = revision("work-seal");
    const successor = {
      id: "work-seed",
      activityId: root.activityId,
      predecessorRevisionId: root.id,
      operation: { id: "architecture.seed-example", version: "2" },
    };

    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: successor.id, dependsOnWorkItemIds: [root.id] },
        {
          id: "architecture.seed-example",
          version: "2",
          requiresDependsOnOperation: REQUIRED,
        },
        [successor, root],
      ),
      [],
    );
  },
);

Deno.test(
  "a single required-operation revision remains accepted when named",
  () => {
    const only = revision("work-seal");
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: "work-eval", dependsOnWorkItemIds: [only.id] },
        PLANNED,
        [only],
      ),
      [],
    );
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: "work-eval", dependsOnWorkItemIds: [] },
        { id: PLANNED.id, version: PLANNED.version },
        [only],
      ),
      [],
    );
    assertEquals(
      resolveRequiredDependsOnOperation(
        { id: "work-eval", dependsOnWorkItemIds: [] },
        { id: PLANNED.id, version: PLANNED.version },
        [only],
      ),
      undefined,
    );
  },
);

Deno.test(
  "missing selected match, two selected matches and unknown dependency fail closed",
  () => {
    const root = revision("work-seal");
    const successor = revision("work-seal-r2", {
      activityId: root.activityId,
      predecessorRevisionId: root.id,
    });
    const unrelated = {
      id: "work-unrelated",
      activityId: engineeringActivityIdFromRootRevision("work-unrelated"),
      operation: { id: "design.write-example", version: "1" },
    };

    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: "work-eval", dependsOnWorkItemIds: [] },
        PLANNED,
        [root],
      )[0]?.code,
      "missing_selected_match",
    );
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: "work-eval", dependsOnWorkItemIds: [unrelated.id] },
        PLANNED,
        [root, unrelated],
      )[0]?.message.includes("must depend on verify.seal-example@1 work item"),
      true,
    );
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: "work-eval", dependsOnWorkItemIds: [successor.id, root.id] },
        PLANNED,
        [root, successor],
      ),
      [{
        code: "multiple_selected_matches",
        message: "Operation analyze.evaluate-example@1 must depend on the unique " +
          "verify.seal-example@1 work item. Found 2: work-seal, work-seal-r2.",
      }],
    );
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: "work-eval", dependsOnWorkItemIds: ["work-missing"] },
        PLANNED,
        [root],
      ),
      [{
        code: "unknown_dependency",
        message: "Operation analyze.evaluate-example@1 depends on unknown work item " +
          "work-missing.",
      }],
    );
  },
);

Deno.test(
  "a stale non-leaf required-operation dependency fails closed",
  () => {
    const root = revision("work-seal");
    const successor = revision("work-seal-r2", {
      activityId: root.activityId,
      predecessorRevisionId: root.id,
    });

    assertEquals(
      collectRequiredDependsOnOperationIssues(
        { id: "work-eval", dependsOnWorkItemIds: [root.id] },
        PLANNED,
        [successor, root],
      ),
      [{
        code: "stale_non_leaf_dependency",
        message:
          "Operation analyze.evaluate-example@1 must depend on the current leaf " +
          "revision of verify.seal-example@1 activity " +
          `${root.activityId}. Work item ${root.id} is not a leaf; current leaves: ` +
          `${successor.id}.`,
      }],
    );
  },
);

Deno.test(
  "multiple current leaves of the required activity fail closed without inferring a winner",
  () => {
    const root = revision("work-seal");
    const branchA = revision("work-seal-branch-a", {
      activityId: root.activityId,
      predecessorRevisionId: root.id,
    });
    const branchB = revision("work-seal-branch-b", {
      activityId: root.activityId,
      predecessorRevisionId: root.id,
    });
    const planned = {
      id: "work-eval",
      dependsOnWorkItemIds: [branchB.id],
    };

    assertEquals(
      collectRequiredDependsOnOperationIssues(
        planned,
        PLANNED,
        [branchB, root, branchA],
      ),
      [{
        code: "ambiguous_activity",
        message: "Operation analyze.evaluate-example@1 cannot depend on " +
          `verify.seal-example@1 work item ${branchB.id} because activity ` +
          `${root.activityId} has multiple current leaf revisions: ` +
          `${branchA.id}, ${branchB.id}.`,
      }],
    );
    assertEquals(
      collectRequiredDependsOnOperationIssues(
        planned,
        PLANNED,
        [root, branchA, branchB],
      ),
      collectRequiredDependsOnOperationIssues(
        planned,
        PLANNED,
        [branchB, branchA, root],
      ),
    );
  },
);

function revision(
  id: string,
  options: {
    readonly activityId?: string;
    readonly predecessorRevisionId?: string;
  } = {},
): RequiredDependsOnOperationRevision {
  return {
    id,
    activityId: options.activityId ?? engineeringActivityIdFromRootRevision(id),
    ...(options.predecessorRevisionId
      ? { predecessorRevisionId: options.predecessorRevisionId }
      : {}),
    operation: REQUIRED,
  };
}
