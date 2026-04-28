export default function Marketplace() {
  return (
    <>
      <h1>Marketplace</h1>
      <p>
        The Marketplace module provides tooling for building NFT marketplaces, token storefronts, and auction systems. It includes built-in escrow contracts, royalty enforcement, and multi-chain listing support. This is a <strong>DreamSpace-built module</strong> that uses SxT for marketplace analytics and verified transaction history.
      </p>

      <h2 id="overview">Overview</h2>
      <pre><code>{`import { marketplace } from '@dreamspace/sdk';

// Create a new marketplace instance
const market = marketplace.create({
  name: 'DreamMarket',
  chain: 'base',
  feeRecipient: '0xYourWallet...',
  feeBps: 250,  // 2.5% platform fee
});`}</code></pre>

      <h2 id="listings">Creating Listings</h2>
      <pre><code>{`// List an NFT for sale (fixed price)
const listing = await market.list({
  tokenAddress: '0xNFTContract...',
  tokenId: '42',
  price: '0.5',             // ETH
  currency: 'ETH',
  duration: '7d',
  royaltyEnforced: true,
});

console.log(listing.id);`}</code></pre>

      <h2 id="auctions">Auctions</h2>
      <pre><code>{`// Create an English auction
const auction = await market.createAuction({
  tokenAddress: '0xNFTContract...',
  tokenId: '42',
  startingPrice: '0.1',
  reservePrice: '0.5',
  duration: '24h',
  bidIncrement: '0.05',
});

// Place a bid
await market.bid(auction.id, { amount: '0.15' });

// Settle the auction (after duration expires)
await market.settle(auction.id);`}</code></pre>

      <h2 id="escrow">Built-in Escrow</h2>
      <p>
        All marketplace transactions go through trustless on-chain escrow. Funds are held in a smart contract until the NFT is transferred.
      </p>
      <pre><code>{`// Buy a listed NFT (escrow handles the atomic swap)
const purchase = await market.buy(listing.id);

// Escrow flow:
// 1. Buyer's ETH locked in escrow contract
// 2. NFT transferred from seller to buyer
// 3. ETH released to seller
// 4. Platform fee and royalties distributed automatically`}</code></pre>

      <h2 id="analytics">Marketplace Analytics via SxT</h2>
      <p>
        Use Space and Time to query verified marketplace data. Note that SxT currently indexes Ethereum — for Base marketplace analytics, direct RPC event queries are used until SxT adds Base indexing.
      </p>
      <pre><code>{`import { query } from '@dreamspace/sdk';

// Query verified Ethereum NFT transfer data from SxT
const stats = await query.sql(\`
  SELECT
    CONTRACT_ADDRESS,
    COUNT(*) as TRANSFER_COUNT
  FROM ETHEREUM.NFT_ERC721_TRANSFER
  WHERE BLOCK_NUMBER > 19000000
  GROUP BY CONTRACT_ADDRESS
  LIMIT 20
\`, { proof: true });

// The proof guarantees this data hasn't been tampered with`}</code></pre>

      <h2 id="offers">Offers</h2>
      <pre><code>{`// Make an offer on any NFT
const offer = await market.makeOffer({
  tokenAddress: '0xNFTContract...',
  tokenId: '42',
  amount: '0.3',
  currency: 'WETH',
  expiry: '48h',
});

// Owner can accept the offer
await market.acceptOffer(offer.id);`}</code></pre>
    </>
  );
}
