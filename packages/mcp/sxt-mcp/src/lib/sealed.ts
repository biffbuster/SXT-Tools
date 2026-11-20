/**
 * Sealed tokens: AES-256-GCM authenticated encryption for every credential the
 * hosted server hands out (OAuth client ids, consent requests, authorization
 * codes, access tokens, refresh tokens).
 *
 * Why sealed instead of stored: the hosted transport holds no database. Each
 * token carries its own payload (including the caller's SXT API key for
 * access/refresh tokens), encrypted under a server secret. Any instance that
 * holds the secret can open any token, so the server scales horizontally with
 * no shared session store.
 *
 * Format: `sxt_<typ>_<base64url(kid || iv || ciphertext || tag)>`.
 *   - `typ` is also bound as AAD, so a refresh token can never be replayed as
 *     an access token (and so on).
 *   - `kid` is one byte identifying which secret sealed it, so a secret can be
 *     rotated: seal with the current secret, open with current or previous.
 *
 * Revocation model: tokens are valid until `exp`. Rotating the SXT API key at
 * the SXT console invalidates every token sealed over it (the JWT exchange
 * fails). Rotating SXT_MCP_TOKEN_SECRET invalidates every token the server has
 * ever issued once the previous secret is dropped.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type SealedType = "client" | "consent" | "code" | "access" | "refresh";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealKey {
  kid: number;
  key: Buffer;
}

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

/**
 * Derive a 32-byte key from an operator-supplied secret. The secret must carry
 * at least 32 bytes of entropy; we hash it so any encoding (hex, base64,
 * passphrase) works without the operator having to get the length exactly right.
 */
export function deriveKey(secret: string, kid: number): SealKey {
  if (secret.length < 32) {
    throw new SealError("token secret must be at least 32 characters");
  }
  return { kid, key: createHash("sha256").update(`sxt-mcp:v1:${secret}`).digest() };
}

export class Sealer {
  private readonly current: SealKey;
  private readonly byKid: Map<number, SealKey>;

  constructor(current: SealKey, previous: SealKey[] = []) {
    this.current = current;
    this.byKid = new Map([current, ...previous].map((k) => [k.kid, k]));
  }

  seal<T extends object>(typ: SealedType, payload: T, ttlSeconds: number): string {
    const body = JSON.stringify({ ...payload, exp: nowSeconds() + ttlSeconds });
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.current.key, iv);
    cipher.setAAD(Buffer.from(typ));
    const ct = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([Buffer.from([this.current.kid]), iv, ct, tag]);
    return `sxt_${typ}_${blob.toString("base64url")}`;
  }

  /** Returns the payload, or throws SealError if forged, wrong type, or expired. */
  open<T extends object>(typ: SealedType, token: string): T & { exp: number } {
    const prefix = `sxt_${typ}_`;
    if (!token.startsWith(prefix)) throw new SealError(`not a ${typ} token`);
    const blob = Buffer.from(token.slice(prefix.length), "base64url");
    if (blob.length < 1 + IV_BYTES + TAG_BYTES + 1) throw new SealError("token too short");

    const key = this.byKid.get(blob[0]!);
    if (!key) throw new SealError("token sealed with an unknown key");

    const iv = blob.subarray(1, 1 + IV_BYTES);
    const tag = blob.subarray(blob.length - TAG_BYTES);
    const ct = blob.subarray(1 + IV_BYTES, blob.length - TAG_BYTES);

    let text: string;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key.key, iv);
      decipher.setAAD(Buffer.from(typ));
      decipher.setAuthTag(tag);
      text = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch {
      throw new SealError("token failed authentication");
    }

    const payload = JSON.parse(text) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < nowSeconds()) {
      throw new SealError("token expired");
    }
    return payload;
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Stable, non-reversible principal id for logs and rate limiting. Never log
 * the key itself; log this.
 */
export function principalId(apiKey: string): string {
  return "p_" + createHash("sha256").update(`sxt-mcp:principal:${apiKey}`).digest("hex").slice(0, 16);
}
