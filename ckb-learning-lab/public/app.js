"use strict";

const $ = (id) => document.getElementById(id);
const UINT128_MAX = (1n << 128n) - 1n;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const INTENT_KEY = "ckbuilder.token.submission.v1";
const state = {
  token: null, infoReady: false, walletReady: false, accounts: [],
  records: new Map(), accountBalances: new Map(), selectedHash: null,
  balanceAddress: null, balanceVersion: 0, balanceBusy: false,
  submitting: false, refreshing: false, polling: false, mintedThisSession: false,
  intent: readIntent(), receiverInitialized: false,
};

function readIntent() {
  try {
    const intent = JSON.parse(sessionStorage.getItem(INTENT_KEY));
    if (!intent || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intent.key)) return null;
    if (intent.kind === "mint" && typeof intent.body?.name === "string" && typeof intent.body?.symbol === "string" && typeof intent.body?.initialSupply === "string") return intent;
    if (intent.kind === "transfer" && typeof intent.body?.receiver === "string" && typeof intent.body?.amount === "string") return intent;
  } catch { /* Storage can be unavailable; the active page still retains the key. */ }
  return null;
}

function saveIntent(intent) {
  state.intent = intent;
  try {
    if (intent) sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
    else sessionStorage.removeItem(INTENT_KEY);
  } catch { /* An in-memory intent still protects retries in this page. */ }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class ApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(code ? `${code}: ${message}` : message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {
      ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json", ...options.headers },
    });
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError("The server returned an unreadable response. Check that this API route is available.", response.ok ? 0 : response.status); }
    if (!response.ok || data.error) {
      const detail = data.error;
      throw new ApiError(typeof detail === "string" ? detail : detail?.message || `Request failed (${response.status}).`, response.status, detail?.code);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.name === "AbortError" ? "Request timed out. Its outcome may still be pending." : "Cannot reach the API. Check the local server and devnet connection.");
  } finally { clearTimeout(timeout); }
}

function message(id, text, tone = "") {
  $(id).textContent = text;
  $(id).className = `feedback ${tone}`;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function json(value) { return JSON.stringify(value, null, 2); }
function short(value) { return value && value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value || "—"; }
function tokenSymbol() { return state.token?.symbol || "token units"; }
function metadata(container, pairs) {
  container.replaceChildren();
  for (const [label, value] of pairs) {
    container.append(element("dt", label), element("dd", value === null || value === undefined || value === "" ? "—" : value, "mono"));
  }
}

function statusOf(record) { return String(record.transaction?.status || record.operation?.status || "pending").toLowerCase(); }
function isConfirmed(status) { return status === "committed"; }
function isFailed(status) { return ["rejected", "failed"].includes(status); }
function pendingRecords() { return Array.from(state.records.values()).filter((record) => !isConfirmed(statusOf(record)) && !isFailed(statusOf(record))); }
function pendingMutations() { return pendingRecords().filter((record) => ["mint", "transfer"].includes(record.operation.kind)); }
function statusBadge(status) { return element("span", status, `badge ${isConfirmed(status) ? "confirmed" : isFailed(status) ? "failed" : "pending"}`); }

function syncControls() {
  const pending = pendingRecords().length;
  const blocking = pendingMutations().length;
  const locked = state.submitting || Boolean(state.intent) || blocking > 0;
  $("create-fields").disabled = !state.infoReady || !state.walletReady || Boolean(state.token) || state.mintedThisSession || locked;
  $("transfer-fields").disabled = !state.infoReady || !state.walletReady || !state.token || locked;
  $("check-balance").disabled = !state.infoReady || !state.token || state.balanceBusy;
  $("refresh").disabled = state.refreshing;
  $("pending-count").textContent = `${pending} pending`;
  $("retry-submission").hidden = !state.intent;
  $("retry-submission").disabled = state.submitting;
  if (state.token) message("create-message", `Saved token: ${state.token.name} (${state.token.symbol}). Initial supply: ${state.token.initialSupply}.`, "success");
  else if (state.mintedThisSession) message("create-message", "Mint submitted. Refresh data to load the saved token configuration.");
  else if (state.infoReady && !state.intent && !state.submitting) message("create-message", "No token exists yet. Create Token submits a mint transaction.");
  if (state.intent && !state.submitting) {
    const detail = state.intent.message ? `${state.intent.message} ` : "";
    message("action-message", `${detail}The ${state.intent.kind} submission has an uncertain outcome. Retry the same submission to recover its result with the original idempotency key. Its form values are retained.`, "error");
    if (state.intent.message) message(state.intent.kind === "mint" ? "create-message" : "transfer-message", state.intent.message, "error");
  } else if (blocking && !state.submitting) {
    message("action-message", `${blocking} token transaction${blocking === 1 ? " is" : "s are"} awaiting confirmation. Checking every 2 seconds; token actions unlock when settled.`);
  }
  if (!state.token && !state.intent) message("transfer-message", "Create a token first to enable transfers.");
  else if (state.token && $("transfer-message").textContent === "Create a token first to enable transfers.") message("transfer-message", "");
}

async function refreshDevnet() {
  $("status").textContent = "Checking…";
  $("status").className = "";
  try {
    const data = await api("/api/health");
    $("status").textContent = data.status;
    $("status").className = data.status === "connected" ? "connected" : "disconnected";
    $("block").textContent = data.block ?? "—";
    $("network").textContent = data.network || "OffCKB Local Devnet";
    $("rpc").textContent = data.rpc || "http://127.0.0.1:8114";
  } catch (error) {
    $("status").textContent = "disconnected";
    $("status").className = "disconnected";
    $("status").title = error.message;
    $("block").textContent = "—";
    throw error;
  }
}

async function loadWallet() {
  try {
    const data = await api("/api/wallet");
    state.accounts = Array.isArray(data.accounts) && data.accounts.length ? data.accounts : [data];
    state.accounts = state.accounts.filter((account) => account.address);
    state.walletReady = state.accounts.length > 0;
    if (!$("balance-address").value) $("balance-address").value = data.address || state.accounts[0]?.address || "";
    renderAccounts();
    $("receiver-account").replaceChildren(new Option("Enter an address below", ""));
    state.accounts.forEach((account) => $("receiver-account").add(new Option(`Account ${account.account} · ${short(account.address)}`, account.address)));
    if (!state.receiverInitialized && state.walletReady) {
      if (!$("receiver").value) $("receiver").value = state.accounts.find((account) => String(account.account) === "1")?.address || "";
      state.receiverInitialized = true;
    }
    $("receiver-account").value = $("receiver").value;
    message("wallet-message", state.walletReady ? "" : "No devnet accounts were returned.", state.walletReady ? "" : "error");
  } catch (error) {
    state.walletReady = false;
    message("wallet-message", `Wallet unavailable: ${error.message}`, "error");
    throw error;
  } finally { syncControls(); }
}

function renderAccounts() {
  $("accounts").replaceChildren();
  for (const account of state.accounts) {
    const card = element("article", undefined, "account");
    card.append(element("h4", `Account ${account.account}${String(account.account) === "0" ? " · Sender" : ""}`), element("p", account.address, "mono address"));
    card.append(element("p", `${account.balanceCkb ?? "—"} spendable CKB`));
    const balance = state.accountBalances.get(account.address);
    const tokenBalance = element("p", state.token ? balance?.error ? `Token balance unavailable: ${balance.error}` : `${balance?.balance ?? "—"} ${tokenSymbol()}` : "Create a token to see its balance.");
    if (balance?.error) tokenBalance.className = "error";
    card.append(tokenBalance);
    const check = element("button", "Check tokens");
    check.type = "button";
    check.disabled = !state.token;
    check.addEventListener("click", () => { $("balance-address").value = account.address; checkBalance(account.address); });
    const copy = element("button", "Copy address");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(account.address, copy));
    card.append(check, copy);
    $("accounts").append(card);
  }
}

function addOperation(operation) {
  if (!operation?.hash) return;
  const existing = state.records.get(operation.hash);
  if (existing) existing.operation = { ...existing.operation, ...operation };
  else state.records.set(operation.hash, { hash: operation.hash, operation, transaction: null, error: "" });
}

async function loadInfo() {
  try {
    const info = await api("/api/token/info");
    state.token = info.token;
    state.infoReady = true;
    $("token-standard").textContent = info.standard || "sUDT";
    $("script-info").textContent = json(info.scriptInfo);
    const token = state.token;
    if (token) {
      $("token-name").value = token.name;
      $("token-symbol").value = token.symbol;
      $("initial-supply").value = token.initialSupply;
      $("config-summary").textContent = `${token.name} (${token.symbol}) · Initial supply ${token.initialSupply}`;
      metadata($("token-config"), [["Owner address", token.ownerAddress], ["Type hash", token.typeHash], ["Mint transaction", token.mintTxHash]]);
      $("type-script").textContent = json(token.typeScript);
      if (token.mintTxHash) addOperation({ kind: "mint", hash: token.mintTxHash, receiver: token.ownerAddress, amount: token.initialSupply });
    } else {
      $("config-summary").textContent = "No token created yet. The deployed sUDT script is shown below.";
      $("token-config").replaceChildren();
      $("type-script").textContent = "No token created yet.";
    }
    (info.operations || []).forEach(addOperation);
    document.querySelectorAll(".token-symbol").forEach((node) => { node.textContent = tokenSymbol(); });
    message("token-message", token ? "Saved token configuration and prior operations loaded. Amounts are integer token units." : "Ready to create a token using the deployed sUDT script.", token ? "success" : "");
    renderAccounts();
    renderHistory();
  } catch (error) {
    state.infoReady = false;
    message("token-message", `Token service unavailable: ${error.message} Use Refresh data to retry.`, "error");
    throw error;
  } finally { syncControls(); }
}

async function refreshBalances() {
  if (!state.token) return;
  const addresses = new Set(state.accounts.map((account) => account.address));
  if (state.balanceAddress) addresses.add(state.balanceAddress);
  for (const record of state.records.values()) {
    if (record.transaction?.receiver) addresses.add(record.transaction.receiver);
  }
  const results = await Promise.allSettled(Array.from(addresses, async (address) => {
    try {
      const data = await api(`/api/token/balance?address=${encodeURIComponent(address)}`);
      state.accountBalances.set(address, data);
      if (state.balanceAddress === address && !state.balanceBusy) renderBalance(data);
    } catch (error) {
      state.accountBalances.set(address, { error: error.message });
      if (state.balanceAddress === address && !state.balanceBusy) message("balance-message", `Balance refresh failed: ${error.message}. Displayed value may be stale.`, "error");
      throw error;
    }
  }));
  renderAccounts();
  const errors = results.filter((result) => result.status === "rejected");
  if (errors.length) throw new Error(`${errors.length} token balance lookup(s) failed. ${errors[0].reason.message}`);
}

function renderBalance(data) {
  $("balance-result").hidden = false;
  $("balance-amount").textContent = data.balance;
  $("balance-owner").textContent = data.address;
  $("balance-cells").textContent = json(data.cells);
  message("balance-message", "Confirmed live-cell balance loaded.", "success");
}

async function checkBalance(address) {
  if (!state.token) return;
  address = address.trim();
  if (!address) return;
  const version = ++state.balanceVersion;
  state.balanceBusy = true;
  state.balanceAddress = address;
  $("balance-result").hidden = true;
  message("balance-message", "Checking token balance…");
  syncControls();
  try {
    const data = await api(`/api/token/balance?address=${encodeURIComponent(address)}`);
    state.accountBalances.set(address, data);
    renderAccounts();
    if (version === state.balanceVersion) renderBalance(data);
  } catch (error) {
    if (version === state.balanceVersion) message("balance-message", error.message, "error");
  } finally {
    if (version === state.balanceVersion) { state.balanceBusy = false; syncControls(); }
  }
}

function renderHistory() {
  const records = Array.from(state.records.values()).reverse();
  $("history-table").hidden = records.length === 0;
  $("history-message").textContent = records.length ? "Inspect any operation to view its transaction and output cells." : "No operations yet. Your mint and transfer history will appear here.";
  $("history-body").replaceChildren();
  for (const record of records) {
    const tx = record.transaction || record.operation;
    const row = element("tr");
    if (record.hash === state.selectedHash) row.className = "selected";
    row.append(element("td", record.operation.kind === "mint" ? "Mint" : record.operation.kind === "transfer" ? "Transfer" : "Transaction"));
    row.append(element("td", `${tx.amount ?? record.operation.amount ?? "—"} ${tokenSymbol()}`, "amount"));
    const receiver = element("td", short(tx.receiver));
    receiver.title = tx.receiver || "";
    row.append(receiver);
    const hashCell = element("td");
    const hash = element("code", record.hash, "hash");
    const copy = element("button", "Copy hash", "copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(record.hash, copy));
    hashCell.append(hash, copy);
    row.append(hashCell);
    const statusCell = element("td");
    statusCell.append(statusBadge(statusOf(record)));
    if (record.error) statusCell.append(element("p", `Update failed: ${record.error}. Will retry.`, "hint error"));
    row.append(statusCell);
    const inspectCell = element("td");
    const inspect = element("button", "Inspect");
    inspect.type = "button";
    inspect.addEventListener("click", () => inspectTransaction(record.hash));
    inspectCell.append(inspect);
    row.append(inspectCell);
    $("history-body").append(row);
  }
  syncControls();
}

function renderTransaction(record) {
  const tx = record.transaction;
  if (!tx || state.selectedHash !== record.hash) return;
  $("transaction-detail").hidden = false;
  $("selected-hash").textContent = tx.hash;
  $("selected-status").replaceWith(Object.assign(statusBadge(statusOf(record)), { id: "selected-status" }));
  metadata($("transaction-meta"), [["Block number", tx.blockNumber], ["Sender", tx.sender], ["Receiver", tx.receiver], ["Amount", tx.amount === undefined ? null : `${tx.amount} ${tokenSymbol()}`]]);
  $("transaction-outputs").replaceChildren();
  (tx.outputs || []).forEach((output) => {
    const card = element("article", undefined, "output");
    card.append(element("h4", `Output #${output.index}`));
    const details = element("dl", undefined, "metadata");
    metadata(details, [["Capacity (shannon)", output.capacityShannon], ["Token amount", output.tokenAmount ?? "No token"]]);
    card.append(details);
    for (const [label, value] of [["Lock script", output.lock], ["Type script", output.type], ["Cell data (raw hex)", output.data]]) {
      const disclosure = element("details");
      disclosure.open = label === "Cell data (raw hex)";
      disclosure.append(element("summary", label), element("pre", typeof value === "string" ? value : json(value ?? null)));
      card.append(disclosure);
    }
    $("transaction-outputs").append(card);
  });
  if (!tx.outputs?.length) $("transaction-outputs").append(element("p", "No outputs available in this response.", "muted"));
  $("transaction-json").textContent = json(tx);
  $("refresh-transaction").disabled = false;
  const status = statusOf(record);
  message("transaction-message", isFailed(status) ? `Transaction ${status}. ${tx.reason || tx.message || "Inspect the response for rejection details."}` : status === "unknown" ? record.uncertainMessage || tx.message || "The node has not acknowledged this transaction. Its broadcast outcome is uncertain; polling every 2 seconds." : isConfirmed(status) ? "Transaction confirmed. Its outputs are shown below." : `Transaction ${status}. Polling every 2 seconds.`, isFailed(status) || status === "unknown" ? "error" : isConfirmed(status) ? "success" : "");
}

const transactionRequests = new Map();
function fetchTransaction(record) {
  if (transactionRequests.has(record.hash)) return transactionRequests.get(record.hash);
  const request = (async () => {
    const before = statusOf(record);
    try {
      const tx = await api(`/api/token/transaction/${encodeURIComponent(record.hash)}`);
      record.transaction = tx;
      record.error = "";
      if (state.intent?.hash === record.hash && (isConfirmed(statusOf(record)) || isFailed(statusOf(record)))) {
        saveIntent(null);
        message("action-message", isConfirmed(statusOf(record)) ? "The uncertain transaction is now committed." : `The uncertain transaction was ${statusOf(record)}. Inspect its response for details.`, isConfirmed(statusOf(record)) ? "success" : "error");
      }
      renderTransaction(record);
      return !isConfirmed(before) && isConfirmed(statusOf(record));
    } catch (error) {
      record.error = error.message;
      if (state.selectedHash === record.hash) message("transaction-message", `${error.message} Transaction updates will retry while pending.`, "error");
      throw error;
    }
  })().finally(() => transactionRequests.delete(record.hash));
  transactionRequests.set(record.hash, request);
  return request;
}

async function inspectTransaction(hash) {
  if (!HASH_PATTERN.test(hash)) { message("transaction-message", "Enter a transaction hash: 0x followed by 64 hexadecimal characters.", "error"); return; }
  if (!state.records.has(hash)) addOperation({ hash });
  state.selectedHash = hash;
  $("transaction-hash").value = hash;
  $("transaction-detail").hidden = true;
  message("transaction-message", "Loading transaction…");
  const record = state.records.get(hash);
  renderTransaction(record);
  try {
    if (await fetchTransaction(record)) await refreshConfirmedData();
  } catch { /* The transaction error is rendered by fetchTransaction. */ }
  renderHistory();
}

async function refreshConfirmedData() {
  const results = await Promise.allSettled([loadWallet(), loadInfo()]);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason.message);
  try { await refreshBalances(); } catch (error) { errors.push(error.message); }
  if (errors.length) message("refresh-message", `Transaction confirmed, but some data could not be refreshed: ${errors.join(" ")} Use Refresh data to retry.`, "error");
  else message("refresh-message", "Confirmed balances, accounts, and token configuration refreshed.", "success");
}

