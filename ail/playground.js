// ail playground — drives the self-hosted aic compiler (wasm) entirely in the browser.
//
// aic.wasm IS the compiler (front-end + wasm back-end), built with
//   aic build aic.ail --target wasm32-freestanding
// It exposes a tiny memory-based API instead of a CLI (there is no argv/filesystem):
//   aic_alloc(n)            reserve n bytes in the compiler's own heap
//   aic_compile(p,len,code) code 0 = check (diagnostics -> fd 2); 1..10 = compile for a
//                           target and leave the executable image in memory (1 is
//                           wasm32-freestanding, used by "Run via Wasm")
//   aic_out_ptr/aic_out_len where that image lives after a code != 0 compile
//
// "Run via Wasm" compiles to wasm and executes it in-page; "Compile & Download" cross-
// compiles to the selected target (macOS/Linux/Windows/wasm) and downloads the binary.
// Each run uses a FRESH compiler instance: the bump arena never frees across calls.

const dec = new TextDecoder();
const enc = new TextEncoder();
const el = (id) => document.getElementById(id);

let compilerModule = null;            // cached WebAssembly.Module of aic.wasm

class ExitError extends Error { constructor(code) { super('exit ' + code); this.code = code; } }

// Imports every freestanding aic module needs. `onWrite(fd, ptr, len)` handles output.
function envImports(onWrite) {
   return { env: {
      sys_write: (fd, ptr, len) => { onWrite(Number(fd), Number(ptr), Number(len)); return len; },
      sys_read:  () => 0n,
      sys_exit:  (code) => { throw new ExitError(Number(code)); },
   }};
}

function setStatus(msg, kind) { const s = el('status'); s.textContent = msg; s.className = kind || ''; }

async function loadCompiler() {
   let resp;
   try { resp = await fetch('aic.wasm'); }
   catch (e) { setStatus('cannot fetch aic.wasm — serve this folder over http (see README)', 'err'); return; }
   if (!resp.ok) { setStatus('aic.wasm missing (' + resp.status + ') — run ./build.sh', 'err'); return; }
   compilerModule = await WebAssembly.compile(await resp.arrayBuffer());
   setStatus('ready', 'ok');
}

// Run the embedded compiler over `source`. Returns { rc, diag, moduleBytes }.
function compileSource(source, mode) {
   let mem;
   const fdout = ['', '', ''];        // captured stdout/stderr by fd index
   const inst = new WebAssembly.Instance(compilerModule, envImports((fd, ptr, len) => {
      if (fd === 1 || fd === 2) fdout[fd] += dec.decode(new Uint8Array(mem.buffer, ptr, len));
   }));
   mem = inst.exports.memory;
   const { aic_alloc, aic_compile, aic_out_ptr, aic_out_len } = inst.exports;

   const src = enc.encode(source);
   const p = aic_alloc(BigInt(src.length));
   new Uint8Array(mem.buffer).set(src, Number(p));      // fresh view: aic_alloc may have grown memory

   let rc;
   try { rc = Number(aic_compile(p, BigInt(src.length), BigInt(mode))); }
   catch (e) { return { rc: -1, diag: fdout[2] + '\n[compiler trapped] ' + e.message }; }

   let outBytes = null;
   if (rc === 0 && mode !== 0) {              // mode 0 = check; 1..10 emit an executable image
      const op = Number(aic_out_ptr()), ol = Number(aic_out_len());
      outBytes = new Uint8Array(mem.buffer, op, ol).slice();      // copy out of the compiler's memory
   }
   return { rc, diag: fdout[2], outBytes };
}

// Instantiate the emitted module and run main(), capturing its stdout.
async function evalModule(bytes) {
   let mem, out = '';
   const inst = new WebAssembly.Instance(await WebAssembly.compile(bytes),
      envImports((fd, ptr, len) => { out += dec.decode(new Uint8Array(mem.buffer, ptr, len)); }));
   mem = inst.exports.memory;
   let exit = 0;
   try { exit = Number(inst.exports.main()); }
   catch (e) { if (e instanceof ExitError) exit = e.code; else throw e; }
   return { out, exit };
}

async function onRun() {
   if (!compilerModule) return;
   el('stdout').textContent = '';
   el('diag').textContent = '';
   setStatus('compiling…');
   const { rc, diag, outBytes } = compileSource(el('code').value, 1);   // 1 = wasm32-freestanding
   if (rc !== 0) { el('diag').textContent = diag || '(compile failed, rc=' + rc + ')'; setStatus('compile error', 'err'); return; }
   setStatus('compiled ' + outBytes.length.toLocaleString() + ' bytes · running…');
   try {
      const { out, exit } = await evalModule(outBytes);
      el('stdout').textContent = out;
      if (diag) el('diag').textContent = diag;
      setStatus('compiled ' + outBytes.length.toLocaleString() + ' bytes of wasm · exit ' + exit, 'ok');
   } catch (e) {
      el('diag').textContent = 'the compiled program trapped: ' + e.message;
      setStatus('runtime trap', 'err');
   }
}

// Compile for the dropdown target and download the resulting executable.
function onDownload() {
   if (!compilerModule) return;
   el('stdout').textContent = '';
   el('diag').textContent = '';
   const sel = el('target');
   const code = Number(sel.value);
   const tname = sel.options[sel.selectedIndex].textContent;
   setStatus('compiling for ' + tname + '…');
   const { rc, diag, outBytes } = compileSource(el('code').value, code);
   if (rc !== 0) { el('diag').textContent = diag || '(compile failed, rc=' + rc + ')'; setStatus('compile error', 'err'); return; }
   const ext = tname.startsWith('windows') ? '.exe' : tname.startsWith('wasm') ? '.wasm' : '';
   const name = 'program-' + tname + ext;
   const url = URL.createObjectURL(new Blob([outBytes], { type: 'application/octet-stream' }));
   const a = document.createElement('a');
   a.href = url; a.download = name;
   document.body.appendChild(a); a.click(); a.remove();
   URL.revokeObjectURL(url);
   setStatus('compiled ' + outBytes.length.toLocaleString() + ' bytes → ' + name, 'ok');
}

function onCheck() {
   if (!compilerModule) return;
   el('stdout').textContent = '';
   const { rc, diag } = compileSource(el('code').value, 0);
   el('diag').textContent = rc === 0 ? '' : diag;
   setStatus(rc === 0 ? 'no errors ✓' : 'has errors', rc === 0 ? 'ok' : 'err');
}

// ---- Reference overlay ---------------------------------------------------
// The cheatsheet and full language spec are embedded in aic.wasm itself. The
// compiler exposes them via aic_doc_ptr(which)/aic_doc_len(which) — 0 = the
// cheatsheet, 1 = the spec — so nothing is duplicated in this page.
const docCache = {};                          // which -> decoded text
const parsedDoc = {};                         // which -> [{title, level, body}]

function loadDoc(which) {
   if (docCache[which] != null) return docCache[which];
   const inst = new WebAssembly.Instance(compilerModule, envImports(() => {}));
   const mem = inst.exports.memory;
   const p = Number(inst.exports.aic_doc_ptr(BigInt(which)));
   const l = Number(inst.exports.aic_doc_len(BigInt(which)));
   return docCache[which] = dec.decode(new Uint8Array(mem.buffer, p, l));
}

