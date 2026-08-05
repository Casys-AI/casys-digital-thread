/**
 * The industrial-project skill teaches agents to plan with registered
 * operations. A skill that cites an operation the registry does not know is
 * worse than silence: the agent will confidently propose an identifier the
 * server must refuse. This suite pins every operation reference in the skill
 * to the live registry, so doc drift fails a test instead of a run.
 */
import { assert, assertEquals } from "@std/assert";
import { listRegisteredEngineeringOperationKeys } from "./registry.ts";

const SKILL_URL = new URL(
  "../../../.agents/skills/guide-industrial-project/SKILL.md",
  import.meta.url,
);

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

async function readSkillReferences(): Promise<{
  literals: readonly string[];
  globs: readonly string[];
}> {
  const text = await Deno.readTextFile(SKILL_URL);
  const literals = [...text.matchAll(LITERAL_OPERATION_PATTERN)]
    .map((match) => match[1]);
  const globs = [...text.matchAll(GLOB_OPERATION_PATTERN)]
    .map((match) => match[1])
    .filter((candidate) => candidate.includes("*"));
  return { literals: [...new Set(literals)], globs: [...new Set(globs)] };
}

Deno.test(
  "the industrial-project skill cites at least one operation reference",
  async () => {
    const { literals, globs } = await readSkillReferences();
    assert(
      literals.length + globs.length > 0,
      "The skill no longer cites any operation identifier, so this suite " +
        "protects nothing. Either the skill lost its operation references by " +
        "accident, or this extraction must be updated alongside the change.",
    );
  },
);

Deno.test(
  "every operation id the industrial-project skill cites exists in the registry",
  async () => {
    const { literals } = await readSkillReferences();
    const registered = new Set(listRegisteredEngineeringOperationKeys());
    const unknown = literals.filter((id) => !registered.has(id));
    assertEquals(
      unknown,
      [],
      `The skill cites operation ids the registry does not know: ` +
        `${unknown.join(", ")}. Registered keys: ` +
        `${[...registered].sort().join(", ")}`,
    );
  },
);

Deno.test(
  "every operation glob the industrial-project skill cites matches at least one registered operation",
  async () => {
    const { globs } = await readSkillReferences();
    const registered = listRegisteredEngineeringOperationKeys();
    const dead = globs.filter((glob) => {
      const pattern = globToRegExp(glob);
      return !registered.some((key) => pattern.test(key));
    });
    assertEquals(
      dead,
      [],
      `The skill cites operation patterns that match nothing registered: ` +
        `${dead.join(", ")}. A pattern that matches nothing teaches the agent ` +
        `a vocabulary the server will refuse.`,
    );
  },
);
