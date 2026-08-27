import { assertEquals } from "@std/assert";
import type { ProjectSourceAttachmentDeclaredAgainst } from "../../../domain/project-source-workspace/types.ts";
import { verifiedArchitectureNavigationFixture } from "../../architecture/renderer/capture-product-structure-traversal_test.ts";
import { DeclaredAgainstCadPlacementArchitectureIndex } from "./declared-against-cad-placement-architecture-index.ts";

Deno.test(
  "placement architecture index recrosses owner, immediate usages and typed_by from the declared snapshot",
  async () => {
    const fixture = await verifiedArchitectureNavigationFixture();
    const index = new DeclaredAgainstCadPlacementArchitectureIndex(
      {
        get: (id) =>
          Promise.resolve(id === fixture.snapshot.id ? fixture.snapshot : undefined),
      },
      fixture.reader,
      fixture.sourceAnalysis,
    );
    const facts = await index.open(declaredAgainst(fixture));
    assertEquals(facts?.ownerDefinitionId("alpha-use-001"), "sys-def-001");
    assertEquals(facts?.immediateUsageIds("sys-def-001"), ["alpha-use-001"]);
    assertEquals(facts?.typedDefinitionId("alpha-use-001"), "alpha-def-001");
  },
);

Deno.test(
  "placement architecture index stays closed on an exact Thread snapshot mismatch",
  async () => {
    const fixture = await verifiedArchitectureNavigationFixture();
    const contacts = { latest: 0 };
    const index = new DeclaredAgainstCadPlacementArchitectureIndex(
      {
        get: (id) => {
          if (id.toLowerCase() === "latest") {
            contacts.latest += 1;
            throw new Error("must not resolve latest");
          }
          return Promise.resolve(
            id === fixture.snapshot.id ? fixture.snapshot : undefined,
          );
        },
      },
      fixture.reader,
      fixture.sourceAnalysis,
    );
    const basis = declaredAgainst(fixture);
    assertEquals(
      await index.open({
        ...basis,
        thread: { ...basis.thread, snapshotId: "thread:missing" },
      }),
      undefined,
    );
    assertEquals(
      await index.open({
        ...basis,
        thread: { ...basis.thread, revision: 99 },
      }),
      undefined,
    );
    assertEquals(
      await index.open({
        ...basis,
        thread: { ...basis.thread, subjectId: "subject.foreign" },
      }),
      undefined,
    );
    assertEquals(
      await index.open({
        ...basis,
        thread: { ...basis.thread, snapshotId: "latest" },
      }),
      undefined,
    );
    assertEquals(contacts.latest, 0);
    assertEquals(
      await index.open({
        ...basis,
        architecture: {
          ...basis.architecture,
          artifactId: "architecture-foreign",
        },
      }),
      undefined,
    );
  },
);

Deno.test(
  "placement architecture index cannot resolve without verified source analyses",
  async () => {
    const fixture = await verifiedArchitectureNavigationFixture();
    const basis = declaredAgainst(fixture);
    const snapshots = {
      get: (id: string) =>
        Promise.resolve(id === fixture.snapshot.id ? fixture.snapshot : undefined),
    };
    const missing = new DeclaredAgainstCadPlacementArchitectureIndex(
      snapshots,
      fixture.reader,
      {
        reopen: () =>
          Promise.reject(new Error("SysML source analysis is not readable.")),
      },
    );
    assertEquals(await missing.open(basis), undefined);

    const unverified = new DeclaredAgainstCadPlacementArchitectureIndex(
      snapshots,
      fixture.reader,
      {
        reopen: (value) =>
          Promise.resolve({
            reference: { ...(value as object), runId: "run:foreign" },
          } as never),
      },
    );
    assertEquals(await unverified.open(basis), undefined);
  },
);

function declaredAgainst(
  fixture: Awaited<ReturnType<typeof verifiedArchitectureNavigationFixture>>,
): ProjectSourceAttachmentDeclaredAgainst {
  return {
    thread: {
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    },
    architecture: {
      artifactId: `architecture-${fixture.fingerprint.digest}`,
      fingerprint: fixture.fingerprint,
      captureSchema: "architecture-capture/4.0",
    },
  };
}
