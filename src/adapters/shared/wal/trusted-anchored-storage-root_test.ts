import { assertEquals, assertThrows } from "@std/assert";
import {
  isEqualOrStrictLexicalDescendant,
  lexicalComponentsFromAnchor,
  requireContainedStoragePath,
  requireEqualOrStrictLexicalDescendant,
  resolveTrustedAnchoredStorageRoot,
} from "./trusted-anchored-storage-root.ts";

const ESCAPED = "Filesystem operation escaped the anchored WAL root.";

Deno.test("relative storage root is anchored at cwd and never inspects /Volumes", () => {
  const root = resolveTrustedAnchoredStorageRoot(
    "state/local/capability-runtime-host/qualification-attempts",
    { currentWorkingDirectory: "/Volumes/DEV/worktree" },
  );
  assertEquals(root.trustedAnchor, "/Volumes/DEV/worktree");
  assertEquals(
    root.storageRoot,
    "/Volumes/DEV/worktree/state/local/capability-runtime-host/qualification-attempts",
  );
  const components = lexicalComponentsFromAnchor(
    root.trustedAnchor,
    `${root.storageRoot}/attempt.lock`,
    ESCAPED,
  );
  assertEquals(components[0], "/Volumes/DEV/worktree");
  assertEquals(components.includes("/Volumes"), false);
  assertEquals(components.includes("/Volumes/DEV"), false);
});

Deno.test("explicit absolute storage root keeps a fail-closed walk from /", () => {
  const root = resolveTrustedAnchoredStorageRoot("/var/folders/xx/wal");
  assertEquals(root.trustedAnchor, "/");
  assertEquals(root.storageRoot, "/var/folders/xx/wal");
  assertEquals(
    lexicalComponentsFromAnchor("/", "/var/folders/xx/wal", ESCAPED),
    ["/var", "/var/folders", "/var/folders/xx", "/var/folders/xx/wal"],
  );
});

Deno.test("lexical descendants reject .., prefix lookalikes and unresolved escape", () => {
  assertEquals(
    isEqualOrStrictLexicalDescendant("/work/repo", "/work/repo"),
    true,
  );
  assertEquals(
    isEqualOrStrictLexicalDescendant("/work/repo", "/work/repo/state/local"),
    true,
  );
  assertEquals(
    isEqualOrStrictLexicalDescendant("/work/repo", "/work/repo-evil/state"),
    false,
  );
  assertEquals(
    isEqualOrStrictLexicalDescendant("/work/repo", "/work/repo/../etc"),
    false,
  );
  assertEquals(
    isEqualOrStrictLexicalDescendant("/work/repo", "/work/repo/state/./local"),
    false,
  );
  assertThrows(
    () =>
      requireEqualOrStrictLexicalDescendant(
        "/work/repo",
        "/work/repo-evil/state",
        ESCAPED,
      ),
    Error,
    "escaped",
  );
  assertThrows(
    () =>
      resolveTrustedAnchoredStorageRoot("state/../escaped", {
        currentWorkingDirectory: "/work/repo",
      }),
    TypeError,
    "invalid",
  );
  assertThrows(
    () => resolveTrustedAnchoredStorageRoot("/work/repo/../escaped"),
    TypeError,
    "invalid",
  );
});

Deno.test("contained storage paths stay under the trusted anchor and store root", () => {
  const root = resolveTrustedAnchoredStorageRoot(
    "state/local/store",
    { currentWorkingDirectory: "/work/repo" },
  );
  requireContainedStoragePath(root, root.storageRoot, ESCAPED);
  requireContainedStoragePath(root, `${root.storageRoot}/event.json`, ESCAPED);
  assertThrows(
    () => requireContainedStoragePath(root, `${root.storageRoot}-evil/x`, ESCAPED),
    Error,
    "escaped",
  );
  assertThrows(
    () =>
      requireContainedStoragePath(
        root,
        "/work/repo/state/local/store/../escaped.json",
        ESCAPED,
      ),
    Error,
    "escaped",
  );
});
