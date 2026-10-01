import { open } from "@tauri-apps/plugin-dialog";
import { invokeNative } from "./native-service";

export interface BinaryFlashPlan {
  format: "BIN" | "ELF" | "HEX";
  segments: { startAddress: string; endAddressExclusive: string; byteCount: number; eraseStartAddress: string; eraseEndAddressExclusive: string }[];
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
  const path = await open({ multiple: false, filters: [{ name: "Firmware", extensions: ["bin", "elf", "hex"] }] });
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
}): Promise<BinaryProgramResult> {
  return invokeNative<BinaryProgramResult>("program_probe_binary", args);
}

export function eraseInternalFlash(sessionId: string): Promise<void> {
  return invokeNative<void>("erase_probe_internal_flash", { sessionId, confirmed: true });
}
