// Smaller security fixes of 2026-10-29: health detail behind the admin token
// (L3), client-reported swap failures cannot fake an outage (L4).
import { freshEnv, call, chain, advance, MIN, ok, eq, section, finish } from './harness.mjs';

chain.rpc.getHealth = () => 'ok';

section('public health says up or down and the build, nothing else');
{
  const env = freshEnv({ ADMIN_TOKEN: 'admin-test' });
  const pub = await call(env, 'GET', '/api/health');
  ok('it answers', pub.status === 200 || pub.status === 503, String(pub.status));
  eq('with only ok and build', Object.keys(pub.body).sort().join(','), 'build,ok');
  const before = chain.rpcCalls.length;
  for (let i = 0; i < 5; i++) await call(env, 'GET', '/api/health');
  eq('and repeated calls do not each reach Helius', chain.rpcCalls.length, before);
  const admin = await call(env, 'GET', '/api/health', { token: 'admin-test' });
  ok('the admin token gets the detail', admin.body.detail && 'players' in admin.body.detail && 'errorsLastHour' in admin.body.detail, JSON.stringify(admin.body));
  const wrong = await call(env, 'GET', '/api/health', { token: 'nope' });
  eq('a wrong token gets the public answer', Object.keys(wrong.body).sort().join(','), 'build,ok');
}

section('reported swap failures do not count as an outage');
{
  const env = freshEnv({ ADMIN_TOKEN: 'admin-test' });
  for (let i = 0; i < 40; i++) {
    await call(env, 'POST', '/api/swap/failed', { body: { message: 'boom ' + i }, ip: '10.1.' + i + '.1' });
  }
  eq('they are still logged', env._db.prepare("SELECT COUNT(*) AS n FROM error_log WHERE route = 'swap.client'").get().n, 40);
  const h = await call(env, 'GET', '/api/health', { token: 'admin-test' });
  eq('but not counted as errors', h.body.detail.errorsLastHour, 0);
  const bad = await call(env, 'POST', '/api/swap/failed', { body: null });
  eq('an empty report is fine', bad.status, 200);
  env._db.prepare("INSERT OR REPLACE INTO rate_limits (k, n, expires) VALUES (?, 500, ?)")
    .run('swapfailall:all:' + Math.floor(Date.now() / 3600000), (Math.floor(Date.now() / 3600000) + 1) * 3600000);
  const n0 = env._db.prepare('SELECT COUNT(*) AS n FROM error_log').get().n;
  const capped = await call(env, 'POST', '/api/swap/failed', { body: { message: 'x' }, ip: '10.200.0.1' });
  eq('past the hourly cap for everyone it is accepted but not written', capped.body.logged, false);
  eq('and the log did not grow', env._db.prepare('SELECT COUNT(*) AS n FROM error_log').get().n, n0);
}


section('paths that do not exist (I11)');
{
  const env = freshEnv();
  for (const p of ['/nope', '/wp-login.php', '/.git/config', '/api/nope', '/api/admin/nope', '/api/me/extra']) {
    const r = await call(env, 'GET', p);
    eq(p + ' is not found, not "sign in"', r.status, 404);
  }
  const me = await call(env, 'GET', '/api/me');
  eq('a real session route still asks a stranger to sign in', me.status, 401);
  const lo = await call(env, 'POST', '/api/logout');
  eq('logout too', lo.status, 401);

  // The list in the router has to name every route that sits behind the gate.
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const below = src.slice(src.indexOf('// ── everything below needs a session ──'));
  const used = [...new Set([...below.matchAll(/path === '([^']+)'/g)].map((m) => m[1]))].sort();
  const list = [...src.match(/const SESSION_ROUTES = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  eq('SESSION_ROUTES names exactly the routes behind the gate', list.join(','), used.join(','));
  ok('and nothing behind the gate matches by prefix, which the list could not express',
    !/path\.startsWith\(|path\.match\(/.test(below.slice(0, below.indexOf('} catch (err)'))));
}

finish();
