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

export async function listSupportedProbes(): Promise<ProbeRecord[]> {
  if (!isTauriRuntime()) return [];
  return invokeNative<ProbeRecord[]>("list_supported_probes");
}
