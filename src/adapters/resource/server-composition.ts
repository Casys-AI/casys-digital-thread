/**
 * Compose draft agent-resource ingress: raw CAS, closed sheet codecs, capture
 * use case. MCP exposure is bound after McpApp construction.
 */

import type { McpApp } from "@casys/mcp-server";
import type { ThermalMethodSheetStore } from "../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import type { ElectricalObservationMethodSheetStore } from "../../application/ports/out/electrical/observation-method-sheet-store.ts";
import type { ProjectResourceCaptureUseCase } from "../../application/ports/in/resource/project-resource-capture.ts";
import type { AgentResourceExposure } from "../../application/ports/out/resource/agent-resource-exposure.ts";
import { ClosedResourceInterpretationRegistry } from "../../application/use-cases/resource/closed-resource-interpretation-registry.ts";
import { PrepareProjectResourceCapture } from "../../application/use-cases/resource/prepare-project-resource-capture.ts";
import { FileAgentResourceStore } from "./file-agent-resource-store.ts";
import { McpAgentResourcePublisher } from "./mcp-agent-resource-publisher.ts";
import { ThermalMethodSheetResourceCodec } from "./interpretation/thermal-method-sheet-codec.ts";
import { ElectricalObservationMethodSheetResourceCodec } from "./interpretation/electrical-observation-method-sheet-codec.ts";

export interface AgentResourceIngressOptions {
  readonly store: FileAgentResourceStore;
  readonly thermalSheets: ThermalMethodSheetStore;
  readonly electricalSheets: ElectricalObservationMethodSheetStore;
}

export interface AgentResourceIngress {
  readonly capture: ProjectResourceCaptureUseCase;
  readonly store: FileAgentResourceStore;
  bind(app: McpApp): Promise<AgentResourceExposure>;
}

export function createAgentResourceIngress(
  options: AgentResourceIngressOptions,
): AgentResourceIngress {
  const store = options.store;
  const interpretation = new ClosedResourceInterpretationRegistry([
    new ThermalMethodSheetResourceCodec(options.thermalSheets),
    new ElectricalObservationMethodSheetResourceCodec(options.electricalSheets),
  ]);
  const capture = new PrepareProjectResourceCapture({ store, interpretation });
  return {
    capture,
    store,
    async bind(app) {
      const exposure = new McpAgentResourcePublisher(app, store);
      await exposure.restore();
      return exposure;
    },
  };
}
