import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { createTransfer, friendlyError, liveCells, requireTestnet, testnetAddress, transactionStatus, type CheckedTransaction } from './ckb';
import './App.css';

type Account = { signer: ccc.Signer; client: ccc.Client; address: string; balance?: bigint };
type Draft = { signer: ccc.Signer; client: ccc.Client; sender: string; recipient: string; amount: string; tx: ccc.Transaction; fee: bigint };
type Submission = { hash: string; accepted: boolean; checked?: CheckedTransaction };

export default function App() {
  const { client, wallet, open, disconnect } = ccc.useCcc();
  const signer = ccc.useSigner();
  const [account, setAccount] = useState<Account>();
  const [walletError, setWalletError] = useState('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletAction, setWalletAction] = useState(false);
  const [cells, setCells] = useState<{ address: string; items: ccc.Cell[] }>();
  const [cellsLoading, setCellsLoading] = useState(false);
  const [cellsError, setCellsError] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [transferBusy, setTransferBusy] = useState<'prepare' | 'send'>();
  const [transferError, setTransferError] = useState('');
  const [submission, setSubmission] = useState<Submission>();
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const transactionLock = useRef(false);
  const cellsRequest = useRef(0);
  const statusRequest = useRef(0);
  const mounted = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Refresh actual connection/account data after wallet events and on window focus.
  useEffect(() => {
    let stopped = false;
    let version = 0;
    setAccount(undefined); setWalletError('');
    if (!signer || !wallet) { setWalletLoading(false); return; }
    const selected = signer;
    async function readAccount() {
      const request = ++version;
      setWalletLoading(true);
      try {
        requireTestnet(client); requireTestnet(selected.client);
        if (!await selected.isConnected()) throw new Error('Wallet disconnected. Connect again to continue.');
        const address = await selected.getRecommendedAddress();
        await testnetAddress(address, client);
        if (stopped || request !== version) return;
        setAccount(previous => previous?.signer === selected && previous.address === address && previous.client === client
          ? previous : { signer: selected, client, address });
        try {
          const balance = await selected.getBalance();
          if (!stopped && request === version) { setAccount({ signer: selected, client, address, balance }); setWalletError(''); }
        } catch (error) {
          if (!stopped && request === version) {
            setAccount({ signer: selected, client, address });
            setWalletError(`Balance unavailable. ${friendlyError(error)}`);
          }
        }
      } catch (error) {
        if (!stopped && request === version) { setAccount(undefined); setWalletError(friendlyError(error)); }
      } finally {
        if (!stopped && request === version) setWalletLoading(false);
      }
    }
    const refresh = () => { void readAccount(); };
    const unlisten = selected.onReplaced(() => { setAccount(undefined); refresh(); });
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => { stopped = true; version++; unlisten(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [signer, wallet, client]);

  const connected = !!wallet && !!signer && account?.signer === signer && account.client === client && client.addressPrefix === 'ckt' && signer.client.addressPrefix === 'ckt';
  const address = connected ? account.address : '';
  const signingSupported = connected && signer.signType !== ccc.SignerSignType.Unknown;
  const context = useRef({ client, signer, address, recipient, amount, signingSupported });
  context.current = { client, signer, address, recipient, amount, signingSupported };

  useEffect(() => {
    setDraft(undefined); setTransferError('');
  }, [recipient, amount, address, signer, client]);

  const refreshCells = useCallback(async () => {
    const request = ++cellsRequest.current;
    setCells(undefined); setCellsError('');
    if (!address) { setCellsLoading(false); return; }
    setCellsLoading(true);
    try {
      const items = await liveCells(client, address);
      if (mounted.current && request === cellsRequest.current) setCells({ address, items });
    } catch (error) {
      if (mounted.current && request === cellsRequest.current) setCellsError(friendlyError(error));
    } finally {
      if (mounted.current && request === cellsRequest.current) setCellsLoading(false);
    }
  }, [client, address]);
  useEffect(() => {
    void refreshCells();
    const counter = cellsRequest;
    return () => { counter.current++; };
  }, [refreshCells]);

  async function walletCommand(command: () => unknown) {
    setWalletAction(true); setWalletError('');
    try { await command(); } catch (error) { setWalletError(friendlyError(error)); }
    finally { if (mounted.current) setWalletAction(false); }
  }

  function draftMatches(value: Draft) {
    const current = context.current;
    return mounted.current && current.signingSupported && current.signer === value.signer && current.client === value.client &&
      current.address === value.sender && current.recipient.trim() === value.recipient && current.amount === value.amount;
  }

  async function validateDraft(value: Draft) {
    if (!draftMatches(value)) throw new Error('Wallet or transfer details changed. Prepare the transaction again.');
    requireTestnet(value.client); requireTestnet(value.signer.client);
    if (!await value.signer.isConnected() || await value.signer.getRecommendedAddress() !== value.sender || !draftMatches(value)) {
      throw new Error('The connected account changed. Prepare the transaction again.');
    }
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (transactionLock.current) return;
    transactionLock.current = true; setTransferBusy('prepare'); setTransferError(''); setDraft(undefined);
    try {
      if (!signer || !address || !signingSupported) throw new Error('Connect a Testnet wallet with signing support first.');
      requireTestnet(client); requireTestnet(signer.client);
      const { script } = await testnetAddress(recipient, client);
      const next: Draft = { signer, client, sender: address, recipient: recipient.trim(), amount, tx: createTransfer(script, amount), fee: 0n };
      await validateDraft(next);
      // Input selection and fee completion do not sign or broadcast.
      await next.tx.completeInputsByCapacity(signer);
      await next.tx.completeFeeBy(signer);
      next.fee = await next.tx.getFee(client);
      await validateDraft(next);
      if (mounted.current) setDraft(next);
    } catch (error) {
      if (mounted.current) setTransferError(friendlyError(error));
    } finally {
      transactionLock.current = false; if (mounted.current) setTransferBusy(undefined);
    }
  }

  async function send() {
    if (!draft || transactionLock.current || !draftMatches(draft)) return;
    transactionLock.current = true;
    const review = draft;
    if (!window.confirm(`Send ${review.amount} CKB on CKB Testnet?\n\nRecipient: ${review.recipient}\nEstimated fee: ${ccc.fixedPointToString(review.fee)} CKB\n\nConfirm to open your wallet for signing and broadcast this transfer.`)) {
      transactionLock.current = false; return;
    }
    setTransferBusy('send'); setTransferError('');
    statusRequest.current++; setStatusLoading(false); setStatusError('');
    try {
      await validateDraft(review);
      const signed = await review.signer.signTransaction(review.tx.clone());
      // Wallet prompts can take time. Revalidate before permitting a broadcast.
      await validateDraft(review);
      if (signed.hash() !== review.tx.hash()) throw new Error('The wallet modified the reviewed transaction. Prepare it again before sending.');
      setDraft(undefined);
      const hash = signed.hash();
      try {
        const submittedHash = await review.client.sendTransaction(signed);
        if (mounted.current) { setSubmission({ hash: submittedHash, accepted: true }); setStatusError(''); }
      } catch (error) {
        // An RPC failure can occur after the node received the transaction.
        if (mounted.current) setSubmission({ hash, accepted: false });
        throw new Error(`Broadcast acceptance is unknown. Check the transaction hash before retrying. ${friendlyError(error)}`);
      }
      void refreshCells();
    } catch (error) {
      if (mounted.current) { setDraft(undefined); setTransferError(friendlyError(error)); }
    } finally {
      transactionLock.current = false; if (mounted.current) setTransferBusy(undefined);
    }
  }

  async function checkStatus() {
    if (!submission || statusLoading) return;
    const hash = submission.hash;
    const request = ++statusRequest.current;
    setStatusLoading(true); setStatusError('');
    try {
      const checked = await transactionStatus(client, hash);
      if (mounted.current && request === statusRequest.current) setSubmission(previous => previous?.hash === hash ? { ...previous, checked } : previous);
    } catch (error) {
      if (mounted.current && request === statusRequest.current) setStatusError(friendlyError(error));
    } finally {
      if (mounted.current && request === statusRequest.current) setStatusLoading(false);
    }
  }
  useEffect(() => {
    statusRequest.current++; setStatusLoading(false); setStatusError('');
    setSubmission(previous => previous ? { hash: previous.hash, accepted: previous.accepted } : previous);
  }, [client]);

  const review = draft && draftMatches(draft) ? draft : undefined;
  const currentCells = connected && cells?.address === address ? cells.items : undefined;

  return <main>
    <header><h1>CKBuilder — First CKB dApp</h1><p className="subtitle">Week 02 · Lesson 06 · CKB Testnet</p></header>

    <section aria-labelledby="wallet-heading" id="wallet">
      <div className="section-top"><h2 id="wallet-heading"><span className="number">01</span>Wallet Connection</h2><span className="badge">CKB Testnet</span></div>
      {connected ? <dl className="details" aria-live="polite">
        <div><dt>Wallet</dt><dd>{wallet.name}</dd></div>
        <div><dt>Testnet address</dt><dd className="mono">{address}</dd></div>
        <div><dt>Balance</dt><dd>{account.balance === undefined ? 'Loading or unavailable' : `${ccc.fixedPointToString(account.balance)} CKB`}</dd></div>
      </dl> : <p className="muted" role="status">{walletLoading ? 'Checking wallet connection…' : 'Connect a wallet to view your Testnet balance and live Cells.'}</p>}
      <div className="actions">
        <button onClick={() => void walletCommand(open)} disabled={walletAction || !!transferBusy}>{connected ? 'Manage Wallet' : 'Connect Wallet'}</button>
        {(wallet || signer) && <button className="secondary" disabled={walletAction || !!transferBusy} onClick={() => void walletCommand(disconnect)}>Disconnect</button>}
        {connected && <span className="small">Connected</span>}
      </div>
      {walletError && <p className="notice error" role="alert">{walletError}</p>}
    </section>

    <section aria-labelledby="cells-heading" id="cells">
      <div className="section-top"><h2 id="cells-heading"><span className="number">02</span>Live Cell Explorer</h2><button className="secondary" disabled={!connected || cellsLoading} onClick={() => void refreshCells()}>{cellsLoading ? 'Loading…' : 'Refresh'}</button></div>
      <p className="muted">Up to five live Cells belonging to your connected Testnet address.</p>
      {!connected && <p className="small">Connect a wallet to query its live Cells.</p>}
      {cellsLoading && <p className="small" role="status">Querying CKB Testnet…</p>}
      {cellsError && connected && <p className="notice error" role="alert">{cellsError}</p>}
      {currentCells && <div aria-live="polite">
        {currentCells.length === 0 ? <p className="box muted">No live Cells found. This address may be empty or its Cells may already have been spent.</p> : currentCells.map((cell, index) => <article className="cell" key={`${cell.outPoint.txHash}:${cell.outPoint.index}`}>
          <p><strong>Cell {index + 1} · {ccc.fixedPointToString(cell.cellOutput.capacity)} CKB</strong></p>
          <p className="mono">{cell.outPoint.txHash}</p><p className="muted">Output index: {cell.outPoint.index.toString()}</p>
        </article>)}
      </div>}
    </section>

    <section aria-labelledby="send-heading" id="send">
      <div className="section-top"><h2 id="send-heading"><span className="number">03</span>Send CKB</h2></div>
      <p className="muted">Prepare a transfer, review its details, then confirm signing and sending.</p>
      <form onSubmit={prepare} aria-busy={!!transferBusy}>
        <div className="fields">
          <div><label htmlFor="recipient">Recipient Testnet address</label><input id="recipient" className="mono" value={recipient} placeholder="ckt1…" autoComplete="off" spellCheck={false} disabled={!!transferBusy} onChange={event => setRecipient(event.target.value)} /></div>
          <div><label htmlFor="amount">Amount (CKB)</label><input id="amount" value={amount} placeholder="e.g. 100" inputMode="decimal" autoComplete="off" disabled={!!transferBusy} onChange={event => setAmount(event.target.value)} /></div>
        </div>
        <p className="small">The amount must cover the recipient Cell’s storage capacity. Keep additional CKB available for the fee and change Cell.</p>
        <div className="actions"><button disabled={!signingSupported || !!transferBusy || !recipient.trim() || !amount.trim()}>{transferBusy === 'prepare' ? 'Preparing…' : 'Prepare Transaction'}</button></div>
      </form>
      {connected && !signingSupported && <p className="notice">This wallet does not advertise signing support. Connect a signing wallet to send CKB.</p>}
      {transferError && <p className="notice error" role="alert">{transferError}</p>}
      {review && <div className="box" aria-live="polite">
        <h3>Review transaction</h3>
        <dl className="details"><div><dt>Recipient</dt><dd className="mono">{review.recipient}</dd></div><div><dt>Amount</dt><dd>{review.amount} CKB</dd></div></dl>
        <dl className="summary">
          <div><dt>Inputs</dt><dd>{review.tx.inputs.length}</dd></div><div><dt>Outputs</dt><dd>{review.tx.outputs.length}</dd></div><div><dt>Witnesses</dt><dd>{review.tx.witnesses.length}</dd></div>
        </dl>
        <p className="muted">Estimated fee: <strong>{ccc.fixedPointToString(review.fee)} CKB</strong></p>
        <p className="small">Prepared only — not signed or broadcast. Change returns to your wallet.</p>
        <div className="actions"><button disabled={!!transferBusy || !signingSupported} onClick={() => void send()}>{transferBusy === 'send' ? 'Waiting for wallet / Testnet…' : 'Sign & Send'}</button><button className="secondary" disabled={!!transferBusy} onClick={() => setDraft(undefined)}>Discard</button></div>
      </div>}
      {submission && <div className="box" aria-live="polite">
        <h3>Transaction submission</h3>
        <p className="mono">{submission.hash}</p>
        <p className="muted">{submission.accepted ? 'Broadcast accepted by the Testnet node. Check status for on-chain confirmation.' : 'Broadcast acceptance unknown. Check status before retrying.'}</p>
        {submission.checked && <>
          <p>Status: <strong>{submission.checked.status}</strong></p>
          {submission.checked.status === 'committed' && <p>Block number: <strong>{submission.checked.block ?? 'Unavailable from node'}</strong></p>}
          {submission.checked.reason && <p className="notice error">{submission.checked.reason}</p>}
          {submission.checked.status === 'unknown' && <p className="small">This node does not currently know this transaction. This does not prove rejection.</p>}
          {['sent', 'pending', 'proposed'].includes(submission.checked.status) && <p className="small">Not yet confirmed in a block.</p>}
          <p className="small">Last checked: {submission.checked.checkedAt}</p>
        </>}
        <div className="actions"><button className="secondary" disabled={statusLoading || !!transferBusy} onClick={() => void checkStatus()}>{statusLoading ? 'Checking…' : 'Check Transaction Status'}</button><a className="small" href={`https://testnet.explorer.nervos.org/transaction/${submission.hash}`} target="_blank" rel="noreferrer">View in Testnet Explorer</a></div>
        {statusError && <p className="notice error" role="alert">Status query failed: {statusError}</p>}
      </div>}
    </section>
  </main>;
}
