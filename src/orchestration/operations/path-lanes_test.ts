import { assertEquals } from "@std/assert";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { listRegisteredEngineeringOperationKeys } from "./registry.ts";
import {
  listRegisteredEngineeringOperationPathLaneKeys,
  REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER,
} from "./path-lanes.ts";

Deno.test("every registered operation has one exact project-path lane declaration", () => {
  const registered = [...listRegisteredEngineeringOperationKeys()].toSorted();
  const classified = [...listRegisteredEngineeringOperationPathLaneKeys()]
    .toSorted();
  assertEquals(classified, registered);

  for (const key of registered) {
    const separator = key.lastIndexOf("@");
    const declaration = REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER
      .resolve({ id: key.slice(0, separator), version: key.slice(separator + 1) });
    assertEquals(declaration !== undefined, true, key);
  }
});

Deno.test("assembly-integrity observation belongs to the physics lane", () => {
  assertEquals(
    REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER.resolve(
      VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    ),
    { kind: "fixed", lane: "physics" },
  );
});

Deno.test("assembly-integrity L4 evaluation belongs to the verdicts lane", () => {
  assertEquals(
    REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER.resolve(
      VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    ),
    { kind: "fixed", lane: "verdicts" },
  );
});
