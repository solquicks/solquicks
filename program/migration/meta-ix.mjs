// Builds a Token Metadata UpdateMetadataAccountV2 that changes only the uri,
// and optionally the name. Everything else — symbol, royalty, creators,
// collection — is read back off the account and re-sent unchanged, because
// DataV2 replaces the whole struct and anything omitted would be wiped.
export const TMETA = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

const str = (s) => {
  const b = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
};
const cat = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/// Reads the on-chain account. Strings are stored fixed-width and null-padded,
/// so they are trimmed here and re-sent at their natural length.
export function parseMetadata(buf, b58decode) {
  let o = 0;
  const key = buf[o]; o += 1;
  const updateAuthority = buf.subarray(o, o + 32); o += 32;
  const mint = buf.subarray(o, o + 32); o += 32;

  const readStr = () => {
    const len = new DataView(buf.buffer, buf.byteOffset).getUint32(o, true); o += 4;
    const s = new TextDecoder().decode(buf.subarray(o, o + len)).replace(/\0+$/, '');
    o += len;
    return s;
  };
  const name = readStr();
  const symbol = readStr();
  const uri = readStr();
  const sellerFeeBasisPoints = new DataView(buf.buffer, buf.byteOffset).getUint16(o, true); o += 2;

  const creators = [];
  const hasCreators = buf[o]; o += 1;
  if (hasCreators) {
    const n = new DataView(buf.buffer, buf.byteOffset).getUint32(o, true); o += 4;
    for (let i = 0; i < n; i++) {
      creators.push({
        address: buf.subarray(o, o + 32), verified: !!buf[o + 32], share: buf[o + 33],
      });
      o += 34;
    }
  }
  const primarySaleHappened = !!buf[o]; o += 1;
  const isMutable = !!buf[o]; o += 1;
  const hasEditionNonce = buf[o]; o += 1; if (hasEditionNonce) o += 1;
  const hasTokenStandard = buf[o]; o += 1;
  const tokenStandard = hasTokenStandard ? buf[o] : null; if (hasTokenStandard) o += 1;
  const hasCollection = buf[o]; o += 1;
  let collection = null;
  if (hasCollection) { collection = { verified: !!buf[o], key: buf.subarray(o + 1, o + 33) }; o += 33; }
  const hasUses = buf[o]; o += 1;
  let uses = null;
  if (hasUses) { uses = buf.subarray(o, o + 17); o += 17; }

  return { key, updateAuthority, mint, name, symbol, uri, sellerFeeBasisPoints,
           creators, primarySaleHappened, isMutable, tokenStandard, collection, uses };
}

export function updateUriIxData(meta, newUri, newCreators, newName) {
  const creators = newCreators || meta.creators;
  const creatorBytes = creators.length
    ? cat(new Uint8Array([1]), (() => { const n = new Uint8Array(4); new DataView(n.buffer).setUint32(0, creators.length, true); return n; })(),
        ...creators.map((c) => cat(c.address, new Uint8Array([c.verified ? 1 : 0, c.share]))))
    : new Uint8Array([0]);

  const fee = new Uint8Array(2);
  new DataView(fee.buffer).setUint16(0, meta.sellerFeeBasisPoints, true);

  const collectionBytes = meta.collection
    ? cat(new Uint8Array([1, meta.collection.verified ? 1 : 0]), meta.collection.key)
    : new Uint8Array([0]);
  const usesBytes = meta.uses ? cat(new Uint8Array([1]), meta.uses) : new Uint8Array([0]);

  const dataV2 = cat(str(newName == null ? meta.name : newName), str(meta.symbol),
                     str(newUri), fee, creatorBytes, collectionBytes, usesBytes);

  return cat(
    new Uint8Array([15]),        // UpdateMetadataAccountV2
    new Uint8Array([1]), dataV2, // Some(DataV2)
    new Uint8Array([0]),         // update authority unchanged
    new Uint8Array([0]),         // primary_sale_happened unchanged
    new Uint8Array([0])          // is_mutable unchanged
  );
}
