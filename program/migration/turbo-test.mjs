import fs from 'node:fs';
import { TurboFactory } from '@ardrive/turbo-sdk';
import bs58 from 'bs58';

const key = JSON.parse(fs.readFileSync('./uploader.json', 'utf8'));
const b58 = (bs58.default || bs58).encode(Uint8Array.from(key));
const turbo = TurboFactory.authenticated({ privateKey: b58, token: 'solana' });

const addr = await turbo.signer.getNativeAddress();
console.log('turbo wallet   :', addr);

const bal = await turbo.getBalance();
console.log('credit balance :', bal.winc, 'winc');

const images = fs.readdirSync('./prepared/images');
const metas = fs.readdirSync('./prepared/meta');
const bytes = images.reduce((s, f) => s + fs.statSync('./prepared/images/' + f).size, 0)
            + metas.reduce((s, f) => s + fs.statSync('./prepared/meta/' + f).size, 0);
const [{ winc }] = await turbo.getUploadCosts({ bytes: [bytes] });
console.log('bytes to upload:', (bytes / 1048576).toFixed(1), 'MB');
console.log('cost           :', winc, 'winc');

const quote = await turbo.getWincForToken({ tokenAmount: 100_000_000 }); // 0.1 SOL
console.log('0.1 SOL buys   :', quote.winc, 'winc');
console.log('enough?        :', BigInt(quote.winc) >= BigInt(winc) ? 'YES' : 'NO');
