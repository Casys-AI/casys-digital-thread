/**
 * Verify that every task registered in deno.json is cited in the task catalog.
 *
 * The gate deliberately uses only built-in APIs. A task is cited when its exact
 * name appears as a Markdown code span in docs/reference/runtime/task-catalog.md.
 */

interface CitationFailure {
  readonly task: string;
  readonly reason: string;
}

const REPOSITORY_URL = new URL("../../", import.meta.url);
const DENO_JSON_PATH = "deno.json";
const CATALOG_PATH = "docs/reference/runtime/task-catalog.md";

const tasks = await readDenoTasks();
const cited = await readCatalogCitations();
const failures: CitationFailure[] = [];

for (const task of tasks) {
  if (!cited.has(task)) {
    failures.push({
      task,
      reason: `not cited as a Markdown code span in ${CATALOG_PATH}`,
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${DENO_JSON_PATH}: task \`${failure.task}\` — ${failure.reason}`);
  }
  console.error(
    `Task catalog verification failed (${failures.length} error(s)).`,
  );
  Deno.exit(1);
}

console.log(
  `Verified ${tasks.length} deno.json task(s) cited in ${CATALOG_PATH}.`,
);

async function readDenoTasks(): Promise<readonly string[]> {
  const raw = await Deno.readTextFile(new URL(DENO_JSON_PATH, REPOSITORY_URL));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${DENO_JSON_PATH}: ${String(error)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("tasks" in parsed) ||
    typeof parsed.tasks !== "object" ||
    parsed.tasks === null ||
    Array.isArray(parsed.tasks)
  ) {
    throw new Error(`${DENO_JSON_PATH} is missing a tasks object`);
  }
  return Object.keys(parsed.tasks as Record<string, unknown>);
}

async function readCatalogCitations(): Promise<ReadonlySet<string>> {
  const body = await Deno.readTextFile(new URL(CATALOG_PATH, REPOSITORY_URL));
  const cited = new Set<string>();
  const codeSpan = /`([^`\n]+)`/gu;
  for (const match of body.matchAll(codeSpan)) {
    cited.add(match[1]!.trim());
  }
  return cited;
}
