/**
 * The industrial-project skill and the golden-path how-to both teach agents
 * to plan with registered operations. A document that cites an operation the
 * registry does not know is worse than silence: the agent will confidently
 * propose an identifier the server must refuse (the dead inspection-drone
 * reference survived exactly this way). This suite pins every operation
 * reference in those documents to the live registry, so doc drift fails a
 * test instead of a run.
 */
import { assert, assertEquals } from "@std/assert";
import { listRegisteredEngineeringOperationKeys } from "./registry.ts";

/** Every document that narrates the path by citing operation identifiers. */
const OPERATION_CITING_DOCUMENTS = [
  "../../../.agents/skills/guide-industrial-project/SKILL.md",
] as const;

/** Backtick-quoted exact operation references: `family.name@version`. */
const LITERAL_OPERATION_PATTERN = /`([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+@\d+)`/g;

/**
 * Backtick-quoted operation family globs such as `analyze.*sensitivity*`.
 * The family prefix before the first dot must be alphabetic so file globs
 * like `*.ts` never register as operation references.
 */
const GLOB_OPERATION_PATTERN = /`([a-z][a-z0-9-]*(?:\.[a-z0-9*-]+)+)`/g;

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replaceAll(".", "\\.").replaceAll("*", "[a-z0-9.-]*");
  return new RegExp(`^${escaped}(?:@\\d+)?$`);
}

async function readReferences(document: string): Promise<{
  literals: readonly string[];
  globs: readonly string[];
}> {
  const text = await Deno.readTextFile(new URL(document, import.meta.url));
  const literals = [...text.matchAll(LITERAL_OPERATION_PATTERN)]
    .map((match) => match[1]);
  const globs = [...text.matchAll(GLOB_OPERATION_PATTERN)]
    .map((match) => match[1])
    .filter((candidate) => candidate.includes("*"));
  return { literals: [...new Set(literals)], globs: [...new Set(globs)] };
}

Deno.test(
  "every operation-citing document still cites at least one operation reference",
  async () => {
    for (const document of OPERATION_CITING_DOCUMENTS) {
      const { literals, globs } = await readReferences(document);
      assert(
        literals.length + globs.length > 0,
        `${document} no longer cites any operation identifier, so this suite ` +
          "protects nothing there. Either the document lost its references " +
          "by accident, or this watch list must change alongside it.",
      );
    }
  },
);

Deno.test(
  "every operation id cited by the path documents exists in the registry",
  async () => {
    const registered = new Set(listRegisteredEngineeringOperationKeys());
    for (const document of OPERATION_CITING_DOCUMENTS) {
      const { literals } = await readReferences(document);
      const unknown = literals.filter((id) => !registered.has(id));
      assertEquals(
        unknown,
        [],
        `${document} cites operation ids the registry does not know: ` +
          `${unknown.join(", ")}. Registered keys: ` +
          `${[...registered].sort().join(", ")}`,
      );
    }
  },
);

Deno.test(
  "every operation glob cited by the path documents matches at least one registered operation",
  async () => {
    const registered = listRegisteredEngineeringOperationKeys();
    for (const document of OPERATION_CITING_DOCUMENTS) {
      const { globs } = await readReferences(document);
      const dead = globs.filter((glob) => {
        const pattern = globToRegExp(glob);
        return !registered.some((key) => pattern.test(key));
      });
      assertEquals(
        dead,
        [],
        `${document} cites operation patterns that match nothing registered: ` +
          `${dead.join(", ")}. A pattern that matches nothing teaches the ` +
          `agent a vocabulary the server will refuse.`,
      );
    }
  },
);
