import { assertEquals } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import { ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR } from "../../shared/cas/file-capture-store.ts";
import { FileAdmittedObservationEvaluationCaptureStore } from "./file-admitted-observation-evaluation-capture-store.ts";

Deno.test(
  "admitted observation evaluation capture store save/read hides the path",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "admitted-observation-evaluation-",
    });
    try {
      const store = new FileAdmittedObservationEvaluationCaptureStore(
        new FileCaptureStore({
          ...ADMITTED_OBSERVATION_EVALUATION_CAPTURE_DESCRIPTOR,
          directory,
          syncBoundary: directory,
        }),
      );
      const payload = {
        kind: "admitted-observation-evaluation",
        status: "unresolved",
      };
      const text = deterministicJson(payload);
      const fingerprint = await sha256Fingerprint(payload);
      const saved = await store.save(fingerprint, text);
      assertEquals(
        saved.uri.startsWith(
          "casys://modelica-admitted-observation-evaluation-capture/",
        ),
        true,
      );
      assertEquals(Object.hasOwn(saved, "path"), false);
      assertEquals(await store.read(saved.fingerprint), text);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
