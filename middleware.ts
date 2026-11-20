import { createD3Middleware } from '@d3-inc/d3-dna-vercel-middleware';

export default createD3Middleware();

// Same shape as the package's exported `config` (edge runtime, and the
// `_next/static`, `_next/image`, and `favicon.ico` exclusions), plus this
// site's static asset trees. HTML stays matched, including /games and
// /games/moon-rangers pages, which live outside the hashed assets folder.
export const config = {
  matcher:
    '/((?!_next/static|_next/image|favicon.ico|img/|icons/|css/|js/|vendor/|games/moon-rangers/assets/).*)',
  runtime: 'edge',
};