// Split a doc into sections: a non-blank line whose next line is all '=' (h1) or
// all '-' (h2) is a heading; everything up to the next heading is its body.
function parseDoc(which) {
   if (parsedDoc[which]) return parsedDoc[which];
   const lines = loadDoc(which).split('\n');
   const secs = [];
   let cur = { title: which === 0 ? 'Cheat sheet' : 'Overview', level: 1, body: [] };
   const isRule = (s, c) => s.length >= 3 && [...s].every(ch => ch === c);
   for (let i = 0; i < lines.length; i++) {
      const ln = lines[i], nx = lines[i + 1] || '';
      if (ln.trim() && (isRule(nx, '=') || isRule(nx, '-'))) {
         if (cur.body.length || secs.length === 0) secs.push(cur);
         cur = { title: ln.trim(), level: isRule(nx, '=') ? 1 : 2, body: [] };
         i++;                                  // consume the underline
         continue;
      }
      cur.body.push(ln);
   }
   secs.push(cur);
   // drop the synthetic preamble section when it holds nothing before the first heading
   if (secs.length > 1 && !secs[0].body.some((l) => l.trim())) secs.shift();
   return parsedDoc[which] = secs;
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let refWhich = 0, refQuery = '';

function renderRef() {
   const secs = parseDoc(refWhich);
   const q = refQuery.trim().toLowerCase();
   const rx = q ? new RegExp(reEsc(q), 'gi') : null;
   const index = el('ref-index'), content = el('ref-content');
   index.innerHTML = ''; content.innerHTML = '';
   let shown = 0, matches = 0;
   secs.forEach((s, i) => {
      const text = s.title + '\n' + s.body.join('\n');
      const hit = !q || text.toLowerCase().includes(q);
      if (hit) shown++;

      const a = document.createElement('a');
      a.textContent = s.title;
      a.className = s.level === 2 ? 'sub' : '';
      a.hidden = !hit;
      a.onclick = () => document.getElementById('sec-' + i).scrollIntoView({ block: 'start' });
      index.appendChild(a);

      const sec = document.createElement('div');
      sec.className = 'sec'; sec.id = 'sec-' + i; sec.hidden = !hit;
      const h = document.createElement(s.level === 2 ? 'h4' : 'h3');
      h.innerHTML = rx ? esc(s.title).replace(rx, (m) => '<mark>' + m + '</mark>') : esc(s.title);
      const pre = document.createElement('pre');
      let body = esc(s.body.join('\n'));
      if (rx) body = body.replace(rx, (m) => { matches++; return '<mark>' + m + '</mark>'; });
      pre.innerHTML = body;
      sec.appendChild(h); sec.appendChild(pre);
      content.appendChild(sec);
   });
   if (q && shown === 0) content.innerHTML = '<div class="none">no matches for “' + esc(refQuery) + '”</div>';
   el('ref-count').textContent = q
      ? matches + ' match' + (matches === 1 ? '' : 'es') + ' · ' + shown + ' section' + (shown === 1 ? '' : 's')
      : secs.length + ' sections';
}

function openRef(which) {
   if (!compilerModule) return;
   refWhich = which;
   el('ref-tab-cheat').classList.toggle('on', which === 0);
   el('ref-tab-spec').classList.toggle('on', which === 1);
   el('ref').hidden = false;
   renderRef();
   el('ref-q').focus();
   el('ref-content').scrollTop = 0;
}
function closeRef() { el('ref').hidden = true; }

el('doc-open').addEventListener('click', () => openRef(refWhich));   // opens on last-used tab
el('ref-tab-cheat').addEventListener('click', () => openRef(0));
el('ref-tab-spec').addEventListener('click', () => openRef(1));
el('ref-close').addEventListener('click', closeRef);
el('ref').addEventListener('click', (e) => { if (e.target === el('ref')) closeRef(); });
el('ref-q').addEventListener('input', (e) => { refQuery = e.target.value; renderRef(); });
document.addEventListener('keydown', (e) => {
   if (e.key === 'Escape' && !el('ref').hidden) { e.preventDefault(); closeRef(); }
});

// ---- Line-number gutter --------------------------------------------------
// A plain <div> beside the textarea, sharing its font metrics; we rebuild the
// numbers on input and mirror the textarea's vertical scroll onto it.
function syncGutter() {
   const g = el('gutter'), ta = el('code');
   const n = ta.value.split('\n').length;
   if (String(n) !== g.dataset.n) {
      let s = '';
      for (let i = 1; i <= n; i++) s += i + '\n';
      g.textContent = s.slice(0, -1);
      g.dataset.n = n;
   }
   g.scrollTop = ta.scrollTop;
}
el('code').addEventListener('input', syncGutter);
el('code').addEventListener('scroll', () => { el('gutter').scrollTop = el('code').scrollTop; });

// ---- Example programs ----------------------------------------------------
// String.raw keeps ail's own backslashes (\n in print strings) literal.
const EXAMPLES = [
   { name: 'Fibonacci', code: String.raw`func fib(n i64) i64 {
   if (n < 2) { return n; }
   return (fib((n - 1)) + fib((n - 2)));
}

func main() i32 {
   var i i64 = 0;
   while (i < 10) {
      print_int(fib(i));
      print(" ");
      i = (i + 1);
   }
   print("\n");
   return 0;
}
` },
   { name: 'FizzBuzz', code: String.raw`func main() i32 {
   var i i64 = 1;
   while (i <= 20) {
      if ((i % 15) == 0) { print("FizzBuzz"); }
      else if ((i % 3) == 0) { print("Fizz"); }
      else if ((i % 5) == 0) { print("Buzz"); }
      else { print_int(i); }
      print("\n");
      i = (i + 1);
   }
   return 0;
}
` },
   { name: 'Primes', code: String.raw`func is_prime(n i64) bool {
   if (n < 2) { return false; }
   var d i64 = 2;
   while ((d * d) <= n) {
      if ((n % d) == 0) { return false; }
      d = (d + 1);
   }
   return true;
}

func main() i32 {
   var i i64 = 2;
   var count i64 = 0;
   while (count < 15) {
      if (is_prime(i)) {
         print_int(i); print(" ");
         count = (count + 1);
      }
      i = (i + 1);
   }
   print("\n");
   return 0;
}
` },
   { name: 'Collatz', code: String.raw`func main() i32 {
   var n i64 = 27;
   var steps i64 = 0;
   while (n != 1) {
      if ((n % 2) == 0) { n = (n / 2); }
      else { n = ((3 * n) + 1); }
      steps = (steps + 1);
   }
   print("27 reaches 1 in "); print_int(steps); print(" steps\n");
   return 0;
}
` },
   { name: 'Structs', code: String.raw`struct Point { x i64; y i64; }

func add(a Point, b Point) Point {
   return Point{ x: (a.x + b.x), y: (a.y + b.y) };
}

func main() i32 {
   var p Point = add(Point{ x: 3, y: 4 }, Point{ x: 10, y: 20 });
   print("sum = ("); print_int(p.x); print(", "); print_int(p.y); print(")\n");
   return 0;
}
` },
   { name: 'Sorting', code: String.raw`func main() i32 {
   var a [8]i64 = { 5, 2, 9, 1, 7, 3, 8, 4 };
   sort_i64(a);
   var i i64 = 0;
   while (i < 8) { print_int(a[i]); print(" "); i = (i + 1); }
   print("\n");
   return 0;
}
` },
];

(function initExamples() {
   const sel = el('example');
   EXAMPLES.forEach((ex, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = ex.name;
      sel.appendChild(o);
   });
   sel.addEventListener('change', () => {
      el('code').value = EXAMPLES[sel.value].code;
      el('stdout').textContent = ''; el('diag').textContent = '';
      syncGutter();
      el('code').focus();
   });
   el('code').value = EXAMPLES[0].code;      // load the default into the empty editor
   syncGutter();
})();

el('run').addEventListener('click', onRun);
el('check').addEventListener('click', onCheck);
el('download').addEventListener('click', onDownload);
el('code').addEventListener('keydown', (e) => {
   if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun(); return; }
   if (e.key === 'Tab') {                      // indent in place instead of moving focus
      e.preventDefault();
      const ta = e.target, s = ta.selectionStart, pad = '   ';   // 3 spaces, matching ail style
      ta.value = ta.value.slice(0, s) + pad + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + pad.length;
   }
});

loadCompiler();
