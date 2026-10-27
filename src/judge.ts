import type { TestCase } from './problems';
export type Verdict = 'AC' | 'WA' | 'CE' | 'RE' | 'TLE' | 'IE';
export type CaseResult = { index: number; verdict: Verdict; elapsedMs: number; stdout: string; expected: string; input: string; hidden: boolean; detail?: string };
export type JudgeResult = { verdict: Verdict; cases: CaseResult[]; logs: string; elapsedMs: number };
type WorkerMessage = { kind: 'progress' | 'compiled' | 'case' | 'done' | 'error'; message?: string; ok?: boolean; logs?: string; index?: number; stdout?: string; elapsedMs?: number; detail?: string };
const normalize = (s: string) => s.replace(/\r\n/g, '\n').trimEnd().split('\n').map(x => x.trimEnd()).join('\n');
const BASE = new URL(import.meta.env.BASE_URL, document.baseURI).href;
let cachedWorker: Worker | null = null;
function workerInstance(): Worker {
    if (!cachedWorker) cachedWorker = new Worker(`${BASE}engine/judge-worker.js`);
    return cachedWorker;
}
function resetWorker(worker: Worker) { worker.terminate(); if (cachedWorker === worker) cachedWorker = null; }
export function judge(code: string, tests: TestCase[], onUpdate: (message: string) => void, signal?: AbortSignal): Promise<JudgeResult> {
    return new Promise(resolve => {
        const worker = workerInstance();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const started = performance.now(), cases: CaseResult[] = [], logs: string[] = [];
        let done = false;
        function finish(verdict: Verdict, detail?: string, reset = false) {
            if (done) return; done = true; clearTimeout(timer);
            worker.onmessage = null; worker.onerror = null;
            signal?.removeEventListener('abort', abort);
            if (reset) resetWorker(worker);
            if (detail) logs.push(detail);
            resolve({ verdict, cases, logs: logs.join('\n'), elapsedMs: Math.round(performance.now() - started) });
        }
        const abort = () => finish('IE', 'Đã hủy thao tác.', true);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        function arm(ms: number, verdict: Verdict, message: string) {
            clearTimeout(timer); timer = setTimeout(() => finish(verdict, message, true), ms);
        }
        worker.onerror = e => { e.preventDefault(); finish('IE', `Worker error ${e.filename}:${e.lineno}: ${e.message}`, true); };
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
            const m = event.data;
            if (m.kind === 'progress') { onUpdate(m.message ?? 'Đang khởi tạo…'); return; }
            if (m.kind === 'error') { finish('IE', m.detail, true); return; }
            if (m.kind === 'compiled') {
                if (m.logs) logs.push(m.logs);
                if (!m.ok) { finish('CE'); return; }
                onUpdate('Biên dịch thành công, đang chạy test…');
                arm(2500, 'TLE', 'Một test chạy vượt 2500 ms; Worker đã được kết thúc.'); return;
            }
            if (m.kind === 'case') {
                const idx = m.index ?? cases.length, t = tests[idx];
                if (!t) { finish('IE', 'Test case index không hợp lệ.', true); return; }
                const result: CaseResult = { index: idx, verdict: m.detail ? 'RE' : normalize(m.stdout ?? '') === normalize(t.expected) ? 'AC' : 'WA', elapsedMs: m.elapsedMs ?? 0, stdout: m.stdout ?? '', expected: t.expected, input: t.input, hidden: !!t.hidden, detail: m.detail };
                cases.push(result); onUpdate(`Đã chấm ${cases.length}/${tests.length} test`);
                if (result.verdict === 'RE') { finish('RE', undefined, true); return; }
                if (cases.length === tests.length) { finish(cases.every(x => x.verdict === 'AC') ? 'AC' : 'WA'); return; }
                arm(2500, 'TLE', 'Một test chạy vượt 2500 ms; Worker đã được kết thúc.'); return;
            }
            if (m.kind === 'done') finish(cases.every(x => x.verdict === 'AC') ? 'AC' : 'WA');
        };
        // This is an initialization + compilation ceiling, NOT the per-test time limit.
        arm(300000, 'IE', `Khởi tạo hoặc biên dịch vượt 5 phút. Có thể Clang WASM quá nặng so với RAM/CPU trình duyệt. Mở DevTools > Performance/Memory. Base URL: ${BASE}`);
        worker.postMessage({ kind: 'start', code, tests: tests.map(x => x.input) });
    });
}