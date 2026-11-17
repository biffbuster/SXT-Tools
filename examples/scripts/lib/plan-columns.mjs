/**
 * Live column lookup for any table on the SXT proven catalog.
 *
 * Compiles `SELECT * FROM <table>` with the chain RPC's
 * `commitments_v1_evmProofPlan` (free, keyless). Error 254018 means the
 * table has no commitments (not provable); otherwise the head of the plan
 * encodes every column's name and type. Same decoding as decodePlanColumns
 * in packages/mcp/sxt-mcp/src/tools/catalog.ts; keep the two in step.
 */

export const RPC = process.env.SXT_RPC_HTTP ?? 'https://rpc.mainnet.sxt.network/';
export const NOT_COMMITTED = 254018;

const TYPE_NAMES = {
  0: 'BOOLEAN', 2: 'TINYINT', 3: 'SMALLINT', 4: 'INT', 5: 'BIGINT',
  7: 'VARCHAR', 8: 'DECIMAL', 9: 'TIMESTAMP', 10: 'SCALAR', 11: 'VARBINARY',
};

export function decodePlanColumns(hex) {
  const buf = hex.startsWith('0x') ? hex.slice(2) : hex;
  let pos = 0;
  const take = (bytes) => {
    if (pos + bytes * 2 > buf.length) throw new Error('proof plan ended early');
    const out = buf.slice(pos, pos + bytes * 2);
    pos += bytes * 2;
    return out;
  };
  const u64 = () => Number(BigInt('0x' + take(8)));
  const u32 = () => parseInt(take(4), 16);
  const u8 = () => parseInt(take(1), 16);
  const text = () => {
    const len = u64();
    if (len > 1024) throw new Error('proof plan name length out of range');
    return Buffer.from(take(len), 'hex').toString('utf8');
  };

  const tableCount = u64();
  for (let i = 0; i < tableCount; i++) text();
  const columnCount = u64();
  if (columnCount > 4096) throw new Error('proof plan column count out of range');
  const columns = [];
  for (let i = 0; i < columnCount; i++) {
    u64(); // table index
    const name = text();
    const id = u32();
    let type = TYPE_NAMES[id];
    if (!type) throw new Error(`unknown column type id ${id}`);
    if (id === 8) {
      const precision = u8();
      const scale = (u8() << 24) >> 24;
      type = `DECIMAL(${precision},${scale})`;
    } else if (id === 9) {
      take(8); // time unit + timezone
    }
    columns.push({ name, type });
  }
  return columns;
}

async function planRpc(query) {
  // Cold first connections can time out and then succeed; retry once.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'commitments_v1_evmProofPlan', params: { query } }),
        signal: AbortSignal.timeout(30000),
      });
      return await res.json();
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}

/** { provable: true, columns } or { provable: false, error } for one PREFIX.TABLE. */
export async function describeTable(tableRef) {
  const json = await planRpc(`SELECT * FROM ${tableRef}`);
  if (json.error) return { provable: false, error: json.error };
  if (!json.result?.proofPlan) throw new Error(`no proofPlan in the response from ${RPC}`);
  return { provable: true, columns: decodePlanColumns(json.result.proofPlan), at: json.result.at ?? null };
}
