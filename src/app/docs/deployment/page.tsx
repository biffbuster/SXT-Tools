export default function DeploymentStorage() {
  return (
    <>
      <h1>Deployment &amp; Storage</h1>
      <p>
        The Deployment &amp; Storage module handles everything about <strong>putting your app and assets into the world</strong> — one-command deployment to DreamSpace hosting, IPFS pinning, Arweave permanent storage, NFT metadata management, and CI/CD integration.
      </p>

      <h2 id="deploy">One-Command Deploy</h2>
      <pre><code>{`$ npx dreamspace deploy

✓ Detecting framework... Next.js 16
✓ Building optimized production bundle...
✓ Pinning static assets to IPFS...
✓ Deploying to DreamSpace Edge CDN...
✓ Configuring SSL certificate...

🚀 Live at: https://your-app.dream.space
📦 IPFS CID: bafybei...
🔗 Build ID: ds_build_7f3a2c`}</code></pre>

      <h2 id="configuration">Configuration</h2>
      <pre><code>{`// dreamspace.config.ts
import { defineConfig } from '@dreamspace/sdk';

export default defineConfig({
  deploy: {
    project: 'my-nft-marketplace',
    team: 'makeinfinite',
    region: 'us-east',        // 'us-east' | 'eu-west' | 'ap-south'
    framework: 'nextjs',       // auto-detected
    buildCommand: 'npm run build',
    outputDir: '.next',
    env: {
      NEXT_PUBLIC_CHAIN: 'base',
    },
  },
});`}</code></pre>

      <h2 id="environments">Environments</h2>
      <pre><code>{`# Deploy to staging
$ npx dreamspace deploy --env staging

# Deploy to production
$ npx dreamspace deploy --env production

# Preview deployments (per-branch)
$ npx dreamspace deploy --preview`}</code></pre>

      <h2 id="ipfs">IPFS Storage</h2>
      <p>
        Upload files, raw data, and entire directories to IPFS. Every deployment also automatically pins your static assets to IPFS, giving you a permanent, content-addressed backup of your frontend.
      </p>
      <pre><code>{`import { storage } from '@dreamspace/sdk';

// Upload a file to IPFS
const result = await storage.upload('./image.png');
console.log(result.cid);      // bafybei...
console.log(result.url);      // https://gateway.dream.space/ipfs/bafybei...
console.log(result.gateway);  // Public gateway URL

// Upload raw data
const cid = await storage.ipfs.add(Buffer.from('Hello DreamSpace'));

// Upload JSON metadata (common for NFTs)
const metadata = await storage.ipfs.addJSON({
  name: 'Dream NFT #1',
  description: 'A unique digital collectible',
  image: 'ipfs://bafybei.../image.png',
  attributes: [
    { trait_type: 'Rarity', value: 'Legendary' },
    { trait_type: 'Power', value: 95 },
  ],
});

// Upload an entire directory
const dir = await storage.ipfs.addDirectory('./nft-assets/', {
  wrapWithDirectory: true,
});`}</code></pre>

      <h2 id="arweave">Arweave Permanent Storage</h2>
      <p>
        For permanent, immutable storage. Arweave provides one-time-pay, store-forever guarantees — ideal for metadata that must outlive any single service.
      </p>
      <pre><code>{`// Upload to Arweave for permanent storage
const arResult = await storage.arweave.upload('./important-data.json', {
  tags: [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'App-Name', value: 'DreamSpace' },
  ],
});

console.log(arResult.id);   // Arweave transaction ID
console.log(arResult.url);  // https://arweave.net/...`}</code></pre>

      <h2 id="nft-metadata">NFT Metadata Helper</h2>
      <pre><code>{`// Batch upload NFT collection metadata
const collection = await storage.nft.uploadCollection({
  images: './collection/images/',   // Directory of images
  metadata: './collection/meta/',   // Directory of JSON files
  storage: 'ipfs',                  // 'ipfs' | 'arweave'
});

console.log(collection.baseURI);   // ipfs://bafybei.../
console.log(collection.count);     // 10000`}</code></pre>

      <h2 id="retrieval">Content Retrieval</h2>
      <pre><code>{`// Fetch content from any CID
const data = await storage.get('bafybei...');
const json = await storage.getJSON('bafybei.../metadata.json');

// Check if content is pinned
const pinned = await storage.isPinned('bafybei...');`}</code></pre>

      <h2 id="deploy-pinning">Deploy-Time IPFS Pinning</h2>
      <pre><code>{`import { deployment } from '@dreamspace/sdk';

// Pin additional files to IPFS alongside your deploy
const cid = await deployment.pin('./dist/metadata.json');
console.log('Pinned:', cid);

// Pin an entire directory
const dirCid = await deployment.pinDirectory('./public/nfts');`}</code></pre>

      <h2 id="custom-domains">Custom Domains</h2>
      <pre><code>{`$ npx dreamspace domains add myapp.com
$ npx dreamspace domains verify myapp.com

# SSL is automatically provisioned via Let's Encrypt`}</code></pre>

      <h2 id="ci-cd">CI/CD Integration</h2>
      <pre><code>{`# .github/workflows/deploy.yml
name: Deploy to DreamSpace
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx dreamspace deploy --token \${{ secrets.DS_TOKEN }}`}</code></pre>
    </>
  );
}
