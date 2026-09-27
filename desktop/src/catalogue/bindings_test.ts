import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  DESKTOP_CATALOGUE_PROTOCOL,
  parseCatalogueCommandResponse,
  parseCatalogueSnapshotDto,
} from "../../../src/presentation/desktop/catalogue/contracts.ts";
import {
  CATALOGUE_COMMAND_BINDING,
  CATALOGUE_SNAPSHOT_BINDING,
  type DesktopCatalogueBindingHost,
  registerDesktopCatalogueBindings,
} from "./bindings.ts";

class FakeWindow {
  readonly handlers = new Map<string, (input: unknown) => unknown>();

  bind(name: string, handler: (input: unknown) => unknown): void {
    this.handlers.set(name, handler);
  }

  async invoke(name: string, input: unknown): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (handler === undefined) throw new Error(`no binding ${name}`);
    return await handler(input);
  }
}

function hostWith(
  overrides: Partial<DesktopCatalogueBindingHost> = {},
): DesktopCatalogueBindingHost {
  return {
    snapshot: () =>
      Promise.resolve({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        entries: [],
      }),
    command: (input) =>
      Promise.resolve({
        protocol: DESKTOP_CATALOGUE_PROTOCOL,
        requestId: input.requestId,
        ok: true,
      }),
    ...overrides,
  };
}

Deno.test("catalogue bindings serve snapshot and command", async () => {
  const window = new FakeWindow();
  registerDesktopCatalogueBindings(window, hostWith());
  const snapshot = parseCatalogueSnapshotDto(
    await window.invoke(CATALOGUE_SNAPSHOT_BINDING, {
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
    }),
  );
  assertEquals(snapshot.entries, []);
  const response = parseCatalogueCommandResponse(
    await window.invoke(CATALOGUE_COMMAND_BINDING, {
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
      requestId: "r1",
      command: "catalogue.defaults.get",
    }),
  );
  assertEquals(response.ok, true);
});

Deno.test("catalogue bindings stay honest without a host", async () => {
  const window = new FakeWindow();
  registerDesktopCatalogueBindings(window, undefined);
  const snapshot = parseCatalogueSnapshotDto(
    await window.invoke(CATALOGUE_SNAPSHOT_BINDING, {
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
    }),
  );
  assertEquals(snapshot.entries, []);
  assert(snapshot.error !== undefined);
  const response = parseCatalogueCommandResponse(
    await window.invoke(CATALOGUE_COMMAND_BINDING, {
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
      requestId: "r1",
      command: "catalogue.prepare",
      entryId: "build123d",
    }),
  );
  assertEquals(response.ok, false);
  assert(response.error !== undefined);
});

Deno.test("catalogue bindings convert host failures to ok:false", async () => {
  const window = new FakeWindow();
  registerDesktopCatalogueBindings(
    window,
    hostWith({
      snapshot: () => Promise.reject(new Error("backend down")),
      command: () => Promise.reject(new Error("Unknown catalogue entry.")),
    }),
  );
  const snapshot = parseCatalogueSnapshotDto(
    await window.invoke(CATALOGUE_SNAPSHOT_BINDING, {
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
    }),
  );
  assertEquals(snapshot.entries, []);
  assert(snapshot.error !== undefined);
  const response = parseCatalogueCommandResponse(
    await window.invoke(CATALOGUE_COMMAND_BINDING, {
      protocol: DESKTOP_CATALOGUE_PROTOCOL,
      requestId: "r1",
      command: "catalogue.prepare",
      entryId: "ghost",
    }),
  );
  assertEquals(response.ok, false);
  assertEquals(response.error, "Unknown catalogue entry.");
});
