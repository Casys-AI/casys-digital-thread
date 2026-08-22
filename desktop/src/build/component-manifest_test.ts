import { assertEquals } from "jsr:@std/assert@1.0.14";
import manifest from "../../component-manifest.json" with { type: "json" };

Deno.test("Lot 2 manifest pins the product, shell, and sidecar server", () => {
  assertEquals(manifest.product.version, "0.2.0");
  const shell = manifest.components.find((component) =>
    component.id === "desktop-shell"
  );
  const controlPlane = manifest.components.find((component) =>
    component.id === "casys-control-plane"
  );
  assertEquals(shell, {
    id: "desktop-shell",
    version: "0.2.0",
    delivery: "bundled",
    lifecycle: "active",
  });
  assertEquals(controlPlane, {
    id: "casys-control-plane",
    version: "0.2.0",
    delivery: "sidecar",
    lifecycle: "active",
  });
});
