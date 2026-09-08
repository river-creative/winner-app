import type {
  BatchSaveOperation,
  DrawPhase,
  HistoryEntry,
  LastAction,
  List,
  ListEntry,
  Prize,
  Winner
} from '$lib/types';
import type { Candidate } from '$lib/services/eligibility';
import { playSound, stopSound, type SoundOption } from '$lib/services/sounds';
import { formatDisplayName } from '$lib/utils/format';
import { generateId } from '$lib/utils/id';
import { data } from './data.svelte';
import { removesWinners, setup } from './setup.svelte';
import { settings } from './settings.svelte';
import { toasts } from './toasts.svelte';

/** What the public view needs to render the draw it is showing. */
export interface DrawResult {
  winners: Winner[];
  prize: Prize;
  historyId: string;
  /** The `infoConfig` of the list the draw ran against, for the three winner-card lines. */
  infoConfig: List['metadata']['infoConfig'];
}

/** A shuffle of 20 000 entries takes milliseconds; anything near this is a wedged worker. */
const SELECTION_TIMEOUT_MS = 30_000;

/** How often the pre-selection delay updates its countdown. Smooth enough, and it always fires. */
const DELAY_TICK_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DrawStore {
  #phase = $state<DrawPhase>('idle');
  #result = $state<DrawResult | null>(null);
  #revealedCount = $state(0);
  #error = $state<string | null>(null);

  /** 0 → 1 through the pre-selection delay, for the countdown and progress visuals. */
  #delayProgress = $state(0);
  #delayRemaining = $state(0);

  #lastAction = $state<LastAction | null>(null);
  #sounds: SoundOption[] = [];

  get phase(): DrawPhase {
    return this.#phase;
  }
  get result(): DrawResult | null {
    return this.#result;
  }
  get revealedCount(): number {
    return this.#revealedCount;
  }
  get error(): string | null {
    return this.#error;
  }
  get delayProgress(): number {
    return this.#delayProgress;
  }
  get delayRemaining(): number {
    return this.#delayRemaining;
  }

  readonly busy = $derived(this.#phase === 'delaying' || this.#phase === 'selecting');
  readonly showingWinners = $derived(this.#phase === 'revealing' || this.#phase === 'revealed');

  /** Undo is offered until SMS goes out, after which the messages cannot be recalled. */
  readonly canUndo = $derived(this.#lastAction !== null && !this.#lastAction.smsSent);

  get lastAction(): LastAction | null {
    return this.#lastAction;
  }

  setSounds(sounds: SoundOption[]): void {
    this.#sounds = sounds;
  }

  /** Called after SMS is sent, so undo stops being offered. */
  markSmsSent(count: number): void {
    if (!this.#lastAction) return;
    this.#lastAction = {
      ...this.#lastAction,
      smsSent: true,
      smsSentCount: count,
      smsSentAt: Date.now()
    };
  }

  // -------------------------------------------------------------------------------------------
  // Running a draw
  // -------------------------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.busy) return;
    this.#error = null;

    const prize = setup.selectedPrize;
    if (!prize) {
      toasts.warning('Please select at least one list and a prize.');
      return;
    }

    // The same function the Setup screen counts with, so the pool is exactly what was promised.
    const { candidates } = setup.eligibility;
    if (candidates.length === 0) {
      const excluded = setup.excludedCount;
      toasts.warning(
        excluded > 0
          ? `No entries available (${excluded} excluded — already won ${prize.name}).`
          : 'No entries available in the selected lists.'
      );
      return;
    }

    const count = setup.winnersCount;
    if (prize.quantity < count) {
      toasts.warning(`Not enough prizes available. Only ${prize.quantity} remaining.`);
      return;
    }
    if (candidates.length < count) {
      toasts.warning(`Not enough entries. Only ${candidates.length} available.`);
      return;
    }

    try {
      // The delay and the draw run together: the winners are picked and written while the
      // countdown is on screen, so the reveal is instant when the countdown ends.
      this.#phase = 'delaying';
      const selectionPromise = this.#selectAndCommit(candidates, prize, count);
      const delayPromise = this.#runDelay();

      const [result] = await Promise.all([selectionPromise, delayPromise]);

      this.#result = result;
      this.#revealedCount = 0;
      this.#phase = 'revealing';
      await this.#reveal(result);
    } catch (error) {
      // Without this the phase sticks on 'selecting' and the public view spins forever.
      this.#phase = 'idle';
      this.#error = error instanceof Error ? error.message : 'The draw failed.';
      toasts.fromError(error, 'The draw failed. Nothing was saved.');
    }
  }

  /** Pick the winners off the main thread, build the records, and write them in one batch. */
  async #selectAndCommit(candidates: Candidate[], prize: Prize, count: number): Promise<DrawResult> {
    // Positions, not entries. The entries are `$state` proxies and a Proxy cannot be
    // structured-cloned, so posting them to the worker throws; indices also keep the object
    // identity that maps each winner back to the list it came from.
    const selected = await runSelection(candidates.length, count);

    const historyId = generateId(8);
    const baseTimestamp = Date.now();
    const usedIds = new Set<string>();

    const winners: Winner[] = selected.map((poolIndex, index) => {
      let winnerId = generateId();
      while (usedIds.has(winnerId)) winnerId = generateId();
      usedIds.add(winnerId);

      const candidate = candidates[poolIndex] as Candidate;
      const entry = candidate.entry;

      return {
        winnerId,
        entryId: entry.id,
        // Each winner's name is rendered with *their own* list's template. The old code used the
        // first selected list's template for every winner of a combined draw, so winners from
        // the other lists came out wrong or as "Unknown".
        displayName: formatDisplayName(entry, candidate.nameConfig),
        prize: prize.name,
        // Unique per winner, so a stable sort by time keeps the reveal order.
        timestamp: baseTimestamp + index,
        listId: candidate.listId,
        listName: candidate.listName,
        historyId,
        pickedUp: false,
        pickupTimestamp: null,
        position: index + 1,
        data: entry.data
      };
    });

    const sourceLists = setup.selectedLists;
    const firstList = sourceLists[0];

    const historyEntry: HistoryEntry = {
      historyId,
      // A combined draw used to write `undefined` here, which broke every lookup that joined
      // history to a list. It now records the first list and keeps the full set alongside.
      listId: firstList?.listId ?? '',
      listIds: sourceLists.map((list) => list.listId),
      listName:
        sourceLists.length > 1
          ? `Combined Lists (${sourceLists.length})`
          : (firstList?.metadata.name ?? 'Unknown'),
      prize: prize.name,
      winners: winners.map((winner) => ({
        winnerId: winner.winnerId,
        displayName: winner.displayName
      })),
      timestamp: baseTimestamp
    };

    // Re-read the prize immediately before decrementing so a change made elsewhere in this
    // session is not overwritten. Two operators drawing at once can still race — the store has
    // no compare-and-set — but this closes the window to the width of one request.
    const freshPrize = data.prizeById(prize.prizeId) ?? prize;
    const updatedPrize: Prize = {
      ...freshPrize,
      quantity: Math.max(0, freshPrize.quantity - count)
    };

    const operations: BatchSaveOperation[] = [
      ...winners.map((winner) => ({
        collection: 'winners' as const,
        data: winner as unknown as Record<string, unknown>
      })),
      { collection: 'prizes', data: updatedPrize as unknown as Record<string, unknown> },
      { collection: 'history', data: historyEntry as unknown as Record<string, unknown> }
    ];

    // Remove the drawn entries from every source list that is configured to lose them.
    const removedEntries: ListEntry[] = [];
    const drawnIdsByList = new Map<string, Set<string>>();
    for (const winner of winners) {
      const ids = drawnIdsByList.get(winner.listId) ?? new Set<string>();
      ids.add(winner.entryId);
      drawnIdsByList.set(winner.listId, ids);
    }

    const updatedLists: List[] = [];
    for (const list of sourceLists) {
      const drawnIds = drawnIdsByList.get(list.listId);
      if (!drawnIds || drawnIds.size === 0 || !removesWinners(list)) continue;

      const kept: ListEntry[] = [];
      for (const entry of list.entries) {
        if (drawnIds.has(entry.id)) removedEntries.push(entry);
        else kept.push(entry);
      }

      const updated: List = {
        ...list,
        entries: kept,
        metadata: { ...list.metadata, entryCount: kept.length }
      };
      updatedLists.push(updated);
      operations.push({
        collection: 'lists',
        data: updated as unknown as Record<string, unknown>
      });
    }

    await data.commit(operations);

    // Only touch local state once the write succeeded, so a failure leaves nothing half-applied.
    data.addWinners(winners);
    data.upsertPrize(updatedPrize);
    data.upsertHistory(historyEntry);
    for (const list of updatedLists) data.upsertList(list);

    this.#lastAction = {
      type: 'selectWinners',
      winners,
      removedEntries,
      prizeId: prize.prizeId,
      prizeCount: count,
      historyId,
      entriesRemoved: removedEntries.length > 0
    };

    void this.#fireWebhook(winners, prize, historyEntry);

    return {
      winners,
      prize: updatedPrize,
      historyId,
      infoConfig: firstList?.metadata.infoConfig
    };
  }

  // -------------------------------------------------------------------------------------------
  // Delay and reveal
  // -------------------------------------------------------------------------------------------

  async #runDelay(): Promise<void> {
    const seconds = settings.current.preSelectionDelay;
    if (!seconds || seconds <= 0) return;

    const duringSound = settings.current.soundDuringDelay;
    if (duringSound && duringSound !== 'none') void playSound(duringSound, this.#sounds);

    const totalMs = seconds * 1000;
    const startedAt = performance.now();

    // An interval, deliberately not `requestAnimationFrame`.
    //
    // rAF does not fire at all in a hidden tab — measured at zero frames per second. The delay
    // and the draw run concurrently, so the winners are already written by this point; a loop
    // that never advances leaves them committed but never revealed, with no timeout and no way
    // out but a reload. An operator switching tabs mid-countdown on stage is enough to trigger
    // it. A timer is throttled while hidden but still fires, so the draw always completes.
    //
    // The countdown, the progress bar and the dots all read the same two numbers off the wall
    // clock rather than counting ticks, so none of them drift when the throttling kicks in.
    await new Promise<void>((resolve) => {
      const step = () => {
        const elapsed = performance.now() - startedAt;
        this.#delayProgress = Math.min(1, elapsed / totalMs);
        this.#delayRemaining = Math.max(0, (totalMs - elapsed) / 1000);
        if (elapsed >= totalMs) {
          clearInterval(timer);
          resolve();
        }
      };
      const timer = setInterval(step, DELAY_TICK_MS);
      step();
    });

    stopSound();

    const endSound = settings.current.soundEndOfDelay;
    if (endSound && endSound !== 'none') {
      // The sting needs a beat of silence in front of it and a beat to land in behind it,
      // otherwise the reveal steps on its own drum roll.
      await sleep(100);
      void playSound(endSound, this.#sounds);
      await sleep(500);
    }

    this.#delayProgress = 0;
    this.#delayRemaining = 0;
  }

  /**
   * Bring the winners onto the screen.
   *
   * `all-at-once` shows every card immediately. `sequential` staggers them. `individual` waits
   * for the operator to advance, which is what makes it different from `sequential` — the old
   * code treated the two identically.
   */
  async #reveal(result: DrawResult): Promise<void> {
    const revealSound = settings.current.soundDuringReveal;
    if (revealSound && revealSound !== 'none') void playSound(revealSound, this.#sounds);

    const mode = settings.current.selectionMode;

    if (mode === 'individual') {
      this.#revealedCount = 0;
      this.#phase = 'revealing';
      return;
    }

    // Selection Mode alone decides this. `prefersReducedMotion()` was ORed in here, which turned
    // a Sequential Reveal into an all-at-once dump whenever the projector's machine had the OS
    // flag set — the operator's explicit choice, discarded without a word.
    if (mode === 'all-at-once') {
      this.#revealedCount = result.winners.length;
      this.#phase = 'revealed';
      return;
    }

    const stepMs = Math.max(0, settings.current.displayDuration * 1000);
    for (let index = 0; index < result.winners.length; index++) {
      this.#revealedCount = index + 1;
      if (index < result.winners.length - 1) await sleep(stepMs);
    }
    this.#phase = 'revealed';
  }

  /** Advance one card in `individual` mode. */
  revealNext(): void {
    const total = this.#result?.winners.length ?? 0;
    if (this.#revealedCount >= total) return;
    this.#revealedCount += 1;
    if (this.#revealedCount >= total) this.#phase = 'revealed';
  }

  revealAll(): void {
    const total = this.#result?.winners.length ?? 0;
    this.#revealedCount = total;
    this.#phase = total > 0 ? 'revealed' : 'idle';
  }

  /** Back to the setup screen, keeping the last action so undo is still available. */
  reset(): void {
    stopSound();
    this.#phase = 'idle';
    this.#result = null;
    this.#revealedCount = 0;
    this.#error = null;
  }

  // -------------------------------------------------------------------------------------------
  // Undo
  // -------------------------------------------------------------------------------------------

  /**
   * Reverse the last draw: delete its winners and its history entry, give the prize quantity
   * back, and put the entries back in the lists they were taken from.
   *
   * Entries are restored only when the draw actually removed them, and each goes back to its own
   * source list — a combined draw took them from several.
   */
  async undo(): Promise<boolean> {
    const action = this.#lastAction;
    if (!action) {
      toasts.warning('There is nothing to undo.');
      return false;
    }
    if (action.smsSent) {
      toasts.warning(
        `This draw cannot be undone: SMS messages were already sent to ${action.smsSentCount ?? 0} winner(s).`
      );
      return false;
    }

    const operations: BatchSaveOperation[] = action.winners.map((winner) => ({
      collection: 'winners' as const,
      operation: 'delete' as const,
      id: winner.winnerId
    }));

    operations.push({ collection: 'history', operation: 'delete', id: action.historyId });

    const prize = data.prizeById(action.prizeId);
    const restoredPrize = prize ? { ...prize, quantity: prize.quantity + action.prizeCount } : undefined;
    if (restoredPrize) {
      operations.push({
        collection: 'prizes',
        data: restoredPrize as unknown as Record<string, unknown>
      });
    }

    const restoredLists: List[] = [];
    if (action.entriesRemoved && action.removedEntries.length > 0) {
      const entriesByList = new Map<string, ListEntry[]>();
      for (const winner of action.winners) {
        const entry = action.removedEntries.find((candidate) => candidate.id === winner.entryId);
        if (!entry) continue;
        const bucket = entriesByList.get(winner.listId) ?? [];
        bucket.push(entry);
        entriesByList.set(winner.listId, bucket);
      }

      for (const [listId, entries] of entriesByList) {
        const list = data.listById(listId);
        if (!list) continue;
        const restored: List = {
          ...list,
          entries: [...list.entries, ...entries],
          metadata: { ...list.metadata, entryCount: list.entries.length + entries.length }
        };
        restoredLists.push(restored);
        operations.push({
          collection: 'lists',
          data: restored as unknown as Record<string, unknown>
        });
      }
    }

    try {
      await data.commit(operations);
    } catch (error) {
      toasts.fromError(error, 'Could not undo the draw. Nothing was changed.');
      return false;
    }

    data.removeWinners(new Set(action.winners.map((winner) => winner.winnerId)));
    data.removeHistory(action.historyId);
    if (restoredPrize) data.upsertPrize(restoredPrize);
    for (const list of restoredLists) data.upsertList(list);

    this.#lastAction = null;
    this.reset();
    toasts.success('The last draw was undone.');
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------------------------

  /**
   * Fire-and-forget. Every failure is swallowed on purpose: a webhook the operator configured
   * months ago must never be able to interrupt a live draw.
   */
  async #fireWebhook(winners: Winner[], prize: Prize, entry: HistoryEntry): Promise<void> {
    const { enableWebhook, webhookUrl } = settings.current;
    if (!enableWebhook || !webhookUrl) return;

    const payload = {
      timestamp: Date.now(),
      event: 'winners_selected',
      winners,
      prize,
      listId: entry.listId,
      listIds: entry.listIds,
      listName: entry.listName,
      selectionId: entry.historyId
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        body: JSON.stringify(payload)
      });
    } catch {
      try {
        const url = new URL(webhookUrl);
        url.searchParams.set('event', 'winners_selected');
        url.searchParams.set('timestamp', String(payload.timestamp));
        await fetch(url.toString(), { cache: 'no-store' });
      } catch {
        /* the draw is what matters; the notification is not */
      }
    }
  }
}

/**
 * Run the shuffle in a worker, and always terminate it.
 *
 * If the worker cannot be constructed at all — an old browser, a CSP that blocks `blob:` — the
 * same algorithm runs on the main thread. A draw that briefly janks is better than one that
 * cannot happen.
 */
async function runSelection(poolSize: number, count: number): Promise<number[]> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('$lib/workers/selection.worker.ts', import.meta.url), {
      type: 'module'
    });
  } catch {
    const { selectIndices } = await import('$lib/services/shuffle');
    return selectIndices(poolSize, count);
  }

  try {
    return await new Promise<number[]>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('The draw took too long and was cancelled.')),
        SELECTION_TIMEOUT_MS
      );

      worker.addEventListener('message', (event: MessageEvent) => {
        clearTimeout(timeout);
        const message = event.data as { type: string; indices?: number[]; error?: string };
        if (message.type === 'complete' && message.indices) resolve(message.indices);
        else reject(new Error(message.error ?? 'The draw failed.'));
      });

      worker.addEventListener('error', (event) => {
        clearTimeout(timeout);
        reject(new Error(event.message || 'The draw worker failed.'));
      });

      worker.postMessage({ poolSize, numWinners: count });
    });
  } finally {
    worker.terminate();
  }
}

export const draw = new DrawStore();
