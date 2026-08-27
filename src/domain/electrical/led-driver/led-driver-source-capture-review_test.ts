import { assertEquals } from "@std/assert";
import {
  emptyUnknownsLedDriverHumanSourceText,
  validLedDriverHumanSourceText,
} from "../../../testing/led-driver-source-fixtures.ts";
import { validateLedDriverHumanSource } from "./led-driver-human-source.ts";
import { assembleLedDriverSourceCaptureDocument } from "./led-driver-source-capture.ts";
import {
  assembleLedDriverSourceCaptureReview,
  captureReviewContent,
  LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA,
} from "./led-driver-source-capture-review.ts";

const SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

Deno.test("LED-driver source review keeps declared unknowns unresolved and grants none", () => {
  const source = validateLedDriverHumanSource(
    JSON.parse(validLedDriverHumanSourceText()),
  );
  const review = assembleLedDriverSourceCaptureReview(
    assembleLedDriverSourceCaptureDocument({
      source,
      sha256: SHA256,
      byteCount: 64,
      casUri: `casys://led-driver-source/sha256/${SHA256}`,
    }),
  );
  assertEquals(review.schemaVersion, LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA);
  assertEquals(review.status, "unresolved");
  assertEquals(review.unknowns.status, "unresolved");
  assertEquals(review.unknowns.items.length, 5);
  assertEquals(review.grants, "none");
  assertEquals(
    review.unknowns.items.every((item) => item.status === "unresolved"),
    true,
  );
  const content = captureReviewContent(review);
  assertEquals(content.includes("unresolved"), true);
  assertEquals(content.includes("grants is none"), true);
  assertEquals(content.includes("ngspice"), true);
  assertEquals(content.includes("result.reference"), true);
  assertEquals(content.includes("no EngineeringProject or Thread state"), true);
});

Deno.test("LED-driver source review reports none when the fiche names no unknowns", () => {
  const source = validateLedDriverHumanSource(
    JSON.parse(emptyUnknownsLedDriverHumanSourceText()),
  );
  const review = assembleLedDriverSourceCaptureReview(
    assembleLedDriverSourceCaptureDocument({
      source,
      sha256: SHA256,
      byteCount: 32,
      casUri: `casys://led-driver-source/sha256/${SHA256}`,
    }),
  );
  assertEquals(review.status, "captured");
  assertEquals(review.unknowns.status, "none");
  assertEquals(review.unknowns.items, []);
  assertEquals(review.grants, "none");
});
