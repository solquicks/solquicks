// The response headers vercel.json gives a path, so the local test servers send
// the same Content-Security-Policy (and the rest) that Vercel will. Sources are
// matched as anchored regular expressions, which is all vercel.json uses here.
// When more than one rule sets the same header, the later rule wins.
export function vercelHeaders(vercel, pathname) {
  const out = {};
  for (const rule of vercel.headers || []) {
    const re = new RegExp('^' + rule.source.replace(/:([a-z]+)/gi, '[^/]+') + '$');
    if (!re.test(pathname)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}
