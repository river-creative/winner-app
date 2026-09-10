import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the scanner does with the stream of codes a camera produces.
 *
 * The camera and the decoders are hardware and third-party wasm, and the lookup a code resolves
 * to is covered by `winner-search.test.ts`. Between those two sits the part that is this app's
 * own and had no coverage: a decoder fires the *same* code many times a second, and every one of
 * those is a potential extra lookup against a live pickup desk.
 *
 * The engine is replaced with a stub that hands back its decode callback, so the callback can be
 * fired exactly the way a camera would.
 */

let decodeCallback: ((value: string) => void) | null = null;
const engineStop = vi.fn();
const findByTicketCode = vi.fn();
const getAll = vi.fn();

vi.mock('$lib/services/scan-engines', () => ({
  createScanEngine: vi.fn(async () => ({
    name: 'stub',
    downgradeReason: '',
    start: async (_v: unknown, onDecode: (value: string) => void) => {
      decodeCallback = onDecode;
    },
    stop: engineStop
  }))
}));

vi.mock('$lib/services/winner-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/winner-search')>()),
  findByTicketCode: (...a: unknown[]) => findByTicketCode(...a)
}));

vi.mock('$lib/api/client', () => ({
  getAll: (...a: unknown[]) => getAll(...a),
  save: vi.fn(),
  batchSave: vi.fn(),
  onSessionExpired: vi.fn()
}));

vi.mock('./data.svelte', () => ({
  data: {
    get winners() {
      return [];
    },
    setWinners: vi.fn(),
    patchWinner: vi.fn(),
    reportWriteFailure: vi.fn()
  }
}));

vi.mock('./toasts.svelte', () => ({
  toasts: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), fromError: vi.fn() }
}));

const { scanner } = await import('./scanner.svelte');

/** A code that `isTicketCode` accepts, so the decode reaches the lookup. */
const CODE = 'A-374145';

async function startWithFakeCamera(): Promise<void> {
  scanner.attachVideo(document.createElement('video'));
  await scanner.start();
}

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  vi.clearAllMocks();
  decodeCallback = null;
  getAll.mockResolvedValue([]);
  findByTicketCode.mockResolvedValue(null);
  scanner.deactivate();
  scanner.reset();
});

describe('the decode stream', () => {
  it('hands the engine a decode callback when it starts', async () => {
    await startWithFakeCamera();
    expect(decodeCallback).toBeTypeOf('function');
  });

  // A decoder reports the same code every frame it stays in view. Unguarded that is one lookup
  // per frame against a live pickup desk.
  //
  // Two guards defend this independently — the `#processing` re-entrancy flag and the
  // `DEDUPE_WINDOW_MS` window — so removing either one alone leaves this green; removing both
  // turns it into three lookups. It is asserted as one behaviour on purpose: which guard holds
  // the line is an implementation detail, and pinning the test to one of them would make it
  // fail on a refactor that is still correct.
  it('looks a repeated code up once, not once per frame', async () => {
    await startWithFakeCamera();
    decodeCallback?.(CODE);
    decodeCallback?.(CODE);
    decodeCallback?.(CODE);
    await settle();

    expect(findByTicketCode).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty decode', async () => {
    await startWithFakeCamera();
    decodeCallback?.('');
    await settle();
    expect(findByTicketCode).not.toHaveBeenCalled();
  });

  // A poster, a wifi QR or a parking sign drifting through frame must not toast or search.
  it('silently ignores a code that is not a ticket code', async () => {
    await startWithFakeCamera();
    decodeCallback?.('https://example.com/not-a-ticket');
    await settle();
    expect(findByTicketCode).not.toHaveBeenCalled();
  });

  // The camera is stopped for as long as a result is on screen, so a code drifting through frame
  // cannot replace the record the operator is reading.
  it('stops the camera while a result is being shown', async () => {
    findByTicketCode.mockResolvedValue({ kind: 'winner', person: { name: 'A', prizes: [] } });
    await startWithFakeCamera();
    decodeCallback?.(CODE);
    await settle();

    expect(engineStop).toHaveBeenCalled();
    expect(scanner.isScanning).toBe(false);
  });

  it('reads winners fresh for the lookup rather than trusting the boot snapshot', async () => {
    await startWithFakeCamera();
    decodeCallback?.(CODE);
    await settle();

    // Several pickup desks run at once; a cached list is how one prize gets handed out twice.
    expect(getAll).toHaveBeenCalledWith('winners');
  });

  // "I scanned it and nothing happened" is the failure mode at a pickup desk, so a code that
  // matches nobody has to say so — and say which code it was.
  it('surfaces a code that matches nobody, quoting it back', async () => {
    findByTicketCode.mockResolvedValue(null);
    await startWithFakeCamera();
    decodeCallback?.(CODE);
    await settle();

    expect(scanner.noWinnerOpen).toBe(true);
    expect(scanner.noWinnerTicketCode).toBe(CODE);
  });
});
