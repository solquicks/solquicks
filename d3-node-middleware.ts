import { createD3Middleware } from '@d3-inc/d3-dna-vercel-middleware';
import { next } from '@vercel/functions';

// Bundled to middleware.js (CommonJS). Vercel's Node.js middleware loads that
// file with require(). The DNA package is ESM-only, so a static import is
// compiled to require() and Node exits with ERR_REQUIRE_ESM before the
// handler can set x-d3-edge. Inlining the package avoids that require.
const matcher =
  '/((?!_next/static|_next/image|favicon.ico|img/|icons/|css/|js/|vendor/|games/moon-rangers/assets/).*)';

let dna: ((request: Request) => Promise<Response>) | undefined;

function failOpen(err: unknown): Response {
  console.error('DNA middleware failed open', err);
  try {
    return next({ headers: { 'x-d3-edge': 'fail-open' } });
  } catch (nextErr) {
    console.error('DNA middleware continuation failed', nextErr);
    return new Response(null, {
      status: 200,
      headers: {
        'x-middleware-next': '1',
        'x-d3-edge': 'fail-open',
      },
    });
  }
}

export default async function middleware(request: Request): Promise<Response> {
  try {
    dna ??= createD3Middleware();
    return await dna(request);
  } catch (err) {
    return failOpen(err);
  }
}

export const config = {
  matcher,
  runtime: 'nodejs' as const,
};
