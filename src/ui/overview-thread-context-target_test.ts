import { assertEquals } from "@std/assert";
import {
  overviewThreadGroupContextValue,
  overviewThreadNodeContextValue,
  parseOverviewThreadContextTarget,
} from "./src/project/overview-thread-context-target.ts";

Deno.test("overview context values preserve exact node and group identities", () => {
  const nodeKey = "artifact:sha256:abc";
  const groupKey = "group:requirements:UL-6-1";

  assertEquals(
    parseOverviewThreadContextTarget(overviewThreadNodeContextValue(nodeKey)),
    { kind: "node", key: nodeKey },
  );
  assertEquals(
    parseOverviewThreadContextTarget(overviewThreadGroupContextValue(groupKey)),
    { kind: "group", key: groupKey },
  );
  assertEquals(parseOverviewThreadContextTarget(undefined), undefined);
  assertEquals(parseOverviewThreadContextTarget("node:"), undefined);
  assertEquals(parseOverviewThreadContextTarget("viewer:abc"), undefined);
});
