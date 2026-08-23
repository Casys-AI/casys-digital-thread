import { assertEquals } from "@std/assert";
import {
  attemptIdsForRevision,
  collectEngineeringActivities,
  collectEngineeringActivityLifecycleIssues,
  engineeringActivityIdFromRootRevision,
  leafRevisionIdsForActivity,
  stampEngineeringActivityIdentity,
} from "./engineering-activity.ts";

Deno.test("a root revision receives a server-derived activity identity", () => {
  const { stamped, issues } = stampEngineeringActivityIdentity([], [{
    id: "wi-cad",
  }, {
    id: "wi-cad-copy",
  }]);

  assertEquals(issues, []);
  assertEquals(
    stamped.get("wi-cad")?.activityId,
    engineeringActivityIdFromRootRevision("wi-cad"),
  );
  assertEquals(
    stamped.get("wi-cad-copy")?.activityId,
    engineeringActivityIdFromRootRevision("wi-cad-copy"),
  );
  assertEquals(
    stamped.get("wi-cad")?.activityId === stamped.get("wi-cad-copy")?.activityId,
    false,
  );
});

Deno.test("a successor inherits the predecessor activity and rejects a missing predecessor", () => {
  const root = {
    id: "wi-cad",
    activityId: engineeringActivityIdFromRootRevision("wi-cad"),
  };
  const { stamped, issues } = stampEngineeringActivityIdentity([root], [{
    id: "wi-cad-v2",
    predecessorRevisionId: "wi-cad",
  }]);

  assertEquals(issues, []);
  assertEquals(stamped.get("wi-cad-v2"), {
    activityId: root.activityId,
    predecessorRevisionId: "wi-cad",
  });

  const missing = stampEngineeringActivityIdentity([root], [{
    id: "wi-cad-v3",
    predecessorRevisionId: "absent",
  }]);
  assertEquals(missing.issues[0]?.code, "unknown_predecessor");
});

Deno.test("self, cyclic and cross-activity predecessors are rejected", () => {
  const root = {
    id: "wi-a",
    activityId: engineeringActivityIdFromRootRevision("wi-a"),
  };
  const other = {
    id: "wi-b",
    activityId: engineeringActivityIdFromRootRevision("wi-b"),
  };

  assertEquals(
    stampEngineeringActivityIdentity([root], [{
      id: "wi-a2",
      predecessorRevisionId: "wi-a2",
    }]).issues[0]?.code,
    "self_predecessor",
  );

  const cyclic = stampEngineeringActivityIdentity([], [{
    id: "wi-x",
    predecessorRevisionId: "wi-y",
  }, {
    id: "wi-y",
    predecessorRevisionId: "wi-x",
  }]);
  assertEquals(
    cyclic.issues.some((issue) => issue.code === "forward_predecessor"),
    true,
  );

  const persisted = collectEngineeringActivityLifecycleIssues([{
    ...root,
    predecessorRevisionId: other.id,
  }, other]);
  assertEquals(persisted[0]?.code, "cross_activity_predecessor");
});

Deno.test("same operation on two roots stays two activities after shuffling", () => {
  const left = {
    id: "wi-fea-left",
    activityId: engineeringActivityIdFromRootRevision("wi-fea-left"),
  };
  const right = {
    id: "wi-fea-right",
    activityId: engineeringActivityIdFromRootRevision("wi-fea-right"),
  };
  const grouped = collectEngineeringActivities([right, left]);
  const shuffled = collectEngineeringActivities([left, right]);

  assertEquals(grouped.map((item) => item.id), shuffled.map((item) => item.id));
  assertEquals(grouped.map((item) => item.id), [
    engineeringActivityIdFromRootRevision("wi-fea-left"),
    engineeringActivityIdFromRootRevision("wi-fea-right"),
  ]);
});

Deno.test("an operation-version successor stays one activity with explicit branches", () => {
  const rootId = engineeringActivityIdFromRootRevision("wi-geom");
  const root = { id: "wi-geom", activityId: rootId };
  const v2 = {
    id: "wi-geom-v2",
    activityId: rootId,
    predecessorRevisionId: "wi-geom",
  };
  const branchA = {
    id: "wi-geom-branch-a",
    activityId: rootId,
    predecessorRevisionId: "wi-geom",
  };
  const branchB = {
    id: "wi-geom-branch-b",
    activityId: rootId,
    predecessorRevisionId: "wi-geom",
  };

  const grouped = collectEngineeringActivities([branchB, v2, root, branchA]);
  assertEquals(grouped.length, 1);
  assertEquals(grouped[0]?.revisionIds, [
    "wi-geom",
    "wi-geom-branch-a",
    "wi-geom-branch-b",
    "wi-geom-v2",
  ]);
});

Deno.test("leaf revisions are the explicit branch tips and shuffling does not invent a winner", () => {
  const rootId = engineeringActivityIdFromRootRevision("wi-geom");
  const root = { id: "wi-geom", activityId: rootId };
  const v2 = {
    id: "wi-geom-v2",
    activityId: rootId,
    predecessorRevisionId: "wi-geom",
  };
  const branchA = {
    id: "wi-geom-branch-a",
    activityId: rootId,
    predecessorRevisionId: "wi-geom",
  };
  const branchB = {
    id: "wi-geom-branch-b",
    activityId: rootId,
    predecessorRevisionId: "wi-geom",
  };

  assertEquals(leafRevisionIdsForActivity([root]), ["wi-geom"]);
  assertEquals(leafRevisionIdsForActivity([v2, root]), ["wi-geom-v2"]);
  assertEquals(
    leafRevisionIdsForActivity([branchB, v2, root, branchA]),
    ["wi-geom-branch-a", "wi-geom-branch-b", "wi-geom-v2"],
  );
  assertEquals(
    leafRevisionIdsForActivity([root, branchA, branchB, v2]),
    leafRevisionIdsForActivity([branchB, v2, root, branchA]),
  );
});

Deno.test("attempts stay bound to one revision and sort independently of array order", () => {
  const runs = [
    { id: "run-b", workItemId: "wi-cad" },
    { id: "run-a", workItemId: "wi-cad" },
    { id: "run-other", workItemId: "wi-other" },
  ];
  assertEquals(attemptIdsForRevision(runs, "wi-cad"), ["run-a", "run-b"]);
  assertEquals(
    attemptIdsForRevision([...runs].reverse(), "wi-cad"),
    ["run-a", "run-b"],
  );
});

Deno.test("a root cannot keep a caller-chosen activity identity", () => {
  const issues = collectEngineeringActivityLifecycleIssues([{
    id: "wi-cad",
    activityId: "activity:forged",
  }]);
  assertEquals(issues[0]?.code, "activity_identity_mismatch");
});
