import { invokeNative, isTauriRuntime } from "./native-service";

export interface ProbeRecord {
  kind: string;
  name: string;
  vendorId: number;
  productId: number;
  serialNumber: string | null;
  interface: number | null;
  accessible: boolean;
}

export interface ProbeConnectionResult {
  probeKind: string;
  targetName: string;
  coreTypes: string[];
  voltage: number | null;
  identityVerified: boolean;
}

export interface ProbeSessionInfo {
  sessionId: string;
  probeKind: string;
  probeSerial: string | null;
  targetName: string;
  coreTypes: string[];
  speedKhz: number;
  voltage: number | null;
  identityVerified: boolean;
  coreHalted: boolean;
}

export interface RamReadResult {
  address: string;
  bytesRead: number;
  data: number[];
  coreHalted: boolean;
}

export interface TargetIdentityResult {
  deviceId: string;
  flashKib: number;
  flashCompatible: boolean;
  programCompatible: boolean;
  programFlashEndAddressExclusive: string;
  exactPartVerified: boolean;
  expectedMarking: string;
}

export async function listSupportedProbes(): Promise<ProbeRecord[]> {
  if (!isTauriRuntime()) return [];
  return invokeNative<ProbeRecord[]>("list_supported_probes");
}

export function testTargetConnection(args: {
  probe: ProbeRecord;
  packId: string;
  sha256: string;
  device: string;
  speedKhz: number;
}): Promise<ProbeConnectionResult> {
  return invokeNative<ProbeConnectionResult>("test_target_connection", args);
}

export function attachProbeSession(args: {
  probe: ProbeRecord;
  packId: string;
  sha256: string;
  device: string;
  speedKhz: number;
}): Promise<ProbeSessionInfo> {
  return invokeNative<ProbeSessionInfo>("attach_probe_session", args);
}

export function probeSessionStatus(sessionId: string): Promise<ProbeSessionInfo> {
  return invokeNative<ProbeSessionInfo>("probe_session_status", { sessionId });
}

export function inspectProbeTarget(sessionId: string): Promise<TargetIdentityResult> {
  return invokeNative<TargetIdentityResult>("inspect_probe_target", { sessionId });
}

export function haltProbeSession(sessionId: string): Promise<ProbeSessionInfo> {
  return invokeNative<ProbeSessionInfo>("halt_probe_session", { sessionId });
}

export function resumeProbeSession(sessionId: string): Promise<ProbeSessionInfo> {
  return invokeNative<ProbeSessionInfo>("resume_probe_session", { sessionId });
}

export function readProbeRam(args: {
  sessionId: string;
  address: number;
  length: number;
}): Promise<RamReadResult> {
  return invokeNative<RamReadResult>("read_probe_ram", args);
}

export function disconnectProbeSession(sessionId: string): Promise<void> {
  return invokeNative<void>("disconnect_probe_session", { sessionId });
}
