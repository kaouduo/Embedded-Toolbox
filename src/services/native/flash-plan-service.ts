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
  eraseStartAddress: string;
  eraseEndAddressExclusive: string;
  eraseSectorCount: number;
}

export interface BinaryProgramResult {
  firmwareSha256: string;
  byteCount: number;
  verified: boolean;
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

export function programBinary(args: {
  sessionId: string;
  firmwarePath: string;
  startAddress: string;
  expectedSha256: string;
  confirmedPart: boolean;
}): Promise<BinaryProgramResult> {
  return invokeNative<BinaryProgramResult>("program_probe_binary", args);
}
