export default function Components() {
  return (
    <>
      <h1>Components</h1>
      <p>
        The Components module provides pre-built React components for common Web3 UI patterns. Wallet connect buttons, NFT galleries, token displays, and transaction feeds — styled and ready to use.
      </p>

      <h2 id="overview">Overview</h2>
      <pre><code>{`import {
  ConnectWallet,
  NFTGallery,
  TokenBalance,
  TransactionFeed,
} from '@dreamspace/sdk/components';`}</code></pre>

      <h2 id="connect-wallet">ConnectWallet</h2>
      <p>
        Drop-in wallet connection button with support for MetaMask, WalletConnect, Coinbase Wallet, and embedded wallets.
      </p>
      <pre><code>{`<ConnectWallet
  theme="dark"
  chains={['base', 'ethereum']}
  onConnect={(address) => console.log('Connected:', address)}
  onDisconnect={() => console.log('Disconnected')}
/>`}</code></pre>

      <h2 id="nft-gallery">NFTGallery</h2>
      <p>
        Display a user&apos;s NFT collection with lazy loading, metadata resolution, and grid/list layouts.
      </p>
      <pre><code>{`<NFTGallery
  address="0xHolder..."
  chains={['base', 'ethereum']}
  layout="grid"          // 'grid' | 'list' | 'carousel'
  columns={3}
  onSelect={(nft) => console.log('Selected:', nft.tokenId)}
/>`}</code></pre>

      <h2 id="token-balance">TokenBalance</h2>
      <pre><code>{`<TokenBalance
  address="0xHolder..."
  tokens={['ETH', '0xTokenAddress...']}
  showUsdValue={true}
  chain="base"
/>`}</code></pre>

      <h2 id="transaction-feed">TransactionFeed</h2>
      <pre><code>{`<TransactionFeed
  address="0xUser..."
  chain="base"
  limit={20}
  showPending={true}
  onTransactionClick={(tx) => window.open(tx.explorerUrl)}
/>`}</code></pre>

      <h2 id="theming">Theming</h2>
      <p>
        All components accept a <code>theme</code> prop and can be customized via CSS variables or a theme object.
      </p>
      <pre><code>{`import { DreamSpaceProvider } from '@dreamspace/sdk/components';

<DreamSpaceProvider
  theme={{
    primaryColor: '#EC4899',
    borderRadius: '12px',
    fontFamily: 'Space Grotesk',
    mode: 'dark',
  }}
>
  <App />
</DreamSpaceProvider>`}</code></pre>
    </>
  );
}
