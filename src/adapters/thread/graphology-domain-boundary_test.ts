import { assertEquals } from "@std/assert";

const BANNED = /from\s+["']graphology["']/;

Deno.test("graphology is not imported into domain; it is an index library", async () => {
  const hits: string[] = [];
  await collect("src/domain", hits);
  assertEquals(hits, []);
});

async function collect(directory: string, hits: string[]): Promise<void> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      await collect(path, hits);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const text = await Deno.readTextFile(path);
    if (BANNED.test(text)) hits.push(path);
  }
}
