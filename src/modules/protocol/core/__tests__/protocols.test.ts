import { describe, expect, it } from "vite-plus/test";

import { hexToBytes } from "../bytes";
import { PROTOCOLS, PROTOCOL_IDS } from "../protocols";

function bytes(hex: string): Uint8Array {
  const parsed = hexToBytes(hex);
  if (!parsed.ok) throw new Error(`bad test hex: ${hex}`);
  return parsed.value;
}

describe("protocol adapters", () => {
  it("exposes exactly the three Modbus transports", () => {
    expect([...PROTOCOL_IDS]).toEqual(["rtu", "tcp", "ascii"]);
  });

  it("declares transaction-id and checksum capabilities", () => {
    expect(PROTOCOLS.rtu.hasTransactionId).toBe(false);
    expect(PROTOCOLS.tcp.hasTransactionId).toBe(true);
    expect(PROTOCOLS.ascii.hasTransactionId).toBe(false);
    expect(PROTOCOLS.rtu.checksum).toBe("crc16");
    expect(PROTOCOLS.tcp.checksum).toBeNull();
    expect(PROTOCOLS.ascii.checksum).toBe("lrc");
  });

  it("computes the transport-specific checksum", () => {
    const body = bytes("01 03 00 00 00 02");
    expect(PROTOCOLS.rtu.checksumText(body)).toBe("C4 0B");
    expect(PROTOCOLS.ascii.checksumText(body)).toBe("FA");
    expect(PROTOCOLS.tcp.checksumText(body)).toBe("");
  });

  it("parses each sample frame", () => {
    for (const id of PROTOCOL_IDS) {
      const parsed = PROTOCOLS[id].parse(bytes(PROTOCOLS[id].sample));
      expect(parsed.ok).toBe(true);
    }
  });

  it("builds requests through the adapter", () => {
    expect(PROTOCOLS.rtu.buildRequest({ unit: 1, func: 3, addr: 0, qty: 2, tid: 0 }).text).toBe(
      "01 03 00 00 00 02 C4 0B",
    );
    expect(PROTOCOLS.tcp.buildRequest({ unit: 1, func: 3, addr: 0, qty: 2, tid: 1 }).text).toBe(
      "00 01 00 00 00 06 01 03 00 00 00 02",
    );
  });
});
