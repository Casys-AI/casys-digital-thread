import { assertEquals } from "@std/assert";
import { sensitivityStudySealIdentities } from "./sensitivity-study-case-catalog.ts";

const CASE_ID = "id01-radial-arm-height-isolated";
const ADMISSION_A = "b0e5ba4d4a9a434b606997b7acf0a453ca20563e8c4e6bc3dde7a87d4b94376f";
const ADMISSION_B = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

Deno.test("sensitivity seal identities include the cadSource digest prefix", () => {
  assertEquals(sensitivityStudySealIdentities(CASE_ID, ADMISSION_A), {
    workItemId: "wi-sensitivity-seal-id01-radial-arm-height-isolated-b0e5ba4d4a9a434b",
    decisionId: "dec-sensitivity-seal-id01-radial-arm-height-isolated-b0e5ba4d4a9a434b",
  });
});

Deno.test("a different cadSource compiles a different activity", () => {
  const left = sensitivityStudySealIdentities(CASE_ID, ADMISSION_A);
  const right = sensitivityStudySealIdentities(CASE_ID, ADMISSION_B);
  assertEquals(left.workItemId === right.workItemId, false);
  assertEquals(
    right.workItemId,
    "wi-sensitivity-seal-id01-radial-arm-height-isolated-aaaaaaaaaaaaaaaa",
  );
});
