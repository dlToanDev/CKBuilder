# CKB Simple dApp

CKBuilder Week 02 · Lesson 06. A small React 18 / TypeScript application for CKB Testnet with CCC wallet connection, live Cell queries, and reviewed CKB transfers. Built with Vite and the official CCC React template's single-Provider pattern; its older CRA/TypeScript 4 tooling is replaced for current SDK compatibility.

Requires Node.js 20.19+ or 22.12+ and npm.

```bash
npm ci
npm start
```

Open http://localhost:3010. To build or check types:

```bash
npm run build
npm run typecheck
```

## Use

1. **Wallet Connection:** select Connect Wallet and approve a compatible wallet on CKB Testnet. The app displays its actual name, recommended address, and balance. Disconnect ends the session.
2. **Live Cell Explorer:** connecting automatically queries up to five live Cells for that address. Refresh queries again. An empty address displays an empty state.
3. **Send CKB:** use a funded Testnet wallet, enter a valid `ckt1…` recipient and amount, and select Prepare Transaction. Review input/output/witness counts and the estimated fee. Preparation does not broadcast. Select Sign & Send, explicitly confirm the transfer, then approve signing in the wallet. Check Transaction Status queries the node for the submitted hash and displays its block number when committed.

Amounts support eight decimal places. Minimum output capacity is calculated from the recipient Script; a basic empty secp256k1 Cell requires 61 CKB. Fees and a change Cell may require more spendable capacity than the transfer amount. Editing details or changing/disconnecting the wallet invalidates preparation. Mainnet is blocked. If broadcast acceptance is unknown after a network error, check the recorded signed transaction hash before retrying.

Wallet connection, funding, signing, broadcasting, and verification of a transfer made through this app require manual testing with your own wallet. No credentials, mock balances, or fabricated transaction results are included. Data is kept in memory; reloading clears the prepared transfer and submission display.
