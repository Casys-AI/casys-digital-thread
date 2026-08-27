import type { ComponentDiagnostic } from "../contracts/diagnostics.ts";
import { classifyShellStatus } from "./classify.ts";

function diagnostic(
  id: string,
  state: ComponentDiagnostic["state"],
): ComponentDiagnostic {
  return {
    id,
    label: id,
    state,
    summary: `${id} is ${state}`,
    evidence: `${id} evidence is ${state}`,
  };
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function lot1ReadyHost(): ComponentDiagnostic[] {
  return [
    diagnostic("manifest", "ready"),
    diagnostic("runtime", "ready"),
    diagnostic("layout", "ready"),
    diagnostic("desktop-shell", "ready"),
    diagnostic("casys-control-plane", "unavailable"),
    diagnostic("engineering-providers", "unavailable"),
    diagnostic("workbench-projection", "unavailable"),
    diagnostic("chat-host", "unavailable"),
  ];
}

Deno.test("classifyShellStatus keeps Lot 1 host-ready plus unavailable as degraded", () => {
  assertEquals(classifyShellStatus(lot1ReadyHost()), "degraded");
});

Deno.test("classifyShellStatus is ready only when every component is ready", () => {
  const components = lot1ReadyHost().map((component) => ({
    ...component,
    state: "ready" as const,
    summary: `${component.id} is ready`,
    evidence: `${component.id} evidence is ready`,
  }));
  assertEquals(classifyShellStatus(components), "ready");
});

Deno.test("classifyShellStatus treats host manifest runtime or layout failure as recovery-required", () => {
  for (const id of ["manifest", "runtime", "layout", "desktop-shell"] as const) {
    for (const state of ["error", "unavailable", "unresolved"] as const) {
      const components = lot1ReadyHost().map((component) =>
        component.id === id ? diagnostic(id, state) : component
      );
      assertEquals(classifyShellStatus(components), "recovery-required");
    }
  }
});

Deno.test("classifyShellStatus preserves unavailable and unresolved on non-host components", () => {
  const withUnresolved = lot1ReadyHost().map((component) =>
    component.id === "engineering-providers"
      ? diagnostic("engineering-providers", "unresolved")
      : component
  );
  assertEquals(classifyShellStatus(withUnresolved), "degraded");

  const withError = lot1ReadyHost().map((component) =>
    component.id === "casys-control-plane"
      ? diagnostic("casys-control-plane", "error")
      : component
  );
  assertEquals(classifyShellStatus(withError), "recovery-required");
});

Deno.test("classifyShellStatus does not rewrite component states", () => {
  const components = lot1ReadyHost();
  const snapshot = JSON.stringify(components);
  classifyShellStatus(components);
  if (JSON.stringify(components) !== snapshot) {
    throw new Error("classifyShellStatus must not mutate component diagnostics");
  }
});

Deno.test("classifyShellStatus is recovery-required when host evidence is missing", () => {
  assertEquals(classifyShellStatus([]), "recovery-required");
  assertEquals(
    classifyShellStatus([diagnostic("engineering-providers", "unavailable")]),
    "recovery-required",
  );
});
