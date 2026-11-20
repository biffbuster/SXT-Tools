/**
 * Turns the verifier's columnar output into rows an agent can read.
 *
 * verify_prover_response_hyper_kzg returns `[[name, { Kind: data }], ...]`,
 * where `data` is the serde form of proof-of-sql's OwnedColumn. Most kinds are
 * a plain value array. Two need decoding:
 *   - Decimal75 is `[precision, scale, scalars]`, and each scalar is four u64
 *     limbs, most significant first. `[0,0,0,510]` at scale 2 is 5.10
 *     (checked against a verified IRIS proof on 2026-11-17). Negatives are
 *     stored as the BN254 field modulus minus the value.
 *   - VarBinary is an array of byte arrays; rendered as 0x-prefixed hex.
 *
 * The raw verifier output is still returned unchanged as `result`, so the
 * decoding here never stands between a caller and the proven values.
 */

/** BN254 scalar field modulus (HyperKZG commits over BN254). */
const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const HALF_R = BN254_R / 2n;

function limbsToBigInt(limbs: unknown): bigint | null {
  if (!Array.isArray(limbs) || limbs.length !== 4) return null;
  let v = 0n;
  for (const l of limbs) {
    // A limb above 2^53 that arrived as a JS number has already lost bits:
    // refuse it so rows is omitted rather than wrong.
    if (typeof l === "number" && !Number.isSafeInteger(l)) return null;
    if (typeof l !== "number" && typeof l !== "string" && typeof l !== "bigint") return null;
    if (typeof l === "string" && !/^\d+$/.test(l)) return null;
    v = (v << 64n) | BigInt(l);
  }
  return v > HALF_R ? v - BN254_R : v;
}

/** 510n at scale 2 → "5.10"; negative scale multiplies. */
export function formatDecimal(value: bigint, scale: number): string {
  if (scale <= 0) return (value * 10n ** BigInt(-scale)).toString();
  const neg = value < 0n;
  const digits = (neg ? -value : value).toString().padStart(scale + 1, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function hex(bytes: unknown): string | null {
  if (!Array.isArray(bytes) || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return null;
  return "0x" + bytes.map((b: number) => b.toString(16).padStart(2, "0")).join("");
}

/** One column's values as JSON-safe scalars, or null for a shape we do not recognise. */
function decodeColumn(kind: string, data: unknown): unknown[] | null {
  if (kind === "Decimal75") {
    if (!Array.isArray(data) || data.length !== 3 || !Array.isArray(data[2])) return null;
    const scale = Number(data[1]);
    if (!Number.isInteger(scale)) return null;
    const out: string[] = [];
    for (const s of data[2]) {
      const v = limbsToBigInt(s);
      if (v === null) return null;
      out.push(formatDecimal(v, scale));
    }
    return out;
  }
  if (kind === "Scalar") {
    if (!Array.isArray(data)) return null;
    const out = data.map(limbsToBigInt);
    return out.includes(null) ? null : out.map((v) => v!.toString());
  }
  if (kind === "VarBinary") {
    if (!Array.isArray(data)) return null;
    const out = data.map(hex);
    return out.includes(null) ? null : out;
  }
  if (kind === "TimestampTZ") {
    // [time unit, time zone, epoch values]: keep the epoch numbers.
    return Array.isArray(data) && data.length === 3 && Array.isArray(data[2]) ? data[2] : null;
  }
  if (Array.isArray(data) && data.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))) {
    return data;
  }
  return null;
}

export interface DecodedRows {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

/** Row objects for the verified result, or null when any column has an unknown shape. */
export function toRows(result: unknown): DecodedRows | null {
  if (!Array.isArray(result)) return null;
  const columns: Array<[string, unknown[]]> = [];
  for (const entry of result) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object") return null;
    const kinds = Object.entries(entry[1] as Record<string, unknown>);
    if (kinds.length !== 1) return null;
    const values = decodeColumn(kinds[0]![0], kinds[0]![1]);
    if (!values) return null;
    columns.push([entry[0], values]);
  }
  const rowCount = columns[0]?.[1].length ?? 0;
  if (columns.some(([, v]) => v.length !== rowCount)) return null;
  const rows = Array.from({ length: rowCount }, (_, i) =>
    Object.fromEntries(columns.map(([name, values]) => [name, values[i]])),
  );
  return { rows, rowCount };
}
