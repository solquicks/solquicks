import { createD3Middleware } from '@d3-inc/d3-dna-vercel-middleware';

export default createD3Middleware();

// Matcher keeps the package default (`_next/static`, `_next/image`,
// `favicon.ico`) and also skips this site's static asset trees. HTML stays
// matched, including /games and /games/moon-rangers pages, which live
// outside the hashed assets folder.
// Node.js, not the package's `edge` runtime: Edge rejects @logtape's
// `#util` import, and Vercel treats the Edge middleware runtime as deprecated.
export const config = {
  matcher:
    '/((?!_next/static|_next/image|favicon.ico|img/|icons/|css/|js/|vendor/|games/moon-rangers/assets/).*)',
  runtime: 'nodejs',
};
