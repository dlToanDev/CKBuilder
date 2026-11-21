import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import "./App.css";

type WalletInfo = {
  address: string;
  balance: string;
  codeHash: string;
  hashType: string;
  args: string;
};

export default function App() {
  const { open, disconnect, wallet, client } = ccc.useCcc();
  const signer = ccc.useSigner();

  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const connected = Boolean(wallet && signer);

  useEffect(() => {
    let cancelled = false;

    async function loadWalletInfo() {
      if (!signer || !wallet) {
        setInfo(null);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const address = await signer.getRecommendedAddress();
        const addressObj = await signer.getRecommendedAddressObj();
        const balance = await signer.getBalance();

        if (cancelled) return;

        setInfo({
          address,
          balance: ccc.fixedPointToString(balance),
          codeHash: addressObj.script.codeHash,
          hashType: addressObj.script.hashType,
          args: addressObj.script.args,
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Cannot load wallet information"
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadWalletInfo();

    return () => {
      cancelled = true;
    };
  }, [signer, wallet]);

  return (
    <div className="app">
      <div className="card">
        <h1>CKBuilder - Week 02</h1>
        <p className="subtitle">Lesson 04: Wallet Integration</p>

        <div className="row">
          <span>Status</span>
          <strong className={connected ? "ok" : "off"}>
            {connected ? "Connected" : "Disconnected"}
          </strong>
        </div>

        <div className="row">
          <span>Network</span>
          <strong>
            {client.addressPrefix === "ckt" ? "CKB Testnet" : "Other"}
          </strong>
        </div>

        <div className="actions">
          {!connected ? (
            <button onClick={open}>Connect Wallet</button>
          ) : (
            <button className="secondary" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>

        {loading && <p className="note">Loading wallet information...</p>}
        {error && <p className="error">{error}</p>}

        {connected && info && (
          <div className="info">
            <h2>Wallet Information</h2>

            <div className="field">
              <span>Wallet</span>
              <strong>{wallet?.name}</strong>
            </div>

            <div className="field vertical">
              <span>Address</span>
              <code>{info.address}</code>
            </div>

            <div className="field">
              <span>Balance</span>
              <strong>{info.balance} CKB</strong>
            </div>

            <h2>Lock Script</h2>

            <div className="field vertical">
              <span>Code Hash</span>
              <code>{info.codeHash}</code>
            </div>

            <div className="field">
              <span>Hash Type</span>
              <strong>{info.hashType}</strong>
            </div>

            <div className="field vertical">
              <span>Args</span>
              <code>{info.args}</code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}