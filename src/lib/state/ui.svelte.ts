/**
 * Cross-screen chrome: the progress overlay and the confirmation dialog.
 *
 * Both used to be DOM the modules reached into by id. Here they are state, and exactly one
 * component renders each.
 */

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Extra detail rendered under the message, as plain text lines. */
  details?: string[];
  confirmText?: string;
  cancelText?: string;
  /** `danger` for anything destructive, which is also what colours the confirm button. */
  variant?: 'danger' | 'primary' | 'warning';
}

class UiStore {
  #progressVisible = $state(false);
  #progressTitle = $state('Processing…');
  #progressText = $state('Please wait…');
  #progressPercent = $state(0);

  #confirm = $state<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);

  #shortcutsOpen = $state(false);

  // -------------------------------------------------------------------------------------------
  // Progress
  // -------------------------------------------------------------------------------------------

  get progressVisible(): boolean {
    return this.#progressVisible;
  }
  get progressTitle(): string {
    return this.#progressTitle;
  }
  get progressText(): string {
    return this.#progressText;
  }
  get progressPercent(): number {
    return this.#progressPercent;
  }

  startProgress(title: string, text = 'Please wait…'): void {
    this.#progressTitle = title;
    this.#progressText = text;
    this.#progressPercent = 0;
    this.#progressVisible = true;
  }

  updateProgress(percent: number, text?: string): void {
    this.#progressPercent = Math.max(0, Math.min(100, percent));
    if (text !== undefined) this.#progressText = text;
  }

  endProgress(): void {
    this.#progressVisible = false;
    this.#progressPercent = 0;
  }

  /** Run `work` behind the overlay, and always take the overlay down again. */
  async withProgress<T>(
    title: string,
    text: string,
    work: (report: (percent: number, text?: string) => void) => Promise<T>
  ): Promise<T> {
    this.startProgress(title, text);
    try {
      return await work((percent, message) => this.updateProgress(percent, message));
    } finally {
      this.endProgress();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Confirmation
  // -------------------------------------------------------------------------------------------

  get confirmRequest(): ConfirmRequest | null {
    return this.#confirm;
  }

  /**
   * Ask the operator, and resolve to their answer.
   *
   * A promise rather than a callback, so a caller reads top to bottom: `if (!(await
   * ui.confirm(...))) return;`. Callback-shaped confirmation is what left the old delete paths
   * with their cleanup split across two functions.
   */
  confirm(request: ConfirmRequest): Promise<boolean> {
    // A second request while one is open would strand the first promise unresolved.
    this.#confirm?.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.#confirm = { ...request, resolve };
    });
  }

  resolveConfirm(answer: boolean): void {
    const pending = this.#confirm;
    this.#confirm = null;
    pending?.resolve(answer);
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard help
  // -------------------------------------------------------------------------------------------

  get shortcutsOpen(): boolean {
    return this.#shortcutsOpen;
  }

  set shortcutsOpen(open: boolean) {
    this.#shortcutsOpen = open;
  }
}

export const ui = new UiStore();
