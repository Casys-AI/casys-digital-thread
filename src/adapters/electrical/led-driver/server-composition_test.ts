import { assertEquals } from "@std/assert";
import { validLedDriverHumanSourceText } from "../../../testing/led-driver-source-fixtures.ts";
import { persistAgentResourceText } from "../../../testing/agent-resource-test-support.ts";
import { createLedDriverSourceComposition } from "./server-composition.ts";

Deno.test("LED-driver composition captures and reviews without a provider or ngspice grant", async () => {
  const recordedAnalysisDirectory = await Deno.makeTempDir({
    prefix: "casys-led-driver-composition-",
  });
  try {
    const persisted = await persistAgentResourceText(
      `${recordedAnalysisDirectory}/agent-resources`,
      {
        name: "led-driver.json",
        mimeType: "application/json",
        text: validLedDriverHumanSourceText(),
      },
    );
    const composed = createLedDriverSourceComposition({
      recordedAnalysisDirectory,
      resources: persisted.reopen,
    });
    const review = await composed.ledDriverSourceCapture.capture({
      resourceRef: persisted.reference,
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
