import type { TestCase } from './problems';
export type Verdict = 'AC' | 'WA' | 'CE' | 'RE' | 'TLE' | 'IE';
export type CaseResult = { index: number; verdict: Verdict; elapsedMs: number; stdout: string; expected: string; input: string; hidden: boolean; detail?: string };
export type JudgeResult = { verdict: Verdict; cases: CaseResult[]; logs: string; elapsedMs: number };
type WorkerMessage = { kind: 'compiled' | 'case' | 'done' | 'error'; ok?: boolean; logs?: string; index?: number; stdout?: string; elapsedMs?: number; detail?: string };
const normalize = (s: string) => s.replace(/\r\n/g, '\n').trimEnd().split('\n').map(x => x.trimEnd()).join('\n');
const BASE = import.meta.env.BASE_URL;
export function judge(code: string, tests: TestCase[], onUpdate: (message: string) => void, signal?: AbortSignal): Promise<JudgeResult> {
    return new Promise(resolve => {
        const worker = new Worker(`${BASE}engine/judge-worker.js`); let timer: ReturnType<typeof setTimeout> | undefined;
        const started = performance.now(), cases: CaseResult[] = [], logs: string[] = []; let done = false;
        function finish(verdict: Verdict, detail?: string) { if (done) return; done = true; clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort); if (detail) logs.push(detail); resolve({ verdict, cases, logs: logs.join('\n'), elapsedMs: Math.round(performance.now() - started) }); }
        const abort = () => finish('IE', 'Đã hủy thao tác.'); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) { abort(); return; }
        function arm(ms: number, kind: Verdict) { clearTimeout(timer); timer = setTimeout(() => finish(kind, kind === 'TLE' ? 'Vượt giới hạn thời gian; worker đã bị kết thúc.' : 'Không thể tải hoặc biên dịch bộ công cụ WASM.'), ms); }
        worker.onerror = e => { e.preventDefault(); finish('IE', e.message || 'Worker bị lỗi.'); };
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
            const m = event.data;
            if (m.kind === 'error') { finish('IE', m.detail); return; }
            if (m.kind === 'compiled') { if (m.logs) logs.push(m.logs); if (!m.ok) { finish('CE'); return; } onUpdate('Biên dịch thành công, đang chạy bộ test…'); arm(2500, 'TLE'); return; }
            if (m.kind === 'case') {
                const idx = m.index ?? cases.length, t = tests[idx]; if (!t) { finish('IE', 'Case index không hợp lệ'); return; }
                const result: CaseResult = { index: idx, verdict: m.detail ? 'RE' : normalize(m.stdout ?? '') === normalize(t.expected) ? 'AC' : 'WA', elapsedMs: m.elapsedMs ?? 0, stdout: m.stdout ?? '', expected: t.expected, input: t.input, hidden: !!t.hidden, detail: m.detail }; cases.push(result);
                onUpdate(`Đã chấm ${cases.length}/${tests.length} test`);
                if (result.verdict === 'RE') { finish('RE'); return; }
                if (cases.length === tests.length) { finish(cases.every(x => x.verdict === 'AC') ? 'AC' : 'WA'); return; }
                arm(2500, 'TLE'); return;
            }
            if (m.kind === 'done') { finish(cases.every(x => x.verdict === 'AC') ? 'AC' : 'WA'); }
        };
        arm(120000, 'IE'); worker.postMessage({ kind: 'start', code, tests: tests.map(x => x.input) });
    });
}
