import { assertEquals, assertThrows } from "@std/assert";
import {
  isLatestSnapshotId,
  parseExactThreadSnapshotBasis,
  parseThreadSnapshotBasis,
  selectCurrentThreadTip,
} from "./thread-tip.ts";

Deno.test("current Thread tip is the unique maximum revision, not the list order", () => {
  const selected = selectCurrentThreadTip([
    { snapshotId: "snap-r2", revision: 2, subjectId: "subject" },
    { snapshotId: "snap-r5", revision: 5, subjectId: "subject" },
    { snapshotId: "snap-r4", revision: 4, subjectId: "subject" },
  ]);
  assertEquals(selected.status, "ok");
  if (selected.status !== "ok") return;
  assertEquals(selected.basis, {
    kind: "thread-snapshot",
    snapshotId: "snap-r5",
    revision: 5,
    subjectId: "subject",
  });
});

Deno.test("an empty Thread ledger is basis-absent, not latest", () => {
  const selected = selectCurrentThreadTip([]);
  assertEquals(selected.status, "unresolved");
  if (selected.status !== "unresolved") return;
  assertEquals(selected.diagnostic.code, "basis-absent");
});

Deno.test("two snapshots at the same max revision stay unresolved", () => {
  const selected = selectCurrentThreadTip([
    { snapshotId: "snap-a", revision: 3, subjectId: "subject" },
    { snapshotId: "snap-b", revision: 3, subjectId: "subject" },
  ]);
  assertEquals(selected.status, "unresolved");
  if (selected.status !== "unresolved") return;
  assertEquals(selected.diagnostic.code, "basis-ambiguous");
});

Deno.test("isLatestSnapshotId is case-insensitive", () => {
  assertEquals(isLatestSnapshotId("latest"), true);
  assertEquals(isLatestSnapshotId("LATEST"), true);
  assertEquals(isLatestSnapshotId("snap-r5"), false);
});

Deno.test("parseThreadSnapshotBasis accepts the closed snapshot shape including latest", () => {
  assertEquals(
    parseThreadSnapshotBasis({
      kind: "thread-snapshot",
      snapshotId: "latest",
      revision: 3,
      subjectId: "subject",
    }, "$basis"),
    {
      kind: "thread-snapshot",
      snapshotId: "latest",
      revision: 3,
      subjectId: "subject",
    },
  );
});

Deno.test("parseExactThreadSnapshotBasis refuses the latest alias", () => {
  assertThrows(
    () =>
      parseExactThreadSnapshotBasis({
        kind: "thread-snapshot",
        snapshotId: "latest",
        revision: 3,
        subjectId: "subject",
      }, "$basis"),
    TypeError,
    "must not use a latest alias",
  );
  assertEquals(
    parseExactThreadSnapshotBasis({
      kind: "thread-snapshot",
      snapshotId: "snap-r3",
      revision: 3,
      subjectId: "subject",
    }, "$basis"),
    {
      kind: "thread-snapshot",
      snapshotId: "snap-r3",
      revision: 3,
      subjectId: "subject",
    },
  );
});
