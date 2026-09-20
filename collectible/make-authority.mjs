// Creates the keypair that will own the collection and the candy machine, so
// its address can be funded before anything is created. It signs two
// transactions and then owns the candy machine; it never receives revenue,
// which goes straight from each buyer to the treasury.
import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner } from '@metaplex-foundation/umi';

if (fs.existsSync('./authority.json')) {
  const umi = createUmi('https://api.mainnet-beta.solana.com');
  const kp = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./authority.json', 'utf8'))));
  console.log('authority already exists:', kp.publicKey);
} else {
  const umi = createUmi('https://api.mainnet-beta.solana.com');
  const kp = generateSigner(umi);
  fs.writeFileSync('./authority.json', JSON.stringify(Array.from(kp.secretKey)));
  console.log('created authority.json');
  console.log('address:', kp.publicKey);
}
