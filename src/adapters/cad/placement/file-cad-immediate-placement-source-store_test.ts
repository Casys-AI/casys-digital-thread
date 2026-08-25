import { assertEquals, assertRejects } from "@std/assert";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  FileCadImmediatePlacementSourceStore,
} from "./file-cad-immediate-placement-source-store.ts";
import { CadImmediatePlacementSourceStoreError } from "../../../application/ports/out/cad/placement/cad-immediate-placement-source-store.ts";

Deno.test("placement source store persists canonical bytes and refuses a provider field", async () => {
  const directory = await Deno.makeTempDir({ prefix: "place-src-" });
  try {
    const store = new FileCadImmediatePlacementSourceStore(
      new FileByteStore({
        kind: "cad-immediate-placement-source",
        directory,
        uriNamespace: "cad-immediate-placement-source",
        label: "CAD immediate placement source",
      }),
    );
    const persisted = await store.persist(JSON.stringify({
      placements: [{
        usageElementId: "usage-b",
        partDefinitionElementId: "def-rail",
        placement: { translationMm: [1, 0, 0], rotationDeg: [0, 0, 0] },
      }, {
        usageElementId: "usage-a",
        partDefinitionElementId: "def-rail",
        placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
      }],
      placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
      unitSystem: "mm",
      schemaVersion: "cad-immediate-placement-source/1.0",
    }));
    assertEquals(persisted.source.placements[0]?.usageElementId, "usage-a");
    const reopened = await store.reopen(persisted.fingerprint);
    assertEquals(reopened.sourceText, persisted.sourceText);

    await assertRejects(
      () =>
        store.persist(JSON.stringify({
          schemaVersion: "cad-immediate-placement-source/1.0",
          unitSystem: "mm",
          placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
          provider: "build123d",
          placements: [],
        })),
      CadImmediatePlacementSourceStoreError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
