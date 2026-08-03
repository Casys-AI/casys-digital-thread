import { assertEquals } from "@std/assert";
import {
  DEFAULT_PROJECT_VIEW,
  parseProjectViewHash,
  PROJECT_VIEWS,
  projectViewHash,
  projectViewLabel,
} from "./src/project/navigation-model.ts";

Deno.test("An absent fragment opens the cockpit on its default space", () => {
  assertEquals(parseProjectViewHash(""), DEFAULT_PROJECT_VIEW);
});

Deno.test("An unknown fragment never leaves the cockpit on an empty space", () => {
  assertEquals(parseProjectViewHash("#evidence"), DEFAULT_PROJECT_VIEW);
  assertEquals(parseProjectViewHash("#../../etc/passwd"), DEFAULT_PROJECT_VIEW);
  assertEquals(parseProjectViewHash("#"), DEFAULT_PROJECT_VIEW);
});

Deno.test("Every space round-trips through its fragment", () => {
  for (const view of PROJECT_VIEWS) {
    assertEquals(parseProjectViewHash(projectViewHash(view.id)), view.id);
  }
});

Deno.test("A fragment is read with or without its leading hash", () => {
  assertEquals(parseProjectViewHash("verification"), "verification");
  assertEquals(parseProjectViewHash("#verification"), "verification");
});

Deno.test("Every space carries a label and a description for wayfinding", () => {
  for (const view of PROJECT_VIEWS) {
    assertEquals(projectViewLabel(view.id), view.label);
    assertEquals(view.description.length > 0, true);
  }
});

Deno.test("The five spaces stay distinct and stable", () => {
  assertEquals(PROJECT_VIEWS.length, 5);
  assertEquals(
    PROJECT_VIEWS.map((view) => view.id),
    ["overview", "work", "product", "verification", "operations"],
  );
  assertEquals(new Set(PROJECT_VIEWS.map((view) => view.label)).size, 5);
});
