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
