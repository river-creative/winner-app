/**
 * The prize-pickup scanner: what is on screen, what the camera is doing, and the lookups
 * between the two.
 *
 * The camera and the decoders live in `$lib/services/scan-engines.ts`; the searching lives in
 * `$lib/services/winner-search.ts`. This is the only piece that is reactive, and the only piece
 * that knows about views, dialogs and toasts.
 */

import * as api from '$lib/api/client';
import {
  createScanEngine,
  type CreateScanEngineOptions,
  type ScanEngine,
  type ScanEngineName
} from '$lib/services/scan-engines';
import {
  findByTicketCode,
  isTicketCode,
  search,
  type PersonResult,
  type PrizeRecord,
  type ScanLookup
} from '$lib/services/winner-search';
import type { Winner } from '$lib/types';
import { Persisted } from '$lib/utils/persisted.svelte';
import { data } from './data.svelte';
import { toasts } from './toasts.svelte';

export type ScanView = 'scanner' | 'results' | 'winner';

/**
 * Ignore repeat reads of the same value within this window — the loop-based engines emit the
 * same code many times a second while it stays in frame.
 */
const DEDUPE_WINDOW_MS = 1500;

/** The key the Alpine scanner wrote. Renaming it would forget every operator's name on upgrade. */
const OPERATOR_NAME_KEY = 'scan_operator_name';

class ScannerStore {
  // --- View -----------------------------------------------------------------------------------

  #view = $state<ScanView>('scanner');
  #winner = $state<Winner | null>(null);
  #prizes = $state<PrizeRecord[]>([]);

  #searchInput = $state('');
  #searchTerm = $state('');
  #searchResults = $state<PersonResult[]>([]);
  #isFamilySearch = $state(false);
  #scannedIdCard = $state('');
  #searching = $state(false);

  // --- Camera ---------------------------------------------------------------------------------

  #isScanning = $state(false);
  #isStarting = $state(false);
  #scanStatus = $state('Camera not started');
  #engineName = $state<ScanEngineName | ''>('');
  #engineReason = $state('');

  #engine: ScanEngine | null = null;
  #videoElement: HTMLVideoElement | null = null;

  /**
   * Bumped by every `stop()`, so a start still in flight knows it has been cancelled.
   *
   * Engine selection is slow — the native self-test alone allows 1.5 s, and the wasm module has
   * to load — and `stop()` cannot release an engine that does not exist yet. Without this,
   * navigating away mid-start brings the camera up *after* the page has gone and leaves the
   * indicator light on with nothing left to turn it off.
   */
  #startToken = 0;

  /** Dedupe and re-entrancy guards for the continuous decode stream. */
  #lastValue: string | null = null;
  #lastValueAt = 0;
  #processing = false;

  // --- Dialogs --------------------------------------------------------------------------------

  #noWinnerOpen = $state(false);
  #noWinnerTicketCode = $state('');
  #noResultsOpen = $state(false);
  #operatorOpen = $state(false);
  #operatorInput = $state('');

  #operatorName = new Persisted<string>(OPERATOR_NAME_KEY, '', { raw: true });

  // -------------------------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------------------------

  get view(): ScanView {
    return this.#view;
  }
  get winner(): Winner | null {
    return this.#winner;
  }
  get prizes(): PrizeRecord[] {
    return this.#prizes;
  }

  get searchInput(): string {
    return this.#searchInput;
  }
  set searchInput(value: string) {
    this.#searchInput = value;
  }
  get searchTerm(): string {
    return this.#searchTerm;
  }
  get searchResults(): PersonResult[] {
    return this.#searchResults;
  }
  get isFamilySearch(): boolean {
    return this.#isFamilySearch;
  }
  get scannedIdCard(): string {
    return this.#scannedIdCard;
  }
  /** True while a lookup is in flight, so the search button cannot be fired twice. */
  get searching(): boolean {
    return this.#searching;
  }

  get isScanning(): boolean {
    return this.#isScanning;
  }
  get isStarting(): boolean {
    return this.#isStarting;
  }
  get scanStatus(): string {
    return this.#scanStatus;
  }
  /** The active tier. `js` is the weak one, and the only one the UI warns about. */
  get engineName(): ScanEngineName | '' {
    return this.#engineName;
  }
  /** Why the enhanced scanner was unavailable — shown under the downgrade banner. */
  get engineReason(): string {
    return this.#engineReason;
  }

