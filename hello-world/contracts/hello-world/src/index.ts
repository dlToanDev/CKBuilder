import * as bindings from '@ckb-js-std/bindings';
import { Script, HighLevel, log } from '@ckb-js-std/core';

function main(): number {
  log.setLevel(log.LogLevel.Debug);
  const script = bindings.loadScript();
  log.debug(`hello-world script loaded: ${JSON.stringify(script)}`);
  log.debug('Hello, World!');
  return 0;
}

bindings.exit(main());
