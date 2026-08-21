import { assertEquals } from "@std/assert";
import { validLedDriverHumanSourceText } from "../../../testing/led-driver-source-fixtures.ts";
import { createLedDriverSourceComposition } from "./server-composition.ts";

Deno.test("LED-driver composition captures and reviews without a provider or ngspice grant", async () => {
  const recordedAnalysisDirectory = await Deno.makeTempDir({
    prefix: "casys-led-driver-composition-",
  });
  try {
    const composed = createLedDriverSourceComposition({
      recordedAnalysisDirectory,
    });
    const review = await composed.ledDriverSourceCapture.capture({
      sourceText: validLedDriverHumanSourceText(),
    });
    assertEquals(review.status, "unresolved");
    assertEquals(review.grants, "none");
    assertEquals(review.unknowns.status, "unresolved");
    const reread = await composed.ledDriverSourceReview.execute({
      sourceRef: review.reference,
    });
    assertEquals(reread.reference, review.reference);
    assertEquals(reread.unknowns.status, "unresolved");
    assertEquals(reread.grants, "none");

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("HttpMcpToolClient"), false);
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
  } finally {
    await Deno.remove(recordedAnalysisDirectory, { recursive: true });
  }
});
