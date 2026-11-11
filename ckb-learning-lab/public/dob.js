"use strict";

// Reuse the lab's API client, DOM helpers, account state and connection panel.
(() => {
  const INTENT = "ckbuilder.dob.submission.v1";
  const dob = { ready: false, loaded: false, busy: false, refreshing: false, viewing: false, inspecting: false, objects: new Map(), operations: [], transactions: new Map(), selectedId: null, selectedHash: null, intent: null, receiverInitialized: false };
  try {
    const saved = JSON.parse(sessionStorage.getItem(INTENT));
    if (saved && ["create", "transfer"].includes(saved.kind) && /^[A-Za-z0-9_-]{8,100}$/.test(saved.key) && saved.body && typeof saved.body === "object") dob.intent = saved;
  } catch { /* Keep an in-memory intent if storage is unavailable. */ }
  function remember(intent) {
    dob.intent = intent;
    try { if (intent) sessionStorage.setItem(INTENT, JSON.stringify(intent)); else sessionStorage.removeItem(INTENT); } catch { /* Active-page retries still use the original key. */ }
  }
  function pending() { return dob.operations.filter((op) => !["committed", "rejected"].includes(dob.transactions.get(op.hash)?.status)); }
  function controls() {
    const locked = !dob.ready || !state.walletReady || dob.busy || dob.refreshing || Boolean(dob.intent) || pending().length > 0;
    $("dob-create-fields").disabled = locked;
    $("dob-transfer-fields").disabled = locked || !Array.from(dob.objects.values()).some((object) => object.canTransfer);
    $("dob-refresh").disabled = dob.refreshing || dob.busy;
    $("dob-view-button").disabled = dob.viewing;
    $("dob-inspect-button").disabled = dob.inspecting;
    $("dob-refresh-transaction").disabled = dob.inspecting || !dob.selectedHash;
    $("dob-retry").hidden = !dob.intent;
    $("dob-retry").disabled = dob.busy || dob.refreshing;
    $("dob-pending-count").textContent = `${pending().length} pending / unknown`;
  }
  function accountOptions() {
    const select = $("dob-receiver-account");
    const previous = select.value;
    select.replaceChildren(new Option("Enter address below", ""));
    for (const account of state.accounts) select.add(new Option(`Account #${account.account} · ${short(account.address)}`, account.address));
    if (!dob.receiverInitialized && state.accounts.length) {
      $("dob-receiver").value = state.accounts.find((account) => Number(account.account) === 1)?.address || "";
      dob.receiverInitialized = true;
    }
    select.value = state.accounts.some((account) => account.address === $("dob-receiver").value) ? $("dob-receiver").value : previous;
  }
  function objectOptions() {
    const select = $("dob-select"), previous = select.value;
    select.replaceChildren(new Option("Select an object with an available owner key", ""));
    for (const object of dob.objects.values()) {
      const option = new Option(`${object.data?.name || short(object.id)} · ${short(object.id)}${object.canTransfer ? "" : " · unavailable"}`, object.id);
      option.disabled = !object.canTransfer;
      select.add(option);
    }
    if (dob.objects.get(previous)?.canTransfer) select.value = previous;
    else select.value = Array.from(dob.objects.values()).find((object) => object.canTransfer)?.id || "";
  }
  function renderHistory() {
    const body = $("dob-history-body");
    body.replaceChildren();
    $("dob-history-table").hidden = !dob.operations.length;
    $("dob-history-message").textContent = dob.operations.length ? "Statuses come from CKB RPC. Current owner comes from the live object Cell. Unknown requires inspection or retry with the original key." : "No DOB transactions recorded. Create DOB only submits when you click the button.";
    for (const operation of dob.operations.slice().reverse()) {
      const tx = dob.transactions.get(operation.hash);
      const row = element("tr");
      const hashCell = element("td");
      const hash = element("code", short(operation.hash), "hash"); hash.title = operation.hash;
      const copy = element("button", "Copy", "copy"); copy.type = "button";
      copy.addEventListener("click", () => copyText(operation.hash, copy));
      hashCell.append(hash, copy);
      const objectCell = element("td");
      const view = element("button", short(operation.objectId)); view.title = operation.objectId; view.type = "button";
      view.addEventListener("click", () => viewDob(operation.objectId)); objectCell.append(view);
      const status = element("td"); status.append(statusBadge(tx?.status || "unknown"));
      const inspect = element("button", "Inspect"); inspect.type = "button"; inspect.addEventListener("click", () => inspectDob(operation.hash));
      const detail = element("td"); detail.append(inspect);
      const owner = dob.objects.get(operation.objectId)?.ownerAddress;
      const ownerCell = element("td", owner ? short(owner) : "Unverified", "mono"); if (owner) ownerCell.title = owner;
      row.append(element("td", operation.kind === "create" ? "Create" : "Transfer"), objectCell, hashCell, status, element("td", tx?.blockNumber ?? "—"), ownerCell, detail);
      body.append(row);
    }
    controls();
  }
  function renderObject(object) {
    $("dob-object-detail").hidden = false;
    const data = object.data;
    metadata($("dob-object-meta"), [["Object ID", object.id], ["Object name (on-chain)", data?.name], ["Description (on-chain)", data?.description], ["Content type (on-chain)", data?.contentType], ["Current owner (live Cell)", object.ownerAddress], ["Creation transaction", object.creationTxHash], ["Creation status", object.creationStatus], ["Current Cell outpoint", object.cell ? `${object.cell.outPoint.txHash}:${object.cell.outPoint.index}` : null], ["Current status", object.status], ["Cell capacity (CKB)", object.cell?.capacityCkb], ["Data source", object.dataSource], ["Matches saved creation data", object.dataMatchesCreation === null ? "Not verified" : String(object.dataMatchesCreation)]]);
    $("dob-onchain-content").textContent = data?.content ?? "No live on-chain content verified. The local journal is available in the details below.";
    $("dob-cell-detail").textContent = json({ typeScript: object.typeScript, cell: object.cell, creationReferenceSource: object.creationReferenceSource, localMetadata: object.localMetadata });
    const warning = object.dataMatchesCreation === false ? "On-chain data has changed since creation. Transfer is disabled." : !object.cell ? "No live Cell verified. A committed creation alone does not prove current ownership." : !object.canTransfer ? "Live Cell verified. Transfer requires its saved creation record and current owner's backend key." : "Live Cell and owner verified from CKB. Ready to transfer.";
    message("dob-view-message", warning, object.cell && object.dataMatchesCreation !== false ? "success" : "error");
  }
  async function viewDob(id) {
    if (dob.viewing) return;
    dob.viewing = true; controls();
    $("dob-object-id").value = id;
    $("dob-object-detail").hidden = true;
    message("dob-view-message", "Reading the current live Cell from CKB…");
    try {
      if (!HASH_PATTERN.test(id)) throw new Error("Enter a 32-byte Object ID (TYPE_ID args).");
      const object = await api(`/api/dob/${encodeURIComponent(id)}`);
      dob.selectedId = object.id;
      renderObject(object);
    } catch (error) { message("dob-view-message", error.message, "error"); }
    finally { dob.viewing = false; controls(); }
  }
  function renderTransaction(tx) {
    $("dob-transaction-detail").hidden = false;
    $("dob-selected-hash").textContent = tx.hash;
    const badge = statusBadge(tx.status);
    $("dob-selected-status").textContent = badge.textContent;
    $("dob-selected-status").className = badge.className;
    metadata($("dob-transaction-meta"), [["Status", tx.status], ["Block number", tx.blockNumber], ["Operation", tx.operation?.kind], ["Object ID", tx.operation?.objectId], ["Sender", tx.operation?.sender], ["Receiver requested", tx.operation?.receiver], ["Rejection reason", tx.reason]]);
    $("dob-transaction-json").textContent = json(tx);
    message("dob-transaction-message", tx.status === "committed" ? "CKB confirms this transaction is committed. View the object to verify its current owner." : tx.status === "rejected" ? tx.reason || "Transaction rejected." : `Transaction ${tx.status}. Ownership change is not confirmed.`, tx.status === "committed" ? "success" : tx.status === "rejected" ? "error" : "");
  }
  async function inspectDob(hash) {
    if (dob.inspecting) return;
    dob.inspecting = true; controls();
    $("dob-transaction-detail").hidden = true;
    message("dob-transaction-message", "Reading transaction status…");
    try {
      if (!HASH_PATTERN.test(hash)) throw new Error("Enter a valid transaction hash.");
      dob.selectedHash = hash;
      $("dob-transaction-hash").value = hash;
      const tx = await api(`/api/dob/transaction/${encodeURIComponent(hash)}`);
      dob.transactions.set(hash, tx);
      renderTransaction(tx); renderHistory();
    } catch (error) { message("dob-transaction-message", error.message, "error"); }
    finally { dob.inspecting = false; controls(); }
  }
  async function refreshDob() {
    if (dob.refreshing || dob.busy) return;
    dob.loaded = true; dob.refreshing = true; controls();
    message("dob-message", "Verifying scripts, saved objects and transaction statuses…");
    try {
      const info = await api("/api/dob/info");
      dob.operations = info.operations;
      $("dob-script-info").textContent = json(info.scripts);
      const statuses = await Promise.allSettled(dob.operations.map(async (operation) => {
        const tx = await api(`/api/dob/transaction/${operation.hash}`);
        dob.transactions.set(operation.hash, tx);
      }));
      statuses.forEach((result, index) => { if (result.status === "rejected") dob.transactions.delete(dob.operations[index].hash); });
      // Read ownership after commitment lookups, so the final poll cannot retain
      // an old owner read just before the transfer was committed.
      const list = await api("/api/dob/objects");
      dob.objects = new Map(list.objects.map((object) => [object.id, object]));
      dob.ready = statuses.every((result) => result.status === "fulfilled");
      // Recover retries after reload/session loss, including a transaction that
      // was acknowledged earlier and subsequently evicted from the pool.
      if (!dob.intent) {
        const operation = pending().at(-1);
        if (operation) {
          const data = dob.objects.get(operation.objectId)?.localMetadata;
          if (operation.kind === "transfer") remember({ kind: "transfer", key: operation.id, body: { objectId: operation.objectId, receiver: operation.receiver } });
          else if (data) remember({ kind: "create", key: operation.id, body: { name: data.name, description: data.description, contentType: data.contentType, content: data.content } });
        }
      }
      accountOptions(); objectOptions(); renderHistory();
      if (dob.intent) {
        const operation = dob.operations.find((op) => op.id === dob.intent.key);
        const tx = operation && dob.transactions.get(operation.hash);
        if (tx && ["committed", "rejected"].includes(tx.status)) remember(null);
      }
      if (dob.selectedId && !dob.viewing) await viewDob(dob.selectedId);
      if (dob.selectedHash && dob.transactions.has(dob.selectedHash) && !dob.inspecting) renderTransaction(dob.transactions.get(dob.selectedHash));
      const unverified = list.objects.filter((object) => object.error);
      message("dob-message", !dob.ready ? "Some transaction statuses could not be verified. Refresh before submitting." : unverified.length ? `${unverified.length} object(s) could not be verified: ${unverified.map((o) => o.error).join(" ")}` : "DOB records loaded. Live owner and on-chain data are verified independently of local metadata.", !dob.ready || unverified.length ? "error" : "success");
      message("dob-action-message", dob.intent ? "A submission has an uncertain outcome. Retry same submission uses its original request key and signed transaction." : pending().length ? "Waiting for CKB confirmation. Status and owner refresh every 3 seconds." : "No pending DOB transaction. Create and Transfer require an explicit click.");
    } catch (error) { dob.ready = false; message("dob-message", error.message, "error"); }
    finally { dob.refreshing = false; controls(); }
  }
  async function submitDob(kind, body) {
    if (dob.busy || dob.refreshing) return;
    const intent = dob.intent || { kind, body, key: uuid() };
    remember(intent); dob.busy = true; controls();
    const feedback = intent.kind === "create" ? "dob-create-message" : "dob-transfer-message";
    message(feedback, `Preparing and submitting ${intent.kind} transaction…`);
    try {
      const result = await api(`/api/dob/${intent.kind}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": intent.key }, body: JSON.stringify(intent.body) });
      if (!result.operation?.hash || !result.transaction?.hash) throw new Error("Incomplete response. Retry the original submission to recover its result.");
      dob.selectedHash = result.operation.hash; dob.selectedId = result.operation.objectId;
      $("dob-object-id").value = dob.selectedId;
      $("dob-transaction-hash").value = dob.selectedHash;
      dob.transactions.set(result.operation.hash, result.transaction);
      renderTransaction(result.transaction);
      if (["committed", "rejected"].includes(result.transaction.status)) remember(null);
      message(feedback, `${result.transaction.status === "committed" ? "Confirmed" : "Submitted; inspect status"}: ${result.operation.hash}${result.message ? ` · ${result.message}` : ""}`, result.transaction.status === "rejected" ? "error" : "");
    } catch (error) {
      // Validation/authorization/conflict responses occur before a new journal entry.
      // Keep the original key for transport failures and other uncertain outcomes.
      if (error.status >= 400 && error.status < 500 && ![408, 425, 429].includes(error.status) && !["IDEMPOTENCY_CONFLICT", "OPERATION_IN_PROGRESS"].includes(error.code)) remember(null);
      message(feedback, error.message, "error");
    } finally { dob.busy = false; await refreshDob(); controls(); }
  }
  $("dob-create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitDob("create", { name: $("dob-name").value, description: $("dob-description").value, contentType: $("dob-content-type").value, content: $("dob-content").value });
  });
  $("dob-transfer-form").addEventListener("submit", (event) => {
    event.preventDefault(); submitDob("transfer", { objectId: $("dob-select").value, receiver: $("dob-receiver").value.trim() });
  });
  $("dob-view-form").addEventListener("submit", (event) => { event.preventDefault(); viewDob($("dob-object-id").value.trim()); });
  $("dob-transaction-form").addEventListener("submit", (event) => { event.preventDefault(); inspectDob($("dob-transaction-hash").value.trim()); });
  $("dob-refresh-transaction").addEventListener("click", () => inspectDob(dob.selectedHash));
  $("dob-copy-hash").addEventListener("click", () => copyText(dob.selectedHash, $("dob-copy-hash")));
  $("dob-retry").addEventListener("click", () => { if (dob.intent) submitDob(dob.intent.kind, dob.intent.body); });
  $("dob-refresh").addEventListener("click", refreshDob);
  $("refresh").addEventListener("click", () => { if (dob.loaded) refreshDob(); });
  $("dob-receiver-account").addEventListener("change", () => { if ($("dob-receiver-account").value) $("dob-receiver").value = $("dob-receiver-account").value; dob.receiverInitialized = true; });
  $("dob-receiver").addEventListener("input", () => { dob.receiverInitialized = true; $("dob-receiver-account").value = state.accounts.some((account) => account.address === $("dob-receiver").value) ? $("dob-receiver").value : ""; });
  // This also works for keyboard tab navigation, which changes aria-selected.
  new MutationObserver(() => { if (!$("panel-dob").hidden) refreshDob(); }).observe($("panel-dob"), { attributes: true, attributeFilter: ["hidden"] });
  if (dob.intent?.kind === "create") {
    $("dob-name").value = dob.intent.body.name ?? ""; $("dob-description").value = dob.intent.body.description ?? "";
    $("dob-content-type").value = dob.intent.body.contentType ?? ""; $("dob-content").value = dob.intent.body.content ?? "";
  } else if (dob.intent?.kind === "transfer") {
    $("dob-receiver").value = dob.intent.body.receiver ?? ""; dob.receiverInitialized = true;
  }
  // Reads only: no startup, refresh, polling or GET handler broadcasts a transaction.
  setInterval(() => {
    if (!dob.loaded) return;
    accountOptions(); controls();
    if (pending().length || dob.intent) refreshDob();
  }, 3000);
  controls();
})();
