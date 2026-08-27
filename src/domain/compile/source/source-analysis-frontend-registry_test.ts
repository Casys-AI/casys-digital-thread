import { assertEquals, assertThrows } from "@std/assert";
import {
  FixedSourceAnalysisFrontendRegistry,
  SourceAnalysisFrontendNotRegisteredError,
} from "./source-analysis-frontend-registry.ts";

const frontend = {
  analyze: () => Promise.reject(new Error("not called")),
};

Deno.test("source-analysis frontend registry resolves an exact analyzer version only", () => {
  const registry = new FixedSourceAnalysisFrontendRegistry([{
    analyzer: { id: "project-brief-json", version: "1.0.0" },
    frontend,
  }]);

  assertEquals(
    registry.require({ id: "project-brief-json", version: "1.0.0" }),
    frontend,
  );
  assertThrows(
    () => registry.require({ id: "project-brief-json", version: "1.0.1" }),
    SourceAnalysisFrontendNotRegisteredError,
    "project-brief-json@1.0.1",
  );
});

Deno.test("source-analysis frontend registry rejects duplicate exact registrations", () => {
  assertThrows(
    () =>
      new FixedSourceAnalysisFrontendRegistry([
        {
          analyzer: { id: "project-brief-json", version: "1.0.0" },
          frontend,
        },
        {
          analyzer: { id: "project-brief-json", version: "1.0.0" },
          frontend,
        },
      ]),
    TypeError,
    "Duplicate source-analysis frontend registration",
  );
});