async function refreshAll() {
  if (state.refreshing) return;
  state.refreshing = true;
  syncControls();
  message("refresh-message", "Refreshing devnet, wallet, and token data…");
  const results = await Promise.allSettled([refreshDevnet(), loadWallet(), loadInfo()]);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason.message);
  if (!state.selectedHash && state.records.size) {
    state.selectedHash = Array.from(state.records.keys()).at(-1);
    $("transaction-hash").value = state.selectedHash;
  }
  const txResults = await Promise.allSettled(Array.from(state.records.values(), fetchTransaction));
  const txErrors = txResults.filter((result) => result.status === "rejected");
  if (txErrors.length) errors.push(`${txErrors.length} transaction lookup(s) failed; inspect history for details.`);
  try { await refreshBalances(); } catch (error) { errors.push(error.message); }
  state.refreshing = false;
  renderHistory();
  message("refresh-message", errors.length ? errors.join(" ") : "Devnet, wallet, token configuration, and balances are up to date.", errors.length ? "error" : "success");
}

async function pollPending() {
  if (state.polling || state.refreshing || !pendingRecords().length) return;
  state.polling = true;
  try {
    const results = await Promise.allSettled(pendingRecords().map(fetchTransaction));
    if (results.some((result) => result.status === "fulfilled" && result.value)) await refreshConfirmedData();
    if (!pendingRecords().length && !state.intent) message("action-message", "All tracked transactions have settled. Inspect their status below.");
    renderHistory();
  } finally { state.polling = false; }
}

function positiveInteger(value, label) {
  const text = value.trim();
  if (!/^[0-9]+$/.test(text) || text.length > 39 || BigInt(text) <= 0n || BigInt(text) > UINT128_MAX) throw new Error(`${label} must be a positive integer no larger than ${UINT128_MAX}.`);
  return BigInt(text).toString();
}

