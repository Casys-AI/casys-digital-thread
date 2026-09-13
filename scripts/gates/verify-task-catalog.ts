/**
 * Verify that every task registered in deno.json is cited in the task catalog,
 * and that every catalog bullet claims a task that still exists.
 *
 * The gate deliberately uses only built-in APIs. A task is cited when its exact
 * name appears as a Markdown code span in docs/reference/runtime/task-catalog.md.
 * The reverse direction only trusts catalog table rows (`| `name` | ...`), so
 * prose code spans never fail the gate when a task is renamed or removed.
 */

interface CitationFailure {
  readonly task: string;
  readonly reason: string;
}

const REPOSITORY_URL = new URL("../../", import.meta.url);
const DENO_JSON_PATH = "deno.json";
const CATALOG_PATH = "docs/reference/runtime/task-catalog.md";

const tasks = await readDenoTasks();
const taskSet = new Set(tasks);
const body = await readCatalogBody();
const cited = collectCodeSpans(body);
const failures: CitationFailure[] = [];

for (const task of tasks) {
  if (!cited.has(task)) {
    failures.push({
      task,
      reason: `not cited as a Markdown code span in ${CATALOG_PATH}`,
    });
  }
}

for (const claimed of collectTableClaims(body)) {
  if (!taskSet.has(claimed)) {
    failures.push({
      task: claimed,
      reason:
        `claimed by a ${CATALOG_PATH} table row but missing from ${DENO_JSON_PATH}`,
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

async function readCatalogBody(): Promise<string> {
  return await Deno.readTextFile(new URL(CATALOG_PATH, REPOSITORY_URL));
}

function collectCodeSpans(body: string): ReadonlySet<string> {
  const cited = new Set<string>();
  const codeSpan = /`([^`\n]+)`/gu;
  for (const match of body.matchAll(codeSpan)) {
    cited.add(match[1]!.trim());
  }
  return cited;
}

function collectTableClaims(body: string): readonly string[] {
  const claimed: string[] = [];
  const tableRow = /^\| `([^`\n]+)`/gmu;
  for (const match of body.matchAll(tableRow)) {
    claimed.push(match[1]!.trim());
  }
  return claimed;
}
