import { ccc } from '@ckb-ccc/connector-react';

export function requireTestnet(client: ccc.Client) {
  if (client.addressPrefix !== 'ckt') throw new Error('Use a CKB Testnet wallet. Mainnet is not supported.');
}

export async function testnetAddress(text: string, client: ccc.Client) {
  requireTestnet(client);
  if (!/^ckt1/i.test(text.trim())) throw new Error('Enter a CKB Testnet address beginning with ckt1.');
  try {
    return await ccc.Address.fromString(text.trim(), client);
  } catch {
    throw new Error('The Testnet address is invalid. Check the complete address and its checksum.');
  }
}

export function createTransfer(lock: ccc.Script, text: string) {
  const value = text.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(value)) throw new Error('Enter a positive CKB amount with at most 8 decimal places.');
  const capacity = ccc.fixedPointFrom(value);
  if (capacity <= 0n || capacity > 18446744073709551615n) throw new Error('The amount must be positive and fit within a Cell’s capacity limit.');
  const output = ccc.CellOutput.from({ lock, capacity });
  const minimum = ccc.fixedPointFrom(output.occupiedSize);
  if (capacity < minimum) throw new Error(`This recipient needs at least ${ccc.fixedPointToString(minimum)} CKB to store the output Cell.`);
  return ccc.Transaction.from({ outputs: [output], outputsData: ['0x'] });
}

export async function liveCells(client: ccc.Client, address: string) {
  const { script } = await testnetAddress(address, client);
  const found: ccc.Cell[] = [];
  for await (const cell of client.findCellsOnChain({ script, scriptType: 'lock', scriptSearchMode: 'exact', withData: false }, 'desc', 5)) {
    found.push(cell);
    // CCC's limit is a page size, so also limit the complete result here.
    if (found.length === 5) break;
  }
  return found;
}

export type CheckedTransaction = { status: ccc.TransactionStatus; block?: string; reason?: string; checkedAt: string };

export async function transactionStatus(client: ccc.Client, hash: string): Promise<CheckedTransaction> {
  requireTestnet(client);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid transaction hash.');
  const result = await client.getTransactionNoCache(hash);
  let status: ccc.TransactionStatus = result?.status ?? 'unknown';
  let block = result?.blockNumber?.toString();
  let reason = result?.reason;
  // This SDK omits a response when the node has status but no transaction body.
  if (!result && client instanceof ccc.ClientJsonRpc) {
    const raw: unknown = await client.requestor.request('get_transaction', [hash]);
    if (typeof raw === 'object' && raw !== null && 'tx_status' in raw) {
      const metadata = raw.tx_status;
      if (typeof metadata !== 'object' || metadata === null || !('status' in metadata)) throw new Error('Invalid status response from the Testnet node.');
      switch (metadata.status) {
        case 'pending': case 'proposed': case 'sent': case 'committed': case 'unknown': case 'rejected': status = metadata.status; break;
        default: throw new Error('Unrecognized transaction status from the Testnet node.');
      }
      if ('reason' in metadata && typeof metadata.reason === 'string') reason = metadata.reason;
      if ('block_number' in metadata && typeof metadata.block_number === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(metadata.block_number)) block = BigInt(metadata.block_number).toString();
    } else if (raw !== null) throw new Error('Invalid transaction response from the Testnet node.');
  }
  if (status === 'committed' && block === undefined && result?.blockHash) {
    block = (await client.getHeaderByHashNoCache(result.blockHash))?.number.toString();
  }
  return { status, block, reason, checkedAt: new Date().toLocaleString() };
}

export function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : 'The request failed. Please try again.';
  if (/insufficient|not enough capacity/i.test(text)) return 'Not enough spendable CKB for the amount, fee, and change Cell. Add Testnet funds or lower the amount.';
  if (/reject|denied|cancel/i.test(text)) return `The wallet or node rejected the request: ${text.slice(0, 300)}`;
  if (/fetch|timeout|websocket|failed to connect/i.test(text)) return 'The Testnet service could not be reached. Please try again.';
  return text.slice(0, 500);
}
