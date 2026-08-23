import { assertEquals } from "jsr:@std/assert@1.0.14";
import manifest from "../../component-manifest.json" with { type: "json" };

Deno.test("Lot 3 manifest pins the shell and both dedicated sidecars", () => {
  assertEquals(manifest.product.version, "0.3.0");
  const shell = manifest.components.find((component) =>
    component.id === "desktop-shell"
  );
  const controlPlane = manifest.components.find((component) =>
    component.id === "casys-control-plane"
  );
  const workbench = manifest.components.find((component) =>
    component.id === "workbench-projection"
  );
  assertEquals(shell, {
    id: "desktop-shell",
    version: "0.3.0",
    delivery: "bundled",
    lifecycle: "active",
  });
  assertEquals(controlPlane, {
    id: "casys-control-plane",
    version: "0.2.0",
    delivery: "sidecar",
    lifecycle: "active",
  });
  assertEquals(workbench, {
    id: "workbench-projection",
    version: "0.3.0",
    delivery: "sidecar",
    lifecycle: "active",
  });
});