async function submit(kind, body) {
  if (state.submitting) return;
  if (!state.intent && (!state.infoReady || !state.walletReady || pendingMutations().length)) return;
  if (!state.intent && (kind === "mint" ? state.token || state.mintedThisSession : !state.token)) return;
  const intent = state.intent || { kind, body, key: uuid() };
  saveIntent(intent);
  state.submitting = true;
  const feedback = intent.kind === "mint" ? "create-message" : "transfer-message";
  syncControls();
  message(feedback, `Submitting ${intent.kind} transaction…`);
  message("action-message", "Submitting transaction. Please wait…");
  try {
    const result = await api(intent.kind === "mint" ? "/api/token/create" : "/api/token/transfer", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": intent.key }, body: JSON.stringify(intent.body),
    });
    if (!result.operation?.hash || !result.transaction?.hash) throw new ApiError("Submission response is incomplete. Retry with the same key to recover the transaction.");
    addOperation(result.operation);
    const record = state.records.get(result.operation.hash);
    record.transaction = result.transaction;
    if (intent.kind === "mint") state.mintedThisSession = true;
    state.selectedHash = record.hash;
    $("transaction-hash").value = record.hash;
    const status = statusOf(record);
    if (status === "unknown") {
      intent.hash = record.hash;
      intent.message = result.message || "The node has not acknowledged the broadcast. The transaction outcome is uncertain.";
      record.uncertainMessage = intent.message;
      saveIntent(intent);
      message(feedback, intent.message, "error");
      message("action-message", intent.message, "error");
    } else {
      saveIntent(null);
      message(feedback, isFailed(status) ? result.message || `Transaction ${status}. Inspect its response for details.` : `${intent.kind === "mint" ? "Mint" : "Transfer"} submitted: ${record.hash}`, isFailed(status) ? "error" : "success");
      message("action-message", isFailed(status) ? result.message || `Transaction ${status}. Inspect its response for details.` : "Transaction submitted. Inspect its status and outputs below.", isFailed(status) ? "error" : "success");
    }
    renderTransaction(record);
    renderHistory();
    // Refreshing configuration never submits a mint, even after a page reload.
    try { await loadInfo(); } catch { /* Keep the successful submission visible. */ }
    if (isConfirmed(statusOf(record))) await refreshConfirmedData();
  } catch (error) {
    // A timeout, 5xx, or conflict can occur after broadcast; keep the original UUID.
    if (error.status >= 400 && error.status < 500 && ![408, 409, 425, 429].includes(error.status)) saveIntent(null);
    message(feedback, error.message, "error");
    message("action-message", error.message, "error");
  } finally {
    state.submitting = false;
    renderHistory();
  }
}

async function copyText(value, button) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const textarea = element("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      try { textarea.select(); if (!document.execCommand("copy")) throw new Error("Copy unavailable"); }
      finally { textarea.remove(); button.focus(); }
    }
    const label = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = label; }, 1800);
  } catch { message("refresh-message", "Clipboard unavailable. Select the displayed address or hash and copy it manually.", "error"); }
}

const tabs = Array.from(document.querySelectorAll(".tab"));
function activateTab(button) {
  tabs.forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute("aria-controls")).hidden = !active;
  });
}
tabs.forEach((button, index) => {
  button.addEventListener("click", () => activateTab(button));
  button.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); activateTab(tabs[next]); tabs[next].focus(); }
  });
});

$("refresh").addEventListener("click", refreshAll);
$("balance-form").addEventListener("submit", (event) => { event.preventDefault(); checkBalance($("balance-address").value); });
$("receiver-account").addEventListener("change", () => { state.receiverInitialized = true; if ($("receiver-account").value) $("receiver").value = $("receiver-account").value; });
$("receiver").addEventListener("input", () => { state.receiverInitialized = true; $("receiver-account").value = state.accounts.some((account) => account.address === $("receiver").value) ? $("receiver").value : ""; });
$("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const name = $("token-name").value.trim();
    const symbol = $("token-symbol").value.trim();
    if (!name || !symbol) throw new Error("Enter a token name and symbol.");
    const initialSupply = positiveInteger($("initial-supply").value, "Initial supply");
    submit("mint", { name, symbol, initialSupply });
  } catch (error) { message("create-message", error.message, "error"); }
});
$("transfer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const receiver = $("receiver").value.trim();
    if (!receiver) throw new Error("Enter a receiver address.");
    const amount = positiveInteger($("transfer-amount").value, "Amount");
    submit("transfer", { receiver, amount });
  } catch (error) { message("transfer-message", error.message, "error"); }
});
$("transaction-form").addEventListener("submit", (event) => { event.preventDefault(); inspectTransaction($("transaction-hash").value.trim()); });
$("refresh-transaction").addEventListener("click", () => { if (state.selectedHash) inspectTransaction(state.selectedHash); });
$("copy-hash").addEventListener("click", () => { if (state.selectedHash) copyText(state.selectedHash, $("copy-hash")); });
$("retry-submission").addEventListener("click", () => { if (state.intent) submit(state.intent.kind, state.intent.body); });

if (state.intent) {
  const { kind, body } = state.intent;
  if (kind === "mint") { $("token-name").value = body.name; $("token-symbol").value = body.symbol; $("initial-supply").value = body.initialSupply; }
  else { $("receiver").value = body.receiver; $("transfer-amount").value = body.amount; state.receiverInitialized = true; }
}
syncControls();
refreshAll();
setInterval(pollPending, 2000);
