import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../../testing/workbench/generic-thread-workbench-fixture.ts";
import { readProductNavigationTechnicalAdmissionSources } from "./product-navigation-technical-admission-source-reader.ts";

const DIGEST = "a".repeat(64);

Deno.test("product-navigation admission reader ignores a lookalike document", async () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  snapshot.artifacts = [{
    ...snapshot.artifacts[0]!,
    id: `architecture-sysml-seal-${DIGEST}`,
    kind: "document",
    producedBy: "model.seal-architecture-sysml@1",
    uri: `casys://architecture-sysml-seal-capture/sha256/${DIGEST}`,
    fingerprint: `sha256:${DIGEST}`,
  }];
  let reads = 0;
  let workspaceLoads = 0;
  const files = await readProductNavigationTechnicalAdmissionSources(
    snapshot,
    {
      admissions: {
        read: () => {
          reads += 1;
          return Promise.resolve(undefined);
        },
      },
      workspace: {
        load: () => {
          workspaceLoads += 1;
          return Promise.reject(new Error("must not load"));
        },
        loadAtFresh: () => {
          workspaceLoads += 1;
          return Promise.reject(new Error("must not load"));
        },
      },
    },
    { projectId: "project.support" },
  );

  assertEquals(files, []);
  assertEquals(reads, 0);
  assertEquals(workspaceLoads, 0);
});

Deno.test("product-navigation admission reader fails closed on unreadable capture", async () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  snapshot.artifacts = [{
    ...snapshot.artifacts[0]!,
    id: `technical-compilation-admission-${DIGEST}`,
    kind: "document",
    producedBy: "compile.seal-admission@3",
    uri: `casys://technical-compilation-admission-capture/sha256/${DIGEST}`,
    fingerprint: `sha256:${DIGEST}`,
  }];
  let workspaceLoads = 0;
  const files = await readProductNavigationTechnicalAdmissionSources(
    snapshot,
    {
      admissions: { read: () => Promise.resolve("{") },
      workspace: {
        load: () => {
          workspaceLoads += 1;
          return Promise.reject(new Error("must not load"));
        },
        loadAtFresh: () => {
          workspaceLoads += 1;
          return Promise.reject(new Error("must not load"));
        },
      },
    },
    { projectId: "project.support" },
  );

  assertEquals(files, []);
  assertEquals(workspaceLoads, 0);
});
