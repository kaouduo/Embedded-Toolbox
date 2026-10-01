import { open } from "@tauri-apps/plugin-dialog";
import { invokeNative } from "./native-service";

export interface BinaryFlashPlan {
  packId: string;
  packSha256: string;
  device: string;
  firmwareSha256: string;
  byteCount: number;
  startAddress: string;
  endAddressExclusive: string;
  memoryRegion: string;
  flashAlgorithm: string;
}

export async function pickBinaryFirmware(): Promise<string | null> {
  const path = await open({ multiple: false, filters: [{ name: "Binary firmware", extensions: ["bin"] }] });
  return typeof path === "string" ? path : null;
}

export function planBinaryFlash(args: {
  packId: string;
  packSha256: string;
  device: string;
  firmwarePath: string;
  startAddress: string;
}): Promise<BinaryFlashPlan> {
  return invokeNative<BinaryFlashPlan>("plan_binary_flash", args);
}
