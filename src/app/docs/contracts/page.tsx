export default function Contracts() {
  return (
    <>
      <h1>Contracts</h1>
      <p>
        The Contracts module handles smart contract deployment, interaction, and lifecycle management on any EVM chain. It includes pre-built templates based on OpenZeppelin for common standards (ERC-20, ERC-721, ERC-1155) and supports custom Solidity contracts. This is a <strong>DreamSpace addition</strong> — the SxT SDK does not include contract deployment tools.
      </p>

      <div className="docs-callout docs-callout-info">
        <div className="docs-callout-title">SxT + Contracts</div>
        While SxT does not deploy contracts, it has on-chain <strong>ZKpay relayer</strong> and <strong>verifier contracts</strong> on Ethereum (Mainnet + Sepolia) that enable smart contracts to request ZK-proven query results. DreamSpace integrates both — deploy your contracts and feed them verified SxT data.
      </div>

      <h2 id="overview">Overview</h2>
      <pre><code>{`import { contracts } from '@dreamspace/sdk';

// Deploy from a built-in OpenZeppelin template
const token = await contracts.deploy('ERC20', {
  name: 'DreamToken',
  symbol: 'DREAM',
  initialSupply: '1000000',
  network: 'base',
});

console.log('Token deployed at:', token.address);`}</code></pre>

      <h2 id="templates">Contract Templates</h2>
      <p>
        DreamSpace ships with audited, gas-optimized templates based on OpenZeppelin:
      </p>
      <ul>
        <li><strong>ERC-20</strong> — Fungible tokens with mint, burn, and permit</li>
        <li><strong>ERC-721</strong> — NFTs with metadata, royalties, and enumeration</li>
        <li><strong>ERC-1155</strong> — Multi-token standard for games and marketplaces</li>
        <li><strong>Governor</strong> — DAO governance with voting and timelocks</li>
        <li><strong>Escrow</strong> — Trustless escrow with arbiter support</li>
      </ul>

      <h2 id="custom-contracts">Custom Contracts</h2>
      <pre><code>{`// Deploy a custom Solidity contract
const custom = await contracts.deploy({
  source: './contracts/MyContract.sol',
  constructorArgs: ['Hello', 42],
  network: 'base',
  verify: true,  // Auto-verify on BaseScan
});

// Or deploy from ABI + bytecode
const fromAbi = await contracts.deployRaw({
  abi: myContractAbi,
  bytecode: myContractBytecode,
  constructorArgs: [arg1, arg2],
});`}</code></pre>

      <h2 id="sxt-integration">Using SxT Verified Data in Contracts</h2>
      <p>
        Smart contracts can receive ZK-proven query results from SxT via the ZKpay relayer. Your contract implements a <code>zkPayCallback</code> function to receive results.
      </p>
      <pre><code>{`// Your contract requests verified data from SxT:
//
// 1. Contract calls ZKpay relayer with SQL + payment (USDC or SXT token)
// 2. SxT executes query and generates Proof of SQL
// 3. Results + proof return on-chain
// 4. Verifier contract validates the proof (under 150k gas)
// 5. Your contract receives results via zkPayCallback

// ZKpay Relayer (Ethereum Mainnet):
// 0x27d4d2af364c1ad2ebdb2a28d6cb7b99ede1d450

// Verifier (Ethereum Mainnet):
// 0x84d6795ff1fCc224De328C86C318fABC396826B0`}</code></pre>

      <h2 id="interaction">Contract Interaction</h2>
      <pre><code>{`// Read from a contract
const balance = await contracts.read('ERC20', token.address, 'balanceOf', {
  args: ['0xHolder...'],
});

// Write to a contract
const tx = await contracts.write('ERC20', token.address, 'transfer', {
  args: ['0xRecipient...', '1000000000000000000'],
  gasLimit: 100000,
});

await tx.wait();
console.log('Transfer confirmed:', tx.hash);`}</code></pre>

      <h2 id="events">Event Listening</h2>
      <pre><code>{`// Listen for contract events
contracts.on(token.address, 'Transfer', (from, to, value) => {
  console.log(\`\${from} sent \${value} to \${to}\`);
});

// Query historical events
const transfers = await contracts.queryEvents(token.address, 'Transfer', {
  fromBlock: 'earliest',
  filter: { to: '0xMyAddress...' },
});`}</code></pre>

      <h2 id="verification">Contract Verification</h2>
      <pre><code>{`// Verify on block explorer after deployment
await contracts.verify(token.address, {
  network: 'base',
  constructorArgs: ['DreamToken', 'DREAM', '1000000'],
});`}</code></pre>
    </>
  );
}
