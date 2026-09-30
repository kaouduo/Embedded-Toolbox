import { open } from "@tauri-apps/plugin-dialog";
import { invokeNative, isTauriRuntime } from "./native-service";

export type TargetCapability = "descriptionOnly" | "algorithmPresent" | "missingAlgorithm";
export interface MemoryRegionRecord { id: string; start: string; size: string; access: string | null; default: boolean }
export interface AlgorithmRecord { file: string; start: string | null; size: string | null; ramStart: string | null; ramSize: string | null; default: boolean }
export interface DeviceRecord { name: string; family: string; core: string | null; memoryRegions: MemoryRegionRecord[]; algorithms: AlgorithmRecord[]; algorithmFiles: string[]; capability: TargetCapability }
export interface PackRecord { id: string; vendor: string; name: string; version: string; sha256: string; importedAt: string; devices: DeviceRecord[] }

export const TargetCatalogService = {
  async list(): Promise<PackRecord[]> {
    if (!isTauriRuntime()) return [];
    return invokeNative<PackRecord[]>("list_target_packs");
  },
  async pickAndImport(): Promise<PackRecord | null> {
    const path = await open({ multiple: false, filters: [{ name: "CMSIS-Pack", extensions: ["pack"] }] });
    if (typeof path !== "string") return null;
    return invokeNative<PackRecord>("import_target_pack", { path });
  },
};
