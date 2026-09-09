import fs from 'node:fs';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const key = JSON.parse(fs.readFileSync('./uploader.json', 'utf8'));
const b58 = (bs58.default || bs58).encode(Uint8Array.from(key));
const turbo = TurboFactory.authenticated({ privateKey: b58, token: 'solana' });

// leave a little SOL behind for the transfer fee itself
const res = await turbo.topUpWithTokens({ tokenAmount: 95_000_000 });
console.log('funded. winc credited:', res.winc);
console.log('balance now         :', (await turbo.getBalance()).winc);
