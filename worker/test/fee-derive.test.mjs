// Deriving a fee account is elliptic-curve maths, so it is checked against the
// four accounts Jupiter's own dashboard created, plus addresses whose on-curve
// status is known.

import { _internals } from '../src/index.js';
import { ok, eq, section, finish } from './harness.mjs';

const { derivedFeeAccount, isOnCurve, b58ToBytes, bytesToB58 } = _internals;

section('base58, both ways');
{
  for (const a of ['So11111111111111111111111111111111111111112',
                   '11111111111111111111111111111111',
                   'uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc']) {
    eq('survives a round trip: ' + a.slice(0, 10) + '…', bytesToB58(b58ToBytes(a)), a);
    eq('  is 32 bytes', b58ToBytes(a).length, 32);
  }
}

section('on the curve, or not');
{
  // ordinary wallets are points on the curve; program addresses are chosen
  // precisely because they are not
  ok('a wallet address is on the curve', isOnCurve(b58ToBytes('31jpe6JUemS1YBSnjn8uR9vgfb2eXVAGwGyssMzz6HBU')));
  ok('another wallet too', isOnCurve(b58ToBytes('uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc')));
  ok('a fee account is not', !isOnCurve(b58ToBytes('3w3oJv6xjbUTEJKfLcoijjAtAEUJkZ64po6nBBCjSijn')));
  ok('nor is another', !isOnCurve(b58ToBytes('AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp')));
}

section('the fee account for a mint, derived');
{
  // every one of these was created through Jupiter's dashboard, so the address
  // is not ours to choose — the derivation has to land on it exactly
  const cases = [
    ['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '3w3oJv6xjbUTEJKfLcoijjAtAEUJkZ64po6nBBCjSijn'],
    ['SOL', 'So11111111111111111111111111111111111111112', 'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp'],
    ['PYUSD', '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', '6aypgwsaHJmrVA6gS2EH5d67EmQyoSR2CRtoX33iZ9Yh'],
    ['USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', '7y4zjYuiFw7eHDUYWByqMSmu3SebpzvvBJSQz8BVbmXL']
  ];
  for (const [name, mint, expected] of cases) {
    eq(name + '’s fee account', await derivedFeeAccount(mint), expected);
  }
  const twice = await derivedFeeAccount('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
  eq('an unused mint derives the same address every time', await derivedFeeAccount('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), twice);
  ok('and that address is a program address', !isOnCurve(b58ToBytes(twice)), twice);
}

finish();
