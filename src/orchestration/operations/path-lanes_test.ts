import { assertEquals } from "@std/assert";
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
