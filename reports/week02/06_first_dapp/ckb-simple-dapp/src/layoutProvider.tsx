import { useMemo, type ReactNode } from 'react';
import { ccc } from '@ckb-ccc/connector-react';

// One CCC Provider, following the official React template's root layout pattern.
export function LayoutProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => new ccc.ClientPublicTestnet({
    url: 'https://testnet.ckb.dev/',
    timeout: 15000,
  }), []);
  const options = useMemo(() => [{ name: 'CKB Testnet', client }], [client]);
  return (
    <ccc.Provider name="CKB Simple dApp" locale="en" defaultClient={client}
      clientOptions={options} signerFilter={testnetSigner}>
      {children}
    </ccc.Provider>
  );
}

async function testnetSigner(info: ccc.SignerInfo) {
  return info.signer.client.addressPrefix === 'ckt';
}
