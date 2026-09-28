import { assertEquals } from "jsr:@std/assert@1.0.14";
import { scrubRendererText, scrubRuntimeIdentity } from "./scrub.ts";

Deno.test("renderer scrub redacts digests, ids, and loopback ports", () => {
  const digest = "a".repeat(64);
  assertEquals(
    scrubRendererText(`image repo@sha256:${digest} pinned`),
    "image repo@sha256:<digest> pinned",
  );
  assertEquals(
    scrubRuntimeIdentity(
      `Could not stop owned container 0272a50fad75: dial 127.0.0.1:45678 refused; repo@sha256:${digest}.`,
    ),
    "Could not stop owned container <id>: dial 127.0.0.1:<port> refused; repo@sha256:<digest>.",
  );
  assertEquals(
    scrubRuntimeIdentity("Stopped 1 owned container(s)."),
    "Stopped 1 owned container(s).",
  );
});
