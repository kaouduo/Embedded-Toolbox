export type ByteOrder = "big-endian" | "little-endian";
export type WordOrder = "high-word-first" | "low-word-first";
export type LayoutId = "abcd" | "dcba" | "badc" | "cdab";

export interface DataLayout {
  id: LayoutId;
  label: string;
  byteOrder: ByteOrder;
  wordOrder: WordOrder;
}

export const DATA_LAYOUTS: readonly DataLayout[] = [
  {
    id: "abcd",
    label: "ABCD",
    byteOrder: "big-endian",
    wordOrder: "high-word-first",
  },
  {
    id: "dcba",
    label: "DCBA",
    byteOrder: "little-endian",
    wordOrder: "low-word-first",
  },
  {
    id: "badc",
    label: "BADC",
    byteOrder: "little-endian",
    wordOrder: "high-word-first",
  },
  {
    id: "cdab",
    label: "CDAB",
    byteOrder: "big-endian",
    wordOrder: "low-word-first",
  },
] as const;

function splitWords(bytes: Uint8Array): number[][] {
  const words: number[][] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    words.push([bytes[index] ?? 0, bytes[index + 1] ?? 0]);
  }
  return words;
}

/** Converts canonical big-endian bytes into a Modbus byte/word layout. */
export function applyLayout(bytes: Uint8Array, layout: DataLayout): Uint8Array {
  let words = splitWords(bytes);

  if (layout.wordOrder === "low-word-first") {
    words = words.reverse();
  }
  if (layout.byteOrder === "little-endian") {
    words = words.map((word) => word.reverse());
  }

  return Uint8Array.from(words.flat());
}

/** Layout transformations are self-inverse when applied in reverse order. */
export function removeLayout(bytes: Uint8Array, layout: DataLayout): Uint8Array {
  let words = splitWords(bytes);

  if (layout.byteOrder === "little-endian") {
    words = words.map((word) => word.reverse());
  }
  if (layout.wordOrder === "low-word-first") {
    words = words.reverse();
  }

  return Uint8Array.from(words.flat());
}

export function isLayoutMeaningful(byteLength: number, layout: DataLayout): boolean {
  return byteLength > 2 || layout.id === "abcd" || layout.id === "dcba";
}
