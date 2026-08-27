import { assertEquals, assertRejects } from "@std/assert";
import { validLedDriverHumanSourceText } from "../../../../testing/led-driver-source-fixtures.ts";
import { FileByteStore } from "../../../../adapters/shared/cas/file-byte-store.ts";
import { LedDriverSourceCaptureService } from "../../../../adapters/electrical/led-driver/led-driver-source-capture.ts";
import {
  PrepareProjectLedDriverSourceReview,
  ProjectLedDriverSourceReviewError,
} from "./prepare-project-led-driver-source-review.ts";

Deno.test("LED-driver source review reopens capture and leaves unknowns unresolved", async () => {
  const root = await Deno.makeTempDir({ prefix: "led-driver-source-review-" });
  try {
    const captures = new LedDriverSourceCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "led-driver-source",
        directory: `${root}/sources`,
        uriNamespace: "led-driver-source",
        label: "LED-driver human source",
      }),
    });
    const reference = await captures.capture(validLedDriverHumanSourceText());
    const review = await new PrepareProjectLedDriverSourceReview({ captures })
      .execute({ sourceRef: reference });
    assertEquals(review.status, "unresolved");
    assertEquals(review.grants, "none");
    assertEquals(review.circuit.id, "circuit.led-driver");
    assertEquals(review.testCondition.id, "condition.reviewed-supply");
    assertEquals(review.unknowns.status, "unresolved");
    assertEquals(
      "decisionParameters" in review || "next" in review,
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("LED-driver source review refuses a request without a capture reference", async () => {
  const review = new PrepareProjectLedDriverSourceReview({
    captures: {
      capture: () => {
        throw new Error("must not capture");
      },
      reopen: () => {
        throw new Error("must not reopen");
      },
    },
  });
  const error = await assertRejects(
    () => review.execute({ sourceText: validLedDriverHumanSourceText() }),
    ProjectLedDriverSourceReviewError,
  );
  assertEquals(error.code, "invalid_request");
});
