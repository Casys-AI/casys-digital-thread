import "./styles.css";
import { startPreactSurfaceApp } from "@casys/mcp-view/preact";
import { bomRegistry } from "./components.tsx";
import type { ErpNextBomSurfaceData } from "../../component-contract.ts";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root");

await startPreactSurfaceApp<ErpNextBomSurfaceData>({
  root,
  info: { name: "ERPNext BOM components", version: "0.1.0" },
  registry: bomRegistry,
  surfaceClassName: "erpnext-component-surface",
  loadingLabel: "Waiting for ERPNext BOM data…",
  emptyLabel: "ERPNext returned no composable BOM data.",
  surfaceRequiredLabel:
    "This resource exposes ERPNext components and requires a Compose-selected surface.",
  validate: (value): value is ErpNextBomSurfaceData => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const candidate = value as Partial<ErpNextBomSurfaceData>;
    return Array.isArray(candidate.boms) && typeof candidate.count === "number";
  },
});
