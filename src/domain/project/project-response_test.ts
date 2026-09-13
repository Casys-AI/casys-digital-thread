import { assertEquals, assertThrows } from "@std/assert";
import {
  parseProjectResponseBasis,
  PROJECT_RESPONSE_SCHEMA,
  projectResponseBasesEqual,
  unavailableProjectResponse,
} from "./project-response.ts";

const BASIS = {
  projectId: "project.response",
  projectRevision: 8,
  brief: {
    briefId: "project.response:brief",
    snapshotId: "brief:r7",
    revision: 7,
  },
  thread: {
    snapshotId: "thread:r3",
    revision: 3,
    subjectId: "subject.response",
  },
};

Deno.test("project-response basis parser accepts the exact current identity and refuses latest", () => {
  assertEquals(parseProjectResponseBasis(BASIS, "basis"), BASIS);
  assertEquals(
    parseProjectResponseBasis({
      projectId: BASIS.projectId,
      projectRevision: BASIS.projectRevision,
      brief: BASIS.brief,
    }, "basis"),
    {
      projectId: BASIS.projectId,
      projectRevision: BASIS.projectRevision,
      brief: BASIS.brief,
    },
  );
  assertThrows(
    () => parseProjectResponseBasis({ ...BASIS, projectId: "latest" }, "basis"),
    TypeError,
    "cannot use a latest alias",
  );
});

Deno.test("project-response basis equality is exact and does not mix a missing Thread", () => {
  assertEquals(projectResponseBasesEqual(BASIS, { ...BASIS }), true);
  assertEquals(
    projectResponseBasesEqual(BASIS, { ...BASIS, projectRevision: 9 }),
    false,
  );
  assertEquals(
    projectResponseBasesEqual(BASIS, {
      projectId: BASIS.projectId,
      projectRevision: BASIS.projectRevision,
      brief: BASIS.brief,
    }),
    false,
  );
});

Deno.test("unavailable project-response keeps grants none and empty items", () => {
  const result = unavailableProjectResponse();
  assertEquals(result.schemaVersion, PROJECT_RESPONSE_SCHEMA);
  assertEquals(result.status, "unavailable");
  assertEquals(result.items, []);
  assertEquals(result.grants, "none");
  assertEquals("pass" in result, false);
  assertEquals("coverage" in result, false);
});
