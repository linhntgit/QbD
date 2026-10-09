import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMonteCarloInWorker, terminateWorker } from '../services/analysisWorkerClient';
import type { WorkerRequestMessage } from '../workers/workerProtocol';
import type { MonteCarloResult } from '../types/qbd';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failPost = false;
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  request: WorkerRequestMessage | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(request: WorkerRequestMessage) {
    if (FakeWorker.failPost) throw new Error('Failed to clone payload');
    this.request = request;
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: { type: 'SUCCESS'; result: MonteCarloResult } | { type: 'ERROR'; error: string } | { type: 'PROGRESS'; progress: number }) {
    const event = { data: { ...message, taskId: this.request!.taskId } };
    this.listeners.get('message')?.forEach((handler) => handler(event));
  }

  fail(message: string) {
    this.listeners.get('error')?.forEach((handler) => handler({ message }));
  }
}

const result = { simulations: 1 } as unknown as MonteCarloResult;
const run = (abortSignal?: AbortSignal) => runMonteCarloInWorker({}, [], [], {}, 2, 1, 5, undefined, abortSignal);

describe('Web Worker task lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.instances = [];
    FakeWorker.failPost = false;
  });

  afterEach(() => {
    terminateWorker();
    vi.unstubAllGlobals();
  });

  it('isolates concurrent simulations when one is cancelled', async () => {
    const controller = new AbortController();
    const cancelled = run(controller.signal);
    const completed = run();
    const [first, second] = FakeWorker.instances;
    expect(first).not.toBe(second);

    const cancelledAssertion = expect(cancelled).rejects.toThrow('đã bị hủy');
    controller.abort();
    await cancelledAssertion;
    expect(first.terminated).toBe(true);
    expect(second.terminated).toBe(false);

    second.emit({ type: 'SUCCESS', result });
    await expect(completed).resolves.toEqual(result);
    expect(second.terminated).toBe(true);
  });

  it('settles all pending promises when workers are explicitly terminated', async () => {
    const pending = [run(), run()];
    const assertions = pending.map((promise) => expect(promise).rejects.toThrow('đã bị hủy'));
    terminateWorker();
    await Promise.all(assertions);
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });

  it('cleans up worker errors', async () => {
    const pending = run();
    const assertion = expect(pending).rejects.toThrow('Worker crashed');
    FakeWorker.instances[0].fail('Worker crashed');
    await assertion;
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('rejects payload cloning errors and releases the worker', async () => {
    FakeWorker.failPost = true;
    await expect(run()).rejects.toThrow('Failed to clone payload');
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});
