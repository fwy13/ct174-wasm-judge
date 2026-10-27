/* Browser-only Clang/WASI judge. Keep compiler modules alive across submissions. */
importScripts('./shared.js');
let api = null;
let initializePromise = null;
let submissionNumber = 0;
const urlFor = name => new URL(name, new URL('./', self.location.href));
function send(kind, extra = {}) { self.postMessage({ kind, ...extra }); }
function clean(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
async function fetchAsset(name) {
    const url = urlFor(name);
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Không tải được ${name}: HTTP ${res.status} (${url})`);
    const data = await res.arrayBuffer();
    const prefix = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(80, data.byteLength)));
    if (!data.byteLength || /^\s*(?:<!doctype|<html|<head|<body)/i.test(prefix))
        throw new Error(`${name} trả về HTML hoặc file trống: ${url}`);
    if (name !== 'sysroot.tar' && (data.byteLength < 8 || new DataView(data).getUint32(0, true) !== 0x6d736100))
        throw new Error(`${name} không phải WASM: ${url}`);
    return data;
}
const options = {
    readBuffer: fetchAsset,
    async compileStreaming(name) {
        send('progress', { message: `Đang tải/biên dịch ${name}…` });
        // compileStreaming avoids an extra full copy and lets the engine start compiling as bytes arrive.
        const url = urlFor(name);
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`Không tải được ${name}: HTTP ${response.status}`);
        const mime = response.headers.get('content-type') || '';
        if (/application\/wasm/i.test(mime) && WebAssembly.compileStreaming) {
            try { return await WebAssembly.compileStreaming(Promise.resolve(response)); }
            catch (err) { throw new Error(`Biên dịch ${name} thất bại: ${err}`); }
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 8 || new DataView(buffer).getUint32(0, true) !== 0x6d736100)
            throw new Error(`${name} không phải WASM hợp lệ (${buffer.byteLength} bytes)`);
        return await WebAssembly.compile(buffer);
    },
    hostWrite(s) { if (api) api._capture += s; }
};
async function initialize() {
    if (api) return api;
    if (!initializePromise) initializePromise = (async () => {
        send('progress', { message: 'Đang khởi tạo WASI filesystem…' });
        const instance = new API(options);
        api = instance;
        api._capture = '';
        await api.ready;
        send('progress', { message: 'Đang biên dịch Clang WASM (lần đầu có thể rất lâu)…' });
        await api.getModule(api.clangFilename);
        send('progress', { message: 'Đang biên dịch LLD WASM…' });
        await api.getModule(api.lldFilename);
        send('progress', { message: 'Clang/LLD đã sẵn sàng; lần nộp tiếp theo sẽ dùng lại.' });
        return api;
    })().catch(e => { api = null; initializePromise = null; throw e; });
    return initializePromise;
}
async function compileAndJudge(data) {
    const engine = await initialize();
    const serial = ++submissionNumber;
    const input = `submission_${serial}.c`, obj = `submission_${serial}.o`, wasm = `submission_${serial}.wasm`;
    engine._capture = '';
    engine.memfs.addFile(input, data.code);
    const clang = await engine.getModule(engine.clangFilename);
    send('progress', { message: 'Đang biên dịch mã C…' });
    await engine.run(clang, 'clang', '-cc1', '-emit-obj', ...engine.clangCommonArgs,
        '-triple=wasm32-wasi', '-O0', '-o', obj, '-x', 'c', input);
    const compLog = clean(engine._capture);
    let objectPresent = true;
    try { engine.memfs.getFileContents(obj); } catch (_) { objectPresent = false; }
    if (!objectPresent || /\berror:/i.test(compLog)) { send('compiled', { ok: false, logs: compLog }); return; }
    send('progress', { message: 'Đang liên kết chương trình…' });
    await engine.link(obj, wasm);
    let wasmBytes;
    try { wasmBytes = engine.memfs.getFileContents(wasm).slice(); }
    catch (_) { send('compiled', { ok: false, logs: clean(engine._capture) }); return; }
    const program = await WebAssembly.compile(wasmBytes);
    send('compiled', { ok: true, logs: clean(engine._capture) });
    for (let i = 0; i < data.tests.length; i++) {
        engine.memfs.setStdinStr(data.tests[i]);
        engine._capture = '';
        const start = performance.now();
        let detail;
        try { await engine.run(program, wasm); }
        catch (err) { detail = String(err?.message || err); }
        const elapsedMs = Math.round(performance.now() - start);
        let raw = clean(engine._capture);
        const marker = raw.indexOf(wasm + '\n');
        if (marker >= 0) raw = raw.slice(marker + wasm.length + 1);
        raw = raw.replace(/\n$/, '');
        send('case', { index: i, stdout: raw, elapsedMs, detail });
        if (detail) return;
    }
    send('done');
}
self.onmessage = async ({ data }) => {
    if (data?.kind !== 'start') return;
    try { await compileAndJudge(data); }
    catch (error) { send('error', { detail: String(error?.stack || error) }); }
};