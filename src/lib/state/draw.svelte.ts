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
import { ApiError, type BatchSaveResult } from '$lib/api/client';
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

/**
 * How long the draw will wait for its write before giving up on it.
 *
 * The reveal is held behind this request, so an unbounded wait is a show that never resumes —
 * with a spinner on the projector and no way out but a reload. Generous, because the operator
 * would rather wait than lose the draw, but finite, because "forever" is not a state a live event
 * can be in. Now that the batch carries entry ids instead of whole lists it is a few hundred
 * bytes plus the winner records, so reaching this at all means the server or the link is in
 * trouble, not that the payload is large.
 */
const COMMIT_TIMEOUT_MS = 20_000;

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

  /**
   * Identifies the current run, so work left over from an abandoned one cannot touch the new one.
   *
   * The delay is a timer that always runs to completion — a draw that fails after 100 ms leaves a
   * 3-second countdown still ticking behind it. Without this token that stale timer resolves into
   * whatever draw happens to be running by then and moves its phase.
   */
  #runToken = 0;

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

    const token = ++this.#runToken;

    try {
      // The delay and the draw run together: the winners are picked and written while the
      // countdown is on screen, so the reveal is instant when the countdown ends.
      this.#delayProgress = 0;
      this.#delayRemaining = 0;
      this.#phase = 'delaying';

      // `settled` is the fact the public view had no way to see. `phase === 'delaying'` is
      // equally true a microtask before the reveal and five seconds into a slow write, so the
      // overlay showed "Preparing winners…" on every single draw — including the ones whose
      // winners had been saved two seconds earlier. Now the spinner has something real to key on.
      let settled = false;
      const selectionPromise = this.#selectAndCommit(candidates, prize, count).finally(() => {
        settled = true;
      });

      const delayPromise = this.#runDelay(token).then(() => {
        // Only now is there anything to wait for. Guarded twice: a draw that already failed has
        // set 'idle', and an abandoned run's timer must never speak for the run that replaced it.
        if (!settled && this.#runToken === token && this.#phase === 'delaying') {
          this.#phase = 'selecting';
        }
      });

      const [result] = await Promise.all([selectionPromise, delayPromise]);

      this.#result = result;
      this.#revealedCount = 0;
      this.#phase = 'revealing';
      await this.#reveal(result);
    } catch (error) {
      // Without this the phase sticks on 'selecting' and the public view spins forever.
      this.#phase = 'idle';

      // A write that ran out of time is not a write that did not happen — the server may have
      // applied it after this page stopped waiting. "Nothing was saved" would be a guess, and
      // acting on it by drawing again is how the same prize goes out twice. Re-read instead, so
      // the Winners tab shows whatever actually landed.
      if (error instanceof ApiError && error.timedOut) {
        // Awaited, like undo's: there is no reveal left to unblock — this path already gave up on
        // the draw — and the operator is about to be told to go and look at the Winners tab.
        await this.#resync();
        this.#error =
          'The server did not answer in time. The winners may or may not have been saved — ' +
          'check the Winners tab before drawing again.';
        toasts.error(this.#error);
        return;
      }

      this.#error = error instanceof Error ? error.message : 'The draw failed.';
      toasts.fromError(error, 'The draw failed. Nothing was saved.');
    }
  }

  /**
   * Re-read what the draw writes, after a write whose outcome is unknown.
   *
   * Collection by collection rather than `loadAll()`, which raises the global loading flag and
   * blanks the console mid-incident. Failures are swallowed on purpose: the operator has already
   * been told to check, and a failed refresh must not throw a second error on top of the first.
   */
  async #resync(): Promise<void> {
    try {
      await Promise.all([
        data.reload('winners'),
        data.reload('history'),
        data.reload('prizes'),
        data.reload('lists')
      ]);
    } catch {
      /* nothing useful to add — the message already tells them to check for themselves */
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

      updatedLists.push({
        ...list,
        entries: kept,
        metadata: { ...list.metadata, entryCount: kept.length }
      });

      // Ids, not the list. Rebuilding the list here and posting it whole cost 7.4 MB to remove
      // five entries from a twenty-thousand-entry list — and the room watched a spinner for the
      // whole upload, because the reveal waits on this write.
      operations.push({
        collection: 'lists',
        operation: 'removeEntries',
        id: list.listId,
        entryIds: [...drawnIds]
      });
    }

    const commit = await data.commit(operations, COMMIT_TIMEOUT_MS);

    // Only touch local state once the write succeeded, so a failure leaves nothing half-applied.
    data.addWinners(winners);
    data.upsertPrize(updatedPrize);
    data.upsertHistory(historyEntry);
    for (const list of updatedLists) data.upsertList(list);

    // The server counts the entries it actually holds. A disagreement means this page's copy of
    // a list had already drifted from the stored one — someone else imported or edited it — so
    // the local copy is refreshed, once the winners are on their way to the screen rather than
    // before. Local state stays self-consistent either way: `kept` is what `entries` holds.
    if (listCountsDrifted(commit.results, updatedLists)) void data.reload('lists');

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

  async #runDelay(token: number): Promise<void> {
    const seconds = settings.current.preSelectionDelay;
    if (!seconds || seconds <= 0) {
      // "How far through the countdown are we" is 1 when there is no countdown: complete. The
      // overlay reads this to decide whether to render a number, and 0 would make it flash a
      // phantom "1" for a frame on a draw configured to have no delay at all.
      this.#delayProgress = 1;
      return;
    }

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

    // A draw that failed while the countdown was still running has already told the operator so.
    // Playing its punchline three seconds later, over an error message, is worse than silence.
    if (this.#runToken !== token) return;

    const endSound = settings.current.soundEndOfDelay;
    if (endSound && endSound !== 'none') {
      // The sting needs a beat of silence in front of it and a beat to land in behind it,
      // otherwise the reveal steps on its own drum roll. The stage is deliberately empty for
      // those 600 ms: nothing is loading, so nothing may claim to be.
      await sleep(100);
      void playSound(endSound, this.#sounds);
      await sleep(500);
    }

    // `#delayProgress` is deliberately NOT reset here. It is reset when a run starts, so that
    // "the countdown has finished" stays true for as long as the run lasts. Zeroing it at the end
    // of the delay made it briefly indistinguishable from "the countdown has not started", and
    // the overlay answered that by re-rendering the final number for a frame.
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
    // Abandons any timer still running for the previous draw, so it cannot move this store again.
    this.#runToken += 1;
    this.#phase = 'idle';
    this.#result = null;
    this.#revealedCount = 0;
    this.#error = null;
    this.#delayProgress = 0;
    this.#delayRemaining = 0;
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
        restoredLists.push({
          ...list,
          entries: [...list.entries, ...entries],
          metadata: { ...list.metadata, entryCount: list.entries.length + entries.length }
        });
        // Only the entries coming back, for the same reason the draw sends only ids: undo has no
        // business re-uploading every row of a list to put a handful of them back.
        operations.push({ collection: 'lists', operation: 'restoreEntries', id: listId, entries });
      }
    }

    let commit: BatchSaveResult;
    try {
      // Bounded for the same reason the draw's write is: an undo that never returns leaves the
      // operator with a button that appears to do nothing, and pressing it again is the one thing
      // they must not do while the first attempt may still be in flight.
      commit = await data.commit(operations, COMMIT_TIMEOUT_MS);
    } catch (error) {
      // "Nothing was changed" is true of a refused write and a guess about one that ran out of
      // time — the server may have deleted the winners after this page stopped listening.
      if (error instanceof ApiError && error.timedOut) {
        await this.#resync();
        toasts.error(
          'The server did not answer in time. The draw may or may not have been undone — ' +
            'check the Winners tab before trying again.'
        );
        return false;
      }

      toasts.fromError(error, 'Could not undo the draw. Nothing was changed.');
      return false;
    }

    data.removeWinners(new Set(action.winners.map((winner) => winner.winnerId)));
    data.removeHistory(action.historyId);
    if (restoredPrize) data.upsertPrize(restoredPrize);
    for (const list of restoredLists) data.upsertList(list);

    if (listCountsDrifted(commit.results, restoredLists)) void data.reload('lists');

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
 * Has this page's copy of a list fallen behind the stored one?
 *
 * Entry-level operations let the server count the entries it actually holds and report it back.
 * When that number differs from the count this page arrived at, the two copies of the list had
 * already diverged before the draw — someone else imported into it, or edited it — and only a
 * reload can settle it. Cheap to check, and it turns a silent disagreement into a refresh.
 */
function listCountsDrifted(results: BatchSaveResult['results'], expected: List[]): boolean {
  if (expected.length === 0) return false;

  const counts = new Map(expected.map((list) => [list.listId, list.entries.length]));
  return results.some(
    (entry) =>
      entry.collection === 'lists' &&
      typeof entry.entryCount === 'number' &&
      counts.has(entry.id) &&
      counts.get(entry.id) !== entry.entryCount
  );
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
