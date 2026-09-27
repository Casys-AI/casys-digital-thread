import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  createDownloadsFileSaver,
  decodeSaveFileBytes,
  sanitizeSaveFileName,
} from "./file-saver.ts";

Deno.test("save-file names stay basenames without hidden files", () => {
  assertEquals(sanitizeSaveFileName("box-v1.glb"), "box-v1.glb");
  assertEquals(sanitizeSaveFileName("../escape.glb"), "escape.glb");
  assertEquals(sanitizeSaveFileName("a/b\\c.step"), "c.step");
  assertEquals(sanitizeSaveFileName("..."), "casys-export.bin");
  assertEquals(sanitizeSaveFileName(""), "casys-export.bin");
  assertEquals(sanitizeSaveFileName("weird name!.glb"), "weird-name-.glb");
  assertEquals(sanitizeSaveFileName("x".repeat(200)).length <= 96, true);
});

Deno.test("save-file bytes decode base64 exactly", () => {
  assertEquals(
    decodeSaveFileBytes("Z2xiAA=="),
    new Uint8Array([0x67, 0x6c, 0x62, 0x00]),
  );
});

Deno.test("downloads saver writes unique files and reports paths", async () => {
  const home = await Deno.makeTempDir({ prefix: "casys-save-home-" });
  try {
    const saver = createDownloadsFileSaver(home);
    const first = await saver.saveFile("box-v1.glb", new Uint8Array([1, 2]));
    assertEquals(first, { path: `${home}/Downloads/box-v1.glb`, bytes: 2 });
    const second = await saver.saveFile("box-v1.glb", new Uint8Array([3]));
    assertEquals(second.path, `${home}/Downloads/box-v1-2.glb`);
    assertEquals(
      await Deno.readFile(first.path),
      new Uint8Array([1, 2]),
    );
    const raced = await Promise.all([
      saver.saveFile("race.bin", new Uint8Array([1])),
      saver.saveFile("race.bin", new Uint8Array([2])),
    ]);
    assertEquals(
      [...raced.map((entry) => entry.path)].sort(),
      [`${home}/Downloads/race.bin`, `${home}/Downloads/race-2.bin`].sort(),
    );
    const long = "x".repeat(96);
    const longFirst = await saver.saveFile(long, new Uint8Array([1]));
    const longSecond = await saver.saveFile(long, new Uint8Array([2]));
    assertEquals(longFirst.path, `${home}/Downloads/${long}`);
    assertEquals(longSecond.path, `${home}/Downloads/${"x".repeat(94)}-2`);
    assertEquals(
      await Deno.readFile(longSecond.path),
      new Uint8Array([2]),
    );
    await assertRejects(
      () => createDownloadsFileSaver(undefined).saveFile("x.bin", new Uint8Array()),
      Error,
      "home directory is unavailable",
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
