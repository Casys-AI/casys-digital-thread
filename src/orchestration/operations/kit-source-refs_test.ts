/**
 * A reviewed kit descriptor names repository-relative source files as
 * qualification evidence that the kit was inspected and bounded before it
 * reached the registry. A file moved without updating its sourceRef silently
 * breaks the qualification chain: the descriptor still claims a file exists,
 * but nothing on the critical path checks it. This suite pins every sourceRef
 * path to the filesystem so a rename fails here rather than at a run boundary,
 * and rejects paths that escape the repository root.
 */
import { assert } from "@std/assert";
import { listCoffeeMachineCm01V3EngineeringKits } from "./coffee-machine-cm01-v3-engineering-kits.ts";

/** Repository root resolved from the test file's own location. */
const REPO_ROOT = new URL("../../../", import.meta.url);

Deno.test(
  "every kit sourceRef path names a file that exists at its repository-relative location",
  async () => {
    const kits = listCoffeeMachineCm01V3EngineeringKits();
    for (const kit of kits) {
      for (const ref of kit.qualification.sourceRefs) {
        const resolved = new URL(ref.path, REPO_ROOT);
        try {
          await Deno.stat(resolved);
        } catch {
          throw new Error(
            `kit "${kit.kitId}" sourceRef path does not exist on disk: "${ref.path}". ` +
              `Either the file was moved without updating the kit descriptor, or the ` +
              `sourceRef path was never accurate. Update qualification.sourceRefs in ` +
              `src/orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts ` +
              `to reflect the current repository layout.`,
          );
        }
      }
    }
  },
);

Deno.test(
  "no kit sourceRef path escapes the repository via a relative traversal or an absolute filesystem path",
  () => {
    const kits = listCoffeeMachineCm01V3EngineeringKits();
    for (const kit of kits) {
      for (const ref of kit.qualification.sourceRefs) {
        assert(
          !ref.path.startsWith("/"),
          `kit "${kit.kitId}" sourceRef uses an absolute path: "${ref.path}". ` +
            `sourceRef paths must be repository-relative (no leading slash).`,
        );
        assert(
          !ref.path.includes(".."),
          `kit "${kit.kitId}" sourceRef escapes the repository root via "..": "${ref.path}". ` +
            `sourceRef paths must remain within the repository.`,
        );
      }
    }
  },
);

Deno.test(
  "the kit catalog exposes at least one sourceRef in total so the path-existence test is not vacuous",
  () => {
    const kits = listCoffeeMachineCm01V3EngineeringKits();
    const total = kits.reduce(
      (sum, kit) => sum + kit.qualification.sourceRefs.length,
      0,
    );
    assert(
      total > 0,
      "No sourceRef found across all kit descriptors. Either the catalog is empty " +
        "or all qualifications lost their sourceRefs. The path-existence test above " +
        "would pass vacuously and protect nothing.",
    );
  },
);
