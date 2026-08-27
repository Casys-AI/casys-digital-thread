import { assertEquals } from "@std/assert";
import { APPROVED_BRIEF_BASELINE_OPERATION } from "./approved-brief-baseline.ts";

Deno.test(
  "approved-brief baseline identity stays the reviewed stage-owned operation",
  () => {
    assertEquals(
      `${APPROVED_BRIEF_BASELINE_OPERATION.id}@${APPROVED_BRIEF_BASELINE_OPERATION.version}`,
      "baseline.from-approved-brief@1",
    );
  },
);
