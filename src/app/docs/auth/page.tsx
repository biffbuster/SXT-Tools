export default function AuthIdentity() {
  return (
    <>
      <h1>Auth &amp; Identity</h1>
      <p>
        The Auth &amp; Identity module handles everything about <strong>who you are</strong> and <strong>what you can access</strong> in DreamSpace. It wraps Space and Time&apos;s ED25519 authentication with DID-style identity abstractions, bridges SxT tokens with Sign-In with Ethereum (SIWE), manages biscuit token permissions, and integrates ENS resolution and ERC-8004 agent identity.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">Two Auth Layers, One Module</div>
        DreamSpace handles two authentication layers: (1) <strong>SxT API auth</strong> — ED25519 key pairs and biscuit tokens for data access (auto-managed), and (2) <strong>User-facing auth</strong> — SIWE for wallet-based sign-in. The SDK bridges both so your users sign with their wallet and get automatic SxT data access. The raw SxT SDK requires manual key generation, auth code signing, and token refresh every 25 minutes — DreamSpace automates all of it.
      </div>

      <h2 id="identity-creation">Identity Creation</h2>
      <p>
        Every user, agent, or service in DreamSpace gets an identity backed by SxT ED25519 credentials. Creating an identity generates the key pair and provisions SxT API access automatically.
      </p>
      <pre><code>{`import { identity } from '@dreamspace/sdk';

// Create a DreamSpace identity (generates ED25519 keys under the hood)
const did = await identity.create({
  type: 'user',            // 'user' | 'agent' | 'service'
  displayName: 'alice.dream',
});

console.log(did.id);          // DreamSpace identity ID
console.log(did.sxtUserId);   // SxT user ID for API access
console.log(did.publicKey);   // ED25519 public key`}</code></pre>

      <h2 id="sxt-authentication">SxT Authentication (Under the Hood)</h2>
      <p>
        Every DreamSpace identity maps to an SxT authenticated user. The SDK manages the full auth flow automatically:
      </p>
      <pre><code>{`// What DreamSpace automates for you:
// 1. sxt.Authorization().GenerateKeyPair()    → ED25519 key pair
// 2. sxt.Authentication().GenerateAuthCode()  → Auth code from SxT
// 3. sxt.Authorization().GenerateSignature()  → Sign auth code
// 4. sxt.Authentication().GenerateToken()     → Access + refresh tokens
//
// Access tokens expire in 25 minutes, refresh tokens in 30 minutes.
// DreamSpace handles auto-refresh seamlessly.

// If you need the raw SxT tokens:
const tokens = await identity.getSxtTokens(did.id);
console.log(tokens.accessToken);   // Valid for 25 min
console.log(tokens.refreshToken);  // Valid for 30 min`}</code></pre>

      <h2 id="siwe">Sign-In with Ethereum (SIWE)</h2>
      <p>
        SIWE is the user-facing auth layer. Users prove wallet ownership by signing a message — no passwords, no email. DreamSpace automatically provisions SxT API access when a SIWE session is created.
      </p>
      <pre><code>{`import { auth } from '@dreamspace/sdk';

// Full authentication flow
const { address } = await wallet.connect();

const message = auth.createSiweMessage({
  domain: window.location.host,
  address,
  uri: window.location.origin,
  version: '1',
  chainId: 8453,
  nonce: await auth.getNonce(),
});

const signature = await wallet.signMessage(message);
const session = await auth.verify({ message, signature });

// Session includes both user JWT and SxT API access
// SxT tokens auto-refresh (access: 25min, refresh: 30min)
const api = auth.createAuthenticatedClient(session.token);`}</code></pre>

      <h2 id="biscuit-permissions">Biscuit Token Permissions</h2>
      <p>
        SxT uses biscuit tokens for granular, table-level authorization. DreamSpace manages these automatically, but you can create custom tokens for fine-grained access control.
      </p>
      <pre><code>{`// DreamSpace auto-generates appropriate biscuit tokens per operation
// For custom control:
const readOnlyToken = await identity.createBiscuitToken({
  permissions: ['dql_select'],
  resources: ['ETHEREUM.TRANSACTIONS', 'ETHEREUM.BLOCKS'],
});

const fullAccessToken = await identity.createBiscuitToken({
  permissions: ['dql_select', 'dml_insert', 'dml_update', 'dml_delete'],
  resources: ['MY_APP.USER_PROFILES'],
});

// Share a read-only token with another user or service
// Biscuit tokens are cryptographically verifiable and self-contained`}</code></pre>

      <h2 id="sessions">Session Management</h2>
      <pre><code>{`// Check if a session is valid
const valid = await auth.validateSession(session.token);

// Refresh a session (also refreshes SxT tokens)
const refreshed = await auth.refresh(session.token);

// Revoke a session
await auth.logout(session.token);`}</code></pre>

      <h2 id="middleware">Server Middleware</h2>
      <pre><code>{`// Next.js API route middleware
import { auth } from '@dreamspace/sdk/server';

export async function middleware(request) {
  const session = await auth.fromRequest(request);

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  // session.address — verified wallet address
  // session.sxtClient — pre-authenticated SxT client
  return next();
}`}</code></pre>

      <h2 id="rbac">Role-Based Access Control</h2>
      <pre><code>{`// Define roles with SxT data access permissions
auth.defineRoles({
  admin: {
    actions: ['manage:users', 'manage:contracts', 'deploy'],
    sxtPermissions: ['dql_select', 'dml_insert', 'dml_update', 'dml_delete', 'ddl_create'],
  },
  operator: {
    actions: ['manage:contracts', 'deploy'],
    sxtPermissions: ['dql_select', 'dml_insert'],
  },
  viewer: {
    actions: ['read:data'],
    sxtPermissions: ['dql_select'],
  },
});

// Assign roles — biscuit tokens are scoped automatically
auth.assignRole('0xAdmin...', 'admin');

// Check permissions
const canDeploy = auth.can(session, 'deploy');      // true
const canQuery = auth.canSxt(session, 'dql_select'); // true`}</code></pre>

      <h2 id="agent-identity">Agent Identity</h2>
      <p>
        AI agents get their own DreamSpace identities with SxT API access. When combined with ERC-8004, agents also get an on-chain identity with reputation and validation.
      </p>
      <pre><code>{`// Register an agent identity (SxT auth + optional ERC-8004)
const agentId = await identity.create({
  type: 'agent',
  displayName: 'trading-bot-v2',
  operator: did.id,            // Human operator identity
});

// Optionally register on-chain via ERC-8004
const onChainId = await identity.registerOnChain(agentId, {
  agentURI: 'https://my-bot.api/.well-known/agent.json',
  metadata: [
    { key: 'capabilities', value: 'query,swap' },
  ],
});

console.log(onChainId.erc8004Id);  // On-chain ERC-8004 agent ID
console.log(onChainId.tokenId);    // ERC-721 NFT token ID`}</code></pre>

      <h2 id="ens-integration">ENS Integration</h2>
      <p>
        ENS resolution is built in for name lookups, reverse resolution, and profile fetching. This is a DreamSpace addition — SxT does not include ENS support.
      </p>
      <pre><code>{`const profile = await identity.ensProfile('vitalik.eth');
console.log(profile.address);  // 0xd8dA...
console.log(profile.avatar);   // https://...
console.log(profile.records);  // { twitter, github, url, ... }

// Reverse lookup
const name = await identity.ensReverse('0xd8dA...');
console.log(name);  // 'vitalik.eth'`}</code></pre>

      <h2 id="identity-resolution">Identity Resolution</h2>
      <pre><code>{`// Resolve any identifier — ENS name, address, or DreamSpace ID
const resolved = await identity.resolve('alice.eth');
console.log(resolved.address);     // 0x...
console.log(resolved.type);        // 'ens'

const resolved2 = await identity.resolve('0x1a2b...');
console.log(resolved2.ensName);    // 'alice.eth' (if set)
console.log(resolved2.erc8004Id);  // Agent ID (if registered)`}</code></pre>
    </>
  );
}
