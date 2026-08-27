import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { sealDenoEnvironment, sealNodeProcessEnvironment } from "./runtime-sandbox.ts";

Deno.test("sealNodeProcessEnvironment gives npm modules an immutable empty env", () => {
  const processLike: { env: Record<string, string> } = {
    env: { LOG: "parse", SECRET: "sentinel" },
  };
  sealNodeProcessEnvironment(processLike);
  assertEquals(processLike.env, {});
  assertEquals(Object.isFrozen(processLike.env), true);
  assertThrows(() => {
    processLike.env.LOG = "parse";
  }, TypeError);
});

Deno.test("sealDenoEnvironment provides a frozen empty view without granting env", () => {
  const denoLike: {
    env: {
      get(name: string): string | undefined;
      has(name: string): boolean;
      toObject(): Record<string, string>;
      set(name: string, value: string): void;
      delete(name: string): void;
    };
  } = {
    env: {
      get: (_name: string) => "secret",
      has: (_name: string) => true,
      toObject: () => ({ TOKEN: "secret" }),
      set: (_name: string, _value: string) => {},
      delete: (_name: string) => {},
    },
  };

  sealDenoEnvironment(denoLike);

  assertEquals(denoLike.env.get("TOKEN"), undefined);
  assertEquals(denoLike.env.has("TOKEN"), false);
  assertEquals(denoLike.env.toObject(), {});
  assertEquals(Object.isFrozen(denoLike.env), true);
  assertThrows(() => denoLike.env.set("TOKEN", "replacement"), Deno.errors.NotCapable);
  assertThrows(() => denoLike.env.delete("TOKEN"), Deno.errors.NotCapable);
  assertThrows(
    () =>
      Object.defineProperty(denoLike, "env", {
        value: { get: () => "replacement" },
      }),
    TypeError,
  );
});
