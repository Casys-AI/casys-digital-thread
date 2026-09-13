/**
 * Verify that every task registered in deno.json is cataloged in the task
 * catalog, and that every catalog entry still names a registered task.
 *
 * The gate deliberately uses only built-in APIs. The single authority is the
 * set of first-column code spans of true pipe-table rows in
 * docs/reference/runtime/task-catalog.md (`| `name` | ...`). A task named only
 * in prose or in another row's role cell is not cataloged, and a stale row
 * fails even when a prose mention of the same name remains. Row-looking text
 * inside fenced code examples and indented code blocks is not a table row.
 * A table requires a header followed by a matching delimiter row.
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
const cataloged = collectCatalogTasks(body);
const failures: CitationFailure[] = [];

for (const task of tasks) {
  if (!cataloged.has(task)) {
    failures.push({
      task,
      reason: `not named in the first column of a ${CATALOG_PATH} table row`,
    });
  }
}

for (const claimed of cataloged) {
  if (!taskSet.has(claimed)) {
    failures.push({
      task: claimed,
      reason: `named by a ${CATALOG_PATH} table row but missing from ${DENO_JSON_PATH}`,
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
  `Verified ${tasks.length} deno.json task(s) cataloged in ${CATALOG_PATH}.`,
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

function collectCatalogTasks(body: string): ReadonlySet<string> {
  const cataloged = new Set<string>();
  const tableLine = /^ {0,3}\|(.+)\|[ \t]*$/u;
  const delimiterCell = /^[ \t]*:?-+:?[ \t]*$/u;
  let headerColumns = 0;
  let tableColumns = 0;
  let fenceMarker: "`" | "~" | undefined;
  let fenceLength = 0;
  for (const line of body.split("\n")) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      headerColumns = 0;
      tableColumns = 0;
      const run = fence[1]!;
      const marker = run[0] as "`" | "~";
      if (fenceMarker === undefined) {
        fenceMarker = marker;
        fenceLength = run.length;
      } else if (
        marker === fenceMarker && run.length >= fenceLength &&
        (fence[2] ?? "").trim() === ""
      ) {
        fenceMarker = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceMarker !== undefined) continue;
    const cells = line.match(tableLine)?.[1]?.split("|");
    if (cells === undefined || cells.length < 2) {
      headerColumns = 0;
      tableColumns = 0;
      continue;
    }
    const delimiter = cells.every((cell) => delimiterCell.test(cell));
    if (tableColumns === 0) {
      if (delimiter && cells.length === headerColumns) tableColumns = headerColumns;
      headerColumns = delimiter ? 0 : cells.length;
      continue;
    }
    if (delimiter) continue;
    const match = cells[0]?.match(/^[ \t]*`([^`\n]+)`[ \t]*$/u);
    if (match) cataloged.add(match[1]!.trim());
  }
  return cataloged;
}
