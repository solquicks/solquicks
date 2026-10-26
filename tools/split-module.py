#!/usr/bin/env python3
"""Cuts one or more sections out of js/app.js into its own module.

Does the bookkeeping that is easy to get wrong by hand: works out exactly which
names the moved code needs from app.js, and which of its own names app.js still
uses, and writes the import and export lines from that rather than from memory.

  tools/split-module.py <module-name> "SECTION BANNER" ["ANOTHER" ...]
  tools/split-module.py --plan "SECTION BANNER" ...     # report only
"""
import io, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'js', 'app.js')

JS_KEYWORDS = set('''await break case catch class const continue debugger default delete do else
enum export extends false finally for function if import in instanceof let new null return super
switch this throw true try typeof var void while with yield async of static get set from as
undefined NaN Infinity arguments'''.split())

def load():
    return io.open(APP, encoding='utf-8').read().split('\n')

def banners(lines):
    out = []
    for n, l in enumerate(lines):
        m = re.match(r'^\s*// ── ([A-Z].*?)\s*─*\s*$', l)
        if m:
            out.append((n, m.group(1).strip()))
    return out

def trailer_start(lines):
    """Where app.js's generated tail begins — the exported setter and the export
    list. The last real section would otherwise run to end of file and carry
    them off into a feature module, taking every export with it."""
    for n, l in enumerate(lines):
        if l.startswith('export function __set(') or l.startswith('export {'):
            # step back over the comment block immediately above it
            k = n
            while k > 0 and (lines[k-1].startswith('//') or not lines[k-1].strip()):
                k -= 1
            return k
    return len(lines)


def section_ranges(lines, wanted):
    bs = banners(lines)
    stop = trailer_start(lines)
    ranges = []
    for i, (n, title) in enumerate(bs):
        for w in wanted:
            if title.upper().startswith(w.upper()):
                end = bs[i + 1][0] if i + 1 < len(bs) else stop
                ranges.append((n, min(end, stop), title))
    return sorted(ranges)

DECL = re.compile(r'^(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:var|let|const)\s+([A-Za-z_$][\w$]*))')

def top_names(chunk_lines):
    out = []
    for l in chunk_lines:
        m = DECL.match(l)
        if m:
            out.append(m.group(1) or m.group(2))
    return out

def strip_code(text):
    """Blanks comments, strings and regex literals with a character scanner.

    Regexes are not up to this. Blanking strings with a pattern lets one stray
    quote — an apostrophe in a comment, a quote inside a regex literal — open a
    span that runs to the next quote and swallows every identifier between,
    which silently hides real dependencies. Getting that wrong produces a module
    that looks fine and throws at runtime, so it is worth scanning properly.
    """
    out = []
    i, n = 0, len(text)
    prev = ''                      # last significant character, for regex detection
    while i < n:
        c = text[i]
        two = text[i:i+2]
        if two == '//':
            while i < n and text[i] != '\n': i += 1
            continue
        if two == '/*':
            i += 2
            while i < n and text[i:i+2] != '*/': i += 1
            i += 2
            continue
        if c in '"\'`':
            q = c; i += 1
            while i < n:
                if text[i] == '\\': i += 2; continue
                if text[i] == q: i += 1; break
                i += 1
            out.append('""'); prev = '"'
            continue
        # a slash is a regex only where a value cannot already have ended
        if c == '/' and prev not in ')]}' and not (prev.isalnum() or prev in '_$'):
            i += 1
            while i < n:
                if text[i] == '\\': i += 2; continue
                if text[i] == '[':
                    while i < n and text[i] != ']':
                        i += 2 if text[i] == '\\' else 1
                if text[i] == '/': i += 1; break
                if text[i] == '\n': break      # not a regex after all
                i += 1
            out.append(' '); prev = ' '
            continue
        out.append(c)
        if not c.isspace(): prev = c
        i += 1
    return ''.join(out)


def idents(text):
    text = strip_code(text)
    text = re.sub(r'\.\s*([A-Za-z_$][\w$]*)', '.', text)      # a.foo — property, not a reference
    # { foo: ... } — a key, not a reference either. Shorthand { foo } has no
    # colon and is left alone, because that one IS a reference.
    text = re.sub(r'([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)', r'\1\3', text)
    return set(re.findall(r'\b([A-Za-z_$][\w$]*)\b', text)) - JS_KEYWORDS


def analyse(wanted):
    lines = load()
    rs = section_ranges(lines, wanted)
    if not rs:
        sys.exit('no section matched: ' + ', '.join(wanted))
    moved_idx = set()
    for a, b, _ in rs:
        moved_idx |= set(range(a, b))
    moved = [lines[i] for i in sorted(moved_idx)]
    stays = [l for i, l in enumerate(lines) if i not in moved_idx]

    mine = set(top_names(moved))
    theirs = set(top_names(stays))
    # plus everything already living in a feature module: a dependency on code
    # that has already been split out is just as real, and invisible if only
    # app.js is considered.
    import glob as _g
    for other in _g.glob(os.path.join(ROOT, 'js', '*.js')):
        if os.path.basename(other) in ('app.js', 'main.js'): continue
        osrc = io.open(other, encoding='utf-8').read()
        theirs |= set(re.findall(r'(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', osrc))
        theirs |= set(re.findall(r'(?:^|\n)(?:var|let|const)\s+([A-Za-z_$][\w$]*)', osrc))
    moved_text, stays_text = '\n'.join(moved), '\n'.join(stays)

    needs = sorted((idents(moved_text) & theirs) - mine)       # import from app
    gives = sorted(n for n in mine if n in idents(stays_text)) # app imports back

    # An imported binding cannot be assigned to. A moved function that writes to
    # a variable still living in app.js throws the moment it runs, and if the
    # write sits inside a try/catch the whole feature just quietly takes its
    # error path — which is exactly how the store came to report "stock
    # unavailable". Anything the moved code writes to has to move with it.
    body = strip_code(moved_text)
    writes = set()
    for n in needs:
        if re.search(r'(?<![=!<>])\b' + re.escape(n) + r'\s*(?:=(?!=)|\+\+|--|\+=|-=)', body):
            writes.add(n)
    return lines, rs, moved, stays, needs, gives, sorted(writes)



# ── verification ────────────────────────────────────────────────────────────
# Run after every split: for each module, every identifier it references must be
# declared there, imported, or a real global. A missed one is a ReferenceError
# that only shows up when somebody clicks the right button, which on this site
# can mean in the middle of paying for something.

BROWSER = set('''window document console localStorage sessionStorage location history navigator
fetch setTimeout clearTimeout setInterval clearInterval requestAnimationFrame crypto performance
Math JSON Object Array String Number Boolean Date RegExp Error TypeError Promise Map Set WeakMap
Symbol Intl URL URLSearchParams TextEncoder TextDecoder Uint8Array Uint16Array Uint32Array
Int8Array Float64Array BigInt BigInt64Array ArrayBuffer DataView atob btoa alert confirm prompt
parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI
Element HTMLElement Event CustomEvent CSS Image AbortController Response Request Headers Blob
FileReader IntersectionObserver MutationObserver ResizeObserver matchMedia structuredClone
globalThis Reflect Proxy WeakSet queueMicrotask reportError self top parent frames
getComputedStyle getSelection scrollTo scrollBy open close postMessage addEventListener
removeEventListener dispatchEvent CloseEvent WebSocket Worker caches indexedDB'''.split())


# Known false positives, kept small and explained. `https` comes from the scheme
# inside a URL string; `z0` from a declarator shape the binder does not model.
# Neither is a reference to anything. The list is here so the check can exit
# clean and fail loudly on anything NEW, which is the only useful behaviour.
KNOWN_FINE = {'https', 'z0'}


def check_all():
    import glob
    bad = 0
    for f in sorted(glob.glob(os.path.join(ROOT, 'js', '*.js'))):
        src = io.open(f, encoding='utf-8').read()
        imported = set()
        for m in re.finditer(r'import\s*\{([^}]*)\}\s*from', src):
            imported |= {x.strip().split(' as ')[-1].strip().rstrip(',')
                         for x in m.group(1).split(',') if x.strip()}
        body = strip_code(src)
        declared = set(re.findall(r'(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', body))
        declared |= set(re.findall(r'(?:^|\n)\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)', body))
        declared |= set(re.findall(r'(?:var|let|const)\s*\{([^}]*)\}\s*=', body) and
                        re.findall(r'[A-Za-z_$][\w$]*', ' '.join(re.findall(r'(?:var|let|const)\s*\{([^}]*)\}\s*=', body))) or [])
        # anything bound anywhere in the file: parameters, catch vars, loop vars,
        # destructuring. Coarse on purpose — this is looking for names that exist
        # nowhere at all, not for shadowing.
        local = set(re.findall(r'[A-Za-z_$][\w$]*', body))
        bound = declared | imported | BROWSER
        used = idents(src)
        # a reference is suspicious only if it is never bound in this file at all
        anywhere_bound = set(re.findall(
            r'(?:function\s+|var\s+|let\s+|const\s+|catch\s*\(|=>\s*|\(\s*)([A-Za-z_$][\w$]*)', body))
        # a named function expression — (function name() — defines that name
        anywhere_bound |= set(re.findall(r'function\s+([A-Za-z_$][\w$]*)\s*\(', body))
        # an object or class shorthand method — name(args) { — defines it too
        anywhere_bound |= set(re.findall(r'(?:^|\n)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{', body))
        # every parameter in every parameter list, not just the first. A
        # function's second and third arguments are bound exactly as much as
        # its first, and treating them as unresolved buries the real ones.
        for params in re.findall(r'\(([^()]*)\)\s*(?:\{|=>)', body):
            anywhere_bound |= set(re.findall(r'[A-Za-z_$][\w$]*', params))
        # const W = 300, H = 64, pad = 6 — every declarator, not just the first
        for group in re.findall(r'(?:var|let|const)\s+([^;\n]*)', body):
            anywhere_bound |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*=', group))
            anywhere_bound |= set(re.findall(r'[A-Za-z_$][\w$]*', group))
        missing = sorted(n for n in used - KNOWN_FINE
                         if n not in bound and n not in anywhere_bound and not n[0].isupper())
        if missing:
            bad = 1
            print('  %s references names bound nowhere: %s' % (os.path.basename(f), ', '.join(missing[:12])))
    if not bad:
        print('  every module resolves every name it uses')
    return bad


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--check':
        sys.exit(check_all())
    plan = args and args[0] == '--plan'
    if plan: args = args[1:]
    if len(args) < 2 and not plan: sys.exit(__doc__)
    name = None if plan else args[0]
    wanted = args if plan else args[1:]

    lines, rs, moved, stays, needs, gives, writes = analyse(wanted)
    print('  sections: ' + ', '.join('%s (%d lines)' % (t, b - a) for a, b, t in rs))
    print('  moving %d lines, leaving %d' % (len(moved), len(stays)))
    print('  needs from app.js (%d): %s' % (len(needs), ', '.join(needs) or 'nothing'))
    print('  app.js needs back (%d): %s' % (len(gives), ', '.join(gives) or 'nothing'))
    if writes:
        print('  ALSO MOVES (the moved code writes to these): %s' % ', '.join(writes))
    if plan: sys.exit(0)

    # Carry across the declarations the moved code writes to. They cannot stay
    # behind and be imported, because an imported binding is read-only.
    if writes:
        carried = []
        keep = []
        for l in stays:
            m2 = re.match(r'^(?:var|let|const)\s+([A-Za-z_$][\w$]*)\b', l)
            if m2 and m2.group(1) in writes and l.rstrip().endswith(';'):
                carried.append(l)
            else:
                keep.append(l)
        if carried:
            stays = keep
            moved = carried + [''] + moved
            needs = [n for n in needs if n not in writes]
            gives = sorted(set(gives) | {n for n in writes
                                         if re.search(r'\b' + re.escape(n) + r'\b', strip_code('\n'.join(stays)))})

    out = os.path.join(ROOT, 'js', name + '.js')
    head = ('// solquicks.com — %s.\n//\n'
            '// Split out of js/app.js unchanged; only the import line below is new,\n'
            '// and it was derived from what this code actually references.\n\n') % name
    # a name might live in a feature already split out, not in app.js
    import glob as _glob
    elsewhere = {}
    for other in _glob.glob(os.path.join(ROOT, 'js', '*.js')):
        base = os.path.basename(other)[:-3]
        if base in ('app', 'main', name): continue
        osrc = io.open(other, encoding='utf-8').read()
        for nm in set(re.findall(r'(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', osrc)) | \
                  set(re.findall(r'(?:^|\n)(?:var|let|const)\s+([A-Za-z_$][\w$]*)', osrc)):
            elsewhere.setdefault(nm, base)
    from_app = [n for n in needs if n not in elsewhere]
    by_mod = {}
    for n in needs:
        if n in elsewhere: by_mod.setdefault(elsewhere[n], []).append(n)
    imp = ('import {\n' + ',\n'.join('  ' + n for n in from_app) + "\n} from './app.js';\n\n") if from_app else ''
    for mod, ns in sorted(by_mod.items()):
        imp += 'import {\n' + ',\n'.join('  ' + n for n in sorted(ns)) + "\n} from './%s.js';\n\n" % mod
    needs = from_app
    io.open(out, 'w', encoding='utf-8').write(head + imp + '\n'.join(moved).strip('\n') + '\n'
            + (('\nexport {\n' + ',\n'.join('  ' + n for n in gives) + '\n};\n') if gives else ''))

    # app.js keeps the rest and must EXPORT what the moved code imports. Where
    # app.js also CALLS into the moved code it imports it back, which makes a
    # cycle — harmless as long as neither side reaches for the other while it is
    # still being evaluated. A top-level use is what breaks that, not the cycle.
    body = '\n'.join(stays).strip('\n')
    if gives:
        body = ("import {\n" + ',\n'.join('  ' + n for n in gives)
                + "\n} from './%s.js';\n\n" % name) + body
    m = re.search(r'\nexport \{\n(.*?)\n\};\n*$', body, re.S)
    already = set()
    if m:
        already = {x.strip().rstrip(',') for x in m.group(1).split('\n') if x.strip()}
        body = body[:m.start()].rstrip('\n')
    gone = set(top_names(moved))
    out_names = sorted((already | set(needs)) - gone)
    io.open(APP, 'w', encoding='utf-8').write(
        body + '\n\nexport {\n' + ',\n'.join('  ' + n for n in out_names) + '\n};\n')

    # Other modules that imported a moved name FROM app.js must now take it from
    # here. Leaving those behind is a stale import: the module still asks app.js
    # for something it no longer has, and the page dies on load.
    for other in _glob.glob(os.path.join(ROOT, 'js', '*.js')):
        base = os.path.basename(other)
        if base in ('app.js', 'main.js', name + '.js'): continue
        osrc = io.open(other, encoding='utf-8').read()
        m2 = re.search(r"import \{\n(.*?)\n\} from '\./app\.js';", osrc, re.S)
        if not m2: continue
        have = [x.strip().rstrip(',') for x in m2.group(1).split('\n') if x.strip()]
        moved_out = [n for n in have if n in gone]
        if not moved_out: continue
        keep = [n for n in have if n not in gone]
        repl = ("import {\n" + ',\n'.join('  ' + n for n in keep) + "\n} from './app.js';") if keep else ''
        repl += ("\n\nimport {\n" + ',\n'.join('  ' + n for n in sorted(moved_out))
                 + "\n} from './%s.js';" % name)
        io.open(other, 'w', encoding='utf-8').write(osrc[:m2.start()] + repl.strip('\n') + osrc[m2.end():])
        print('  %s now takes %s from %s.js' % (base, ', '.join(moved_out), name))

    # main.js learns about the new module
    mainp = os.path.join(ROOT, 'js', 'main.js')
    mn = io.open(mainp, encoding='utf-8').read()
    if ("./%s.js" % name) not in mn:
        mn = mn.replace("import * as app from './app.js';",
                        "import * as app from './app.js';\nimport * as %s from './%s.js';" % (name, name))
        mn = re.sub(r'const api = Object\.assign\(\{\}([^)]*)\);',
                    lambda mm: 'const api = Object.assign({}%s, %s);' % (mm.group(1), name), mn)
        io.open(mainp, 'w', encoding='utf-8').write(mn)
    print('  wrote js/%s.js' % name)
