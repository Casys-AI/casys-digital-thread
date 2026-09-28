import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { allocateLoopbackPort } from "./ports.ts";

function fakeListen(occupied: ReadonlySet<number>, ephemeral: number) {
  const closed: number[] = [];
  return {
    closed,
    listen: (port: number) => {
      if (port === 0) {
        if (occupied.has(ephemeral)) throw new Deno.errors.AddrInUse("in use");
        return { port: ephemeral, close: () => closed.push(ephemeral) };
      }
      if (occupied.has(port)) throw new Deno.errors.AddrInUse("in use");
      return { port, close: () => closed.push(port) };
    },
  };
}

Deno.test("port allocator keeps the preferred historical port when free", () => {
  const fake = fakeListen(new Set(), 45678);
  assertEquals(allocateLoopbackPort({ preferred: 3014, listen: fake.listen }), 3014);
  assertEquals(fake.closed, [3014]);
});

Deno.test("port allocator falls back to an ephemeral port when occupied", () => {
  const fake = fakeListen(new Set([3014]), 45678);
  const port = allocateLoopbackPort({ preferred: 3014, listen: fake.listen });
  assertEquals(port, 45678);
  assertEquals(fake.closed, [45678]);
});

Deno.test("port allocator rejects an invalid preferred port", () => {
  const fake = fakeListen(new Set(), 45678);
  assertThrows(() => allocateLoopbackPort({ preferred: 0, listen: fake.listen }));
  assertThrows(() => allocateLoopbackPort({ preferred: 99999, listen: fake.listen }));
  assertThrows(() => allocateLoopbackPort({ preferred: 3014.5, listen: fake.listen }));
});

Deno.test("port allocator fails closed when no port can be probed", () => {
  const fake = fakeListen(new Set([3014, 45678]), 45678);
  assertThrows(
    () => allocateLoopbackPort({ preferred: 3014, listen: fake.listen }),
    Error,
    "allocate",
  );
});
