export type DataTypeId =
  | "uint16"
  | "int16"
  | "uint32"
  | "int32"
  | "float32"
  | "uint64"
  | "int64"
  | "float64";

export type DataTypeKind = "integer" | "float";

export interface DataTypeDefinition {
  id: DataTypeId;
  label: string;
  bits: 16 | 32 | 64;
  kind: DataTypeKind;
  signed: boolean;
}

export const DATA_TYPES: readonly DataTypeDefinition[] = [
  { id: "uint16", label: "UINT16", bits: 16, kind: "integer", signed: false },
  { id: "int16", label: "INT16", bits: 16, kind: "integer", signed: true },
  { id: "uint32", label: "UINT32", bits: 32, kind: "integer", signed: false },
  { id: "int32", label: "INT32", bits: 32, kind: "integer", signed: true },
  { id: "float32", label: "FLOAT32", bits: 32, kind: "float", signed: true },
  { id: "uint64", label: "UINT64", bits: 64, kind: "integer", signed: false },
  { id: "int64", label: "INT64", bits: 64, kind: "integer", signed: true },
  { id: "float64", label: "FLOAT64", bits: 64, kind: "float", signed: true },
] as const;