  get noWinnerOpen(): boolean {
    return this.#noWinnerOpen;
  }
  get noWinnerTicketCode(): string {
    return this.#noWinnerTicketCode;
  }
  get noResultsOpen(): boolean {
    return this.#noResultsOpen;
  }
  get operatorOpen(): boolean {
    return this.#operatorOpen;
  }
  get operatorInput(): string {
    return this.#operatorInput;
  }
  set operatorInput(value: string) {
    this.#operatorInput = value;
  }
  get operatorName(): string {
    return this.#operatorName.current;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  /**
   * The `<video>` the camera renders into.
   *
   * ScannerView hands it over as it mounts and takes it back as it unmounts, so the camera's
   * lifetime is tied to the element's by construction — it cannot be started without one, and
   * cannot outlive it.
   */
  attachVideo(element: HTMLVideoElement | null): void {
    this.#videoElement = element;
  }

  /**
   * Called when the scan page mounts.
   *
   * The store is a module singleton, so a second visit must not inherit the last visit's winner
   * card or a dialog left open. Nothing here reads reactive state — the caller runs it untracked.
   */
  reset(): void {
    this.#noWinnerOpen = false;
    this.#noWinnerTicketCode = '';
    this.#noResultsOpen = false;
    this.#clearResults();
    this.#view = 'scanner';
  }

  /** Called when the video element goes. Releases the camera; nothing else may hold it. */
  deactivate(): void {
    this.stop();
    this.#processing = false;
    this.#lastValue = null;
    this.#lastValueAt = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------------------------

  async start(options: CreateScanEngineOptions = {}): Promise<void> {
    if (this.#isScanning || this.#isStarting || this.#processing) return;

    const video = this.#videoElement;
    if (!video) {
      toasts.error('The scanner video element is not ready yet.');
      return;
    }

    // Reset dedupe state so re-scanning the same code after returning works instantly.
    this.#lastValue = null;
    this.#lastValueAt = 0;

    const token = ++this.#startToken;
    this.#isStarting = true;
    this.#scanStatus = 'Starting camera…';
    try {
      const engine = await createScanEngine(options);
      // Cancelled while the engine was being selected — release it instead of adopting it.
      if (token !== this.#startToken) {
        engine.stop();
        return;
      }

      this.#engine = engine;
      this.#engineName = engine.name;
      this.#engineReason = engine.downgradeReason;

      await engine.start(
        video,
        (value) => this.#handleDecode(value),
        (error) => this.#handleEngineFatal(error)
      );
      // `stop()` during `engine.start()` already released the stream (the engine has its own
      // guard for that); this only stops us reporting a camera that is no longer running.
      if (token !== this.#startToken) return;

      this.#setScanning(true);
    } catch (error) {
      // getUserMedia may already have handed us a stream before play() or a constraint failed.
      // Nothing else references the engine after this, so releasing it here is the only thing
      // that turns the camera indicator back off.
      this.#engine?.stop();
      this.#engine = null;
      this.#setScanning(false);
      console.error('Error starting scanner:', error);
      toasts.fromError(error, 'Failed to start the camera.');
    } finally {
      this.#isStarting = false;
    }
  }

  stop(): void {
    // Invalidates any start still selecting an engine — see #startToken.
    this.#startToken++;
    if (this.#engine) {
      this.#engine.stop();
      this.#engine = null;
    }
    this.#setScanning(false);
  }

  #setScanning(scanning: boolean): void {
    this.#isScanning = scanning;
    this.#scanStatus = scanning ? 'Scanning for QR codes…' : 'Camera stopped';
  }

  /**
   * An engine reported it cannot decode on this device (e.g. the native barcode service is
   * unavailable). Downgrade a tier rather than run a blind camera.
   */
  #handleEngineFatal(error: unknown): void {
    const failed = this.#engine?.name;
    console.warn(`Scanner engine "${failed}" unavailable, downgrading:`, error);
    this.stop();

    if (failed === 'native') void this.start({ skipNative: true });
    else toasts.error('The scanner is unavailable on this device.');
  }

  #handleDecode(value: string): void {
    if (!value || this.#processing) return;

    const now = Date.now();
    if (value === this.#lastValue && now - this.#lastValueAt < DEDUPE_WINDOW_MS) return;
    this.#lastValue = value;
    this.#lastValueAt = now;

    // Only act on values that look like ticket codes. A poster, a wifi QR or a parking sign in
    // frame is ignored silently — toasting every stray code would bury the real result.
    if (!isTicketCode(value)) return;

    void this.#processScan(value);
  }

  async #processScan(ticketCode: string): Promise<void> {
    this.#processing = true;
    // The camera is off for as long as a result is on screen: a code drifting through frame
    // must not replace the record the operator is reading.
    this.stop();

    try {
      const winners = await this.#loadWinners();
      const lookup = await findByTicketCode(ticketCode, winners);
      if (lookup) this.#showLookup(lookup);
      else this.#showNoWinner(ticketCode);
    } catch (error) {
      console.error('Error processing scan result:', error);
      toasts.fromError(error, 'Could not look that ticket code up.');
      // A transient lookup failure — resume scanning so the operator can simply try again.
      this.#processing = false;
      void this.start();
      return;
    }

    this.#processing = false;
  }

  /**
   * Winners, read fresh for every lookup rather than from the boot snapshot.
   *
   * Several pickup desks run at once. A cached list is how the same prize gets handed out
   * twice, so the extra round trip buys the one property this screen cannot do without.
   */
  async #loadWinners(): Promise<Winner[]> {
    return api.getAll('winners');
  }

  // -------------------------------------------------------------------------------------------
  // Searching
  // -------------------------------------------------------------------------------------------

  async performSearch(): Promise<void> {
    if (this.#searching) return;

    const input = this.#searchInput.trim();
    if (!input) {
      toasts.error('Enter a ticket code or a winner name to search.');
      return;
    }

    this.#searching = true;
    try {
      const winners = await this.#loadWinners();
      const outcome = await search(input, winners);
      this.#searchInput = '';

      switch (outcome.kind) {
        case 'person':
        case 'family':
          this.#showLookup(outcome);
          return;
        case 'people':
          this.#searchTerm = input;
          // Keep the term in the refine box so narrowing it is an edit, not a retype.
          this.#searchInput = input;
          this.#showPeople(outcome.people);
          return;
        case 'noWinner':
          this.#showNoWinner(outcome.ticketCode);
          return;
        case 'noResults':
          this.#searchTerm = input;
          this.#showNoResults();
          return;
      }
    } catch (error) {
      console.error('Error searching:', error);
      toasts.fromError(error, 'The search failed. Please try again.');
    } finally {
      this.#searching = false;
    }
  }

  /** Open one of the people the search listed. */
  selectResult(index: number): void {
    const result = this.#searchResults[index];
    if (!result) return;
    this.#winner = result.winner;
    this.#prizes = result.prizes.map((prize) => ({ ...prize }));
    this.#view = 'winner';
  }

  // -------------------------------------------------------------------------------------------
  // Pickup
  // -------------------------------------------------------------------------------------------

  /**
   * Mark one prize collected, optimistically.
   *
   * The badge flips first and is rolled back if the write fails, so what the operator sees is
   * only ever what the server will actually hold. `pickupTimestamp` is epoch milliseconds —
   * the old code wrote an ISO string here, which sorted and compared differently everywhere
   * else in the app.
   */
  async markPickedUp(index: number): Promise<void> {
    const prize = this.#prizes[index];
    if (!prize || prize.pickedUp) return;

    const previous = {
      pickedUp: prize.pickedUp,
      pickupTimestamp: prize.pickupTimestamp,
      pickupStation: prize.pickupStation
    };
    const patch = {
      pickedUp: true,
      pickupTimestamp: Date.now(),
      pickupStation: this.#operatorName.current
    };

    this.#prizes[index] = { ...prize, ...patch };
    // Keep the console's copy in step; it is the same winner record.
    data.patchWinner(prize.winnerId, patch);

    try {
      await api.update('winners', prize.winnerId, patch);
      toasts.success('Prize marked as picked up.');
    } catch (error) {
      this.#prizes[index] = { ...prize, ...previous };
      data.patchWinner(prize.winnerId, previous);
      console.error('Error marking as picked up:', error);
      toasts.fromError(error, 'Could not save the pickup. Nothing was changed.');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Navigation between the three views and the two alert dialogs
  // -------------------------------------------------------------------------------------------

  #showLookup(lookup: ScanLookup): void {
    if (lookup.kind === 'person') {
      this.#winner = lookup.person.winner;
      this.#prizes = lookup.person.prizes.map((prize) => ({ ...prize }));
      this.#isFamilySearch = false;
      this.#scannedIdCard = '';
      this.#view = 'winner';
    } else {
      this.#searchResults = lookup.people;
      this.#isFamilySearch = true;
      this.#scannedIdCard = lookup.scannedIdCard;
      this.#view = 'results';
    }
    this.stop();
  }

  #showPeople(people: PersonResult[]): void {
    this.#searchResults = people;
    this.#isFamilySearch = false;
    this.#scannedIdCard = '';
    this.#view = 'results';
    this.stop();
  }

  #showNoWinner(ticketCode: string): void {
    this.#noWinnerTicketCode = ticketCode;
    this.#noWinnerOpen = true;
    this.stop();
  }

  #showNoResults(): void {
    this.#noResultsOpen = true;
    this.stop();
  }

  /** The Back button on both result screens, and the one on both alert dialogs. */
  backToScanner(): void {
    this.#noWinnerOpen = false;
    this.#noWinnerTicketCode = '';
    this.#noResultsOpen = false;
    this.#clearResults();
    this.#view = 'scanner';
    void this.start();
  }

  #clearResults(): void {
    this.#winner = null;
    this.#prizes = [];
    this.#searchResults = [];
    this.#searchInput = '';
    this.#searchTerm = '';
    this.#isFamilySearch = false;
    this.#scannedIdCard = '';
  }

  // -------------------------------------------------------------------------------------------
  // Operator
  // -------------------------------------------------------------------------------------------

  openOperatorDialog(): void {
    this.#operatorInput = this.#operatorName.current;
    this.#operatorOpen = true;
  }

  /**
   * Save the operator's name. It is stamped onto every pickup as the station, so an empty one
   * is refused rather than silently recorded — which is why the dialog is not dismissible.
   */
  setOperatorName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.#operatorName.current = trimmed;
    this.#operatorOpen = false;
    this.#operatorInput = '';
  }
}

export const scanner = new ScannerStore();
