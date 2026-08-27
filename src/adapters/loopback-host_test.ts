import { assertEquals } from "@std/assert";
import {
  isExplicitLoopbackHostname,
  requestUsesExplicitLoopbackHost,
} from "./loopback-host.ts";

Deno.test("loopback command surfaces accept only explicit loopback URL and Host names", () => {
  for (const hostname of ["127.0.0.1", "localhost", "::1", "[::1]"]) {
    assertEquals(isExplicitLoopbackHostname(hostname), true);
  }
  assertEquals(isExplicitLoopbackHostname("0.0.0.0"), false);
  assertEquals(isExplicitLoopbackHostname("workbench.test"), false);

  assertEquals(
    requestUsesExplicitLoopbackHost(new Request("http://127.0.0.1:3020/mcp")),
    true,
  );
  assertEquals(
    requestUsesExplicitLoopbackHost(
      new Request("http://localhost:5173/api/project/commands", {
        headers: { Host: "localhost:5173" },
      }),
    ),
    true,
  );
  assertEquals(
    requestUsesExplicitLoopbackHost(
      new Request("http://evil.example:3020/mcp", {
        headers: { Host: "evil.example:3020" },
      }),
    ),
    false,
  );
  assertEquals(
    requestUsesExplicitLoopbackHost(
      new Request("http://127.0.0.1:3020/mcp", {
        headers: { Host: "evil.example:3020" },
      }),
    ),
    false,
  );
});
