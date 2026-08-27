import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  chatHostTarget,
  parseImplementedTarget,
  resolveTargetArtifacts,
} from "./target.ts";

Deno.test("Chat Host models macOS, Linux, and Windows targets explicitly", () => {
  assertEquals(chatHostTarget("macOS", "aarch64"), "darwin-arm64");
  assertEquals(chatHostTarget("Linux", "x86_64"), "linux-x64");
  assertEquals(chatHostTarget("Windows", "x86_64"), "windows-x64");
});

Deno.test("only the implemented and tested target resolves packaged pins", () => {
  assertEquals(resolveTargetArtifacts("darwin-arm64").target, "darwin-arm64");
  assertThrows(
    () => resolveTargetArtifacts("linux-x64"),
    Error,
    "no packaged artifact pins",
  );
  assertThrows(
    () => resolveTargetArtifacts("windows-x64"),
    Error,
    "no packaged artifact pins",
  );
  assertThrows(() => parseImplementedTarget("darwin-x64"));
});
