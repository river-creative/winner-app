import { generateId } from '$lib/utils/id';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** An optional single action, used for undo on destructive operations. */
  action?: ToastAction;
}

/** The durations the app has always used. An error stays longer because it has to be read. */
const DURATIONS: Record<ToastVariant, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 6000
};

/** A toast carrying an action needs long enough to actually click it. */
const ACTION_DURATION = 8000;

class ToastStore {
  #items = $state<Toast[]>([]);
  #timers = new Map<string, ReturnType<typeof setTimeout>>();

  get items(): Toast[] {
    return this.#items;
  }

  show(message: string, variant: ToastVariant = 'info', action?: ToastAction): string {
    const id = generateId(8);
    this.#items = [...this.#items, { id, message, variant, action }];

    const duration = action ? ACTION_DURATION : DURATIONS[variant];
    this.#timers.set(
      id,
      setTimeout(() => this.dismiss(id), duration)
    );

    return id;
  }

  success(message: string, action?: ToastAction): string {
    return this.show(message, 'success', action);
  }

  error(message: string): string {
    return this.show(message, 'error');
  }

  warning(message: string): string {
    return this.show(message, 'warning');
  }

  info(message: string): string {
    return this.show(message, 'info');
  }

  /** Show whatever an API rejection actually said, rather than a generic failure message. */
  fromError(error: unknown, fallback: string): string {
    const message = error instanceof Error && error.message ? error.message : fallback;
    return this.error(message);
  }

  dismiss(id: string): void {
    const timer = this.#timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.#timers.delete(id);
    }
    this.#items = this.#items.filter((toast) => toast.id !== id);
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#items = [];
  }
}

export const toasts = new ToastStore();
