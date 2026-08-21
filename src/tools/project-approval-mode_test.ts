import { assertEquals } from "@std/assert";
import {
  autoConfirms,
  HUMAN_CONFIRMATION_GATES,
  INTERACTIVE_PROJECT_APPROVAL_MODE,
  LOCAL_YOLO_PROJECT_APPROVAL_MODE,
} from "./project-approval-mode.ts";

Deno.test("interactive mode elicits every human confirmation gate", () => {
  for (const gate of HUMAN_CONFIRMATION_GATES) {
    assertEquals(autoConfirms(INTERACTIVE_PROJECT_APPROVAL_MODE, gate), false);
  }
});

Deno.test("local YOLO auto-confirms positive approvals and queued recovery only", () => {
  assertEquals(
    autoConfirms(LOCAL_YOLO_PROJECT_APPROVAL_MODE, "brief-confirm"),
    true,
  );
  assertEquals(
    autoConfirms(LOCAL_YOLO_PROJECT_APPROVAL_MODE, "decision-approve"),
    true,
  );
  assertEquals(
    autoConfirms(LOCAL_YOLO_PROJECT_APPROVAL_MODE, "queued-run-cancel"),
    true,
  );
  assertEquals(
    autoConfirms(LOCAL_YOLO_PROJECT_APPROVAL_MODE, "decision-reject"),
    false,
  );
  assertEquals(
    autoConfirms(LOCAL_YOLO_PROJECT_APPROVAL_MODE, "human-only-execute"),
    false,
  );
});
