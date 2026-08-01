import { assertEquals, assertRejects } from "@std/assert";
import {
  type EngineeringProjectFileIo,
  FileEngineeringProjectStore,
} from "./engineering-project-store.ts";

Deno.test("FileEngineeringProjectStore loads the validated CM-01 project manifest read-only", async () => {
  const store = new FileEngineeringProjectStore(
    "config/projects/coffee-machine-cm01.project.json",
  );

  const project = await store.get();

  assertEquals(project?.schemaVersion, "1.0");
  assertEquals(project?.project.id, "coffee-machine-cm01");
  assertEquals(project?.project.subjectId, "coffee-machine-cm01");
  assertEquals("save" in store, false);
});

Deno.test("FileEngineeringProjectStore reports an absent manifest without manufacturing a fixture", async () => {
  const store = new FileEngineeringProjectStore(
    "missing.json",
    new StubFileIo(() => {
      throw new Deno.errors.NotFound("missing");
    }),
  );

  assertEquals(await store.get(), undefined);
});

Deno.test("FileEngineeringProjectStore rejects JSON outside the project domain contract", async () => {
  const store = new FileEngineeringProjectStore(
    "invalid.json",
    new StubFileIo(() => '{"schemaVersion":"not-supported"}'),
  );

  await assertRejects(
    () => store.get(),
    Error,
    "Invalid EngineeringProjectSnapshot",
  );
});

Deno.test("FileEngineeringProjectStore does not hide malformed JSON", async () => {
  const store = new FileEngineeringProjectStore(
    "broken.json",
    new StubFileIo(() => "{"),
  );

  await assertRejects(() => store.get(), SyntaxError);
});

class StubFileIo implements EngineeringProjectFileIo {
  constructor(private readonly read: () => string) {}

  readTextFile(): Promise<string> {
    return Promise.resolve(this.read());
  }
}
