# Alpine.js Migration Guide - Winner App

> **Historical.** Alpine.js was removed in September 2026 when the frontend moved to SvelteKit 2
> and Svelte 5 runes — see `tasks/svelte5-migration-plan.md`. Nothing here describes the running
> app any more. It is kept because its "Lessons Learned" section records *why* several patterns
> existed, and because the store shapes it documents are the reference for what the rune stores
> had to reproduce.


## Overview
Incremental migration from vanilla JavaScript to Alpine.js following [official Alpine.js documentation](https://alpinejs.dev/start-here). Priority: Forms & Inputs, then Modals & UI. No HTMX - keep existing fetch-based `database.js`.

---

## Migration Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Foundation Setup (Alpine.js + Persist plugin, Stores) | COMPLETED |
| Phase 1 | Forms & Inputs (Settings, Quick Setup) | COMPLETED |
| Phase 2 | Modals & UI (confirmModal, Lists grid, Prizes grid) | COMPLETED |
| Phase 3 | Data Tables (Winners, History) | COMPLETED |
| Phase 4 | View State & Progress Overlay | COMPLETED |

---

## What's Been Migrated

### Fully Alpine-Powered
- **Settings Tab**: All checkboxes, dropdowns, color pickers via `x-model` + `$store.settings`
- **Quick Setup Tab**: List checkboxes, prize dropdown, winners count via `x-for` + `$store.setup`
- **Lists Tab**: Card grid via `x-for` + `$store.lists`, selection state reactive
- **Prizes Tab**: Card grid via `x-for` + `$store.prizes`, selection state reactive
- **Winners Tab**: Table via `x-for` + `$store.winners.filtered`, SMS status helper
- **History Tab**: Table via `x-for` + `$store.history.sorted`, reactive stats
- **Confirmation Modal**: `Alpine.data('confirmModal')` component
- **UI State**: View persistence, tab tracking via `$store.ui`
- **View Toggle**: Public/Management interface switching via `x-show` + `$store.ui.view`
- **Progress Overlay**: Loading state via `x-show` + `x-text` + `:style` bindings

### Hybrid (Alpine + Vanilla JS)
- **Winner Filters**: Dropdowns populated by vanilla JS, values sync to Alpine store
- **CSV Upload**: Vanilla JS handles file parsing, could be migrated later
- **Winner Selection**: Core selection logic in vanilla JS, UI updates Alpine stores

### Remaining Vanilla JS (Working Fine)
- `database.js` - Backend communication (intentionally kept)
- `sounds.js` - Audio playback
- `keyboard-shortcuts.js` - Hotkeys
- `texting.js` - SMS integration
- `export.js` - CSV/backup export

---

## Lessons Learned

### 1. Script Loading Order (Critical)
**DO NOT use `defer`** on Alpine scripts when you need `alpine:init` to work correctly.

```html
<!-- CORRECT ORDER - No defer, persist first -->
<script src="https://cdn.jsdelivr.net/npm/@alpinejs/[email protected]/dist/cdn.min.js"></script>
<script>
  document.addEventListener('alpine:init', () => {
    // Register stores here
  });
</script>
<script src="https://cdn.jsdelivr.net/npm/[email protected]/dist/cdn.min.js"></script>
```

### 2. Store-Module Bridge Pattern
Connect Alpine stores to existing vanilla JS modules for backend persistence:

```javascript
// In alpine:init
Alpine.store('settings', {
  preventDuplicates: Alpine.$persist(false).as('settings_preventDuplicates'),
  // ... other settings
});

// In main.js after Alpine ready
function bridgeAlpineStores() {
  const settingsStore = Alpine.store('settings');
  settingsStore.save = async (key) => {
    await Settings.saveSingleSetting(key, settingsStore[key]);
  };
}
```

### 3. Wait for Alpine Before App Init
```javascript
function waitForAlpine() {
  return new Promise((resolve) => {
    if (window.Alpine && Alpine.store('settings')) {
      resolve();
      return;
    }
    const checkInterval = setInterval(() => {
      if (window.Alpine && Alpine.store('settings')) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 50);
  });
}

document.addEventListener('DOMContentLoaded', async function () {
  await waitForAlpine();
  await initializeApp();
  bridgeAlpineStores();
});
```

### 4. Store Update Pattern from Vanilla JS
When vanilla JS modules load data, update Alpine stores:

```javascript
// In app.js loadDataInBackground()
if (window.Alpine) {
  const listsStore = Alpine.store('lists');
  if (listsStore) listsStore.setItems(lists);
}
```

### 5. Global Access to Alpine Components
Make Alpine components accessible globally for vanilla JS integration:

```javascript
Alpine.data('confirmModal', () => ({
  // ... component logic
  init() {
    this.bsModal = bootstrap.Modal.getOrCreateInstance(this.$el);
    window.alpineConfirmModal = this; // Global access
  }
}));
```

### 6. Using x-for with Template
Always wrap `x-for` in a `<template>` tag:

```html
<template x-for="item in $store.items" :key="item.id">
  <div>...</div>
</template>
```

### 7. Click Event Propagation
Use `x-on:click.stop` to prevent event bubbling when cards are clickable:

```html
<div class="card" x-on:click="selectCard(id)">
  <button x-on:click.stop="deleteCard(id)">Delete</button>
</div>
```

### 8. Reactive Class Binding
Use `:class` with object syntax for conditional classes:

```html
<div :class="{ 'border-success border-2': $store.setup.selectedListIds.includes(list.listId) }">
```

### 9. Persistence with $persist
Use `.as()` for unique localStorage keys:

```javascript
Alpine.store('settings', {
  fontFamily: Alpine.$persist('Open Sans').as('settings_fontFamily'),
  primaryColor: Alpine.$persist('#6366f1').as('settings_primaryColor'),
});
```

### 10. Store Methods with setItems Pattern
Create setter methods for bulk updates:

```javascript
Alpine.store('lists', {
  items: [],
  setItems(items) {
    this.items = items || [];
  },
  addItem(item) {
    this.items.push(item);
  }
});
```

---

## Core Directives Reference

| Directive | Purpose | Example |
|-----------|---------|---------|
| `x-data` | Declares reactive data | `<div x-data="{ open: false }">` |
| `x-model` | Two-way binding | `<input x-model="search">` |
| `x-show` | Toggle visibility | `<div x-show="open">` |
| `x-for` | Loop arrays | `<template x-for="item in items">` |
| `x-on:click` | Event listener | `<button x-on:click="count++">` |
| `x-text` | Set text content | `<span x-text="count">` |
| `:class` | Bind classes | `:class="{ 'active': isActive }"` |
| `x-init` | Run on mount | `<div x-init="loadData()">` |
| `x-transition` | Animate show/hide | `<div x-show="open" x-transition>` |

---

## Implemented Stores

### Settings Store
```javascript
Alpine.store('settings', {
  preventDuplicates: Alpine.$persist(false).as('settings_preventDuplicates'),
  preventSamePrize: Alpine.$persist(false).as('settings_preventSamePrize'),
  hideEntryCounts: Alpine.$persist(false).as('settings_hideEntryCounts'),
  enableDebugLogs: Alpine.$persist(false).as('settings_enableDebugLogs'),
  enableWebhook: Alpine.$persist(false).as('settings_enableWebhook'),
  webhookUrl: Alpine.$persist('').as('settings_webhookUrl'),
  fontFamily: Alpine.$persist('Open Sans').as('settings_fontFamily'),
  backgroundColor: Alpine.$persist('#1a1a2e').as('settings_backgroundColor'),
  primaryColor: Alpine.$persist('#6366f1').as('settings_primaryColor'),
  secondaryColor: Alpine.$persist('#a855f7').as('settings_secondaryColor'),
  celebrationEffect: Alpine.$persist('confetti').as('settings_celebrationEffect'),

  async save(key) {
    // Bridged to Settings.saveSingleSetting()
  },

  async loadFromServer() {
    // Sync from backend to Alpine
  }
});
```

### Setup Store
```javascript
Alpine.store('setup', {
  selectedListIds: Alpine.$persist([]).as('setup_selectedListIds'),
  selectedPrizeId: Alpine.$persist('').as('setup_selectedPrizeId'),
  winnersCount: Alpine.$persist(1).as('setup_winnersCount'),

  get canStart() {
    return this.selectedListIds.length > 0 && this.selectedPrizeId;
  },

  toggleList(listId) {
    const idx = this.selectedListIds.indexOf(listId);
    if (idx > -1) {
      this.selectedListIds.splice(idx, 1);
    } else {
      this.selectedListIds.push(listId);
    }
  },

  clearSelections() {
    this.selectedListIds = [];
    this.selectedPrizeId = '';
    this.winnersCount = 1;
  }
});
```

### UI Store
```javascript
Alpine.store('ui', {
  view: Alpine.$persist('public').as('ui_view'),
  currentTab: Alpine.$persist('quicksetup').as('ui_currentTab'),

  // Progress overlay state (Phase 4)
  showProgress: false,
  progressTitle: 'Processing...',
  progressText: 'Please wait...',
  progressPercent: 0,

  init() {
    // Restore saved tab when returning to management view
    const restoreTab = () => {
      if (this.view === 'management' && this.currentTab) {
        const tabTrigger = document.querySelector(`[data-bs-target="#${this.currentTab}"]`);
        if (tabTrigger && window.bootstrap) {
          new bootstrap.Tab(tabTrigger).show();
        }
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', restoreTab);
    } else {
      setTimeout(restoreTab, 150);
    }
  },

  // View is now controlled by Alpine directives on elements:
  // <div id="publicInterface" x-show="$store.ui.view === 'public'" x-cloak>
  // <div id="managementInterface" :class="{ 'active': $store.ui.view === 'management' }" x-cloak>
  showManagement() {
    this.view = 'management';
  },

  showPublic() {
    this.view = 'public';
  },

  setTab(tabId) {
    this.currentTab = tabId;
  },

  // Progress overlay methods (Phase 4)
  startProgress(title, text) {
    this.progressTitle = title || 'Processing...';
    this.progressText = text || 'Please wait...';
    this.progressPercent = 0;
    this.showProgress = true;
  },

  updateProgressState(percent, text) {
    this.progressPercent = percent;
    if (text) this.progressText = text;
  },

  endProgress() {
    this.showProgress = false;
  }
});
```

### Data Stores
```javascript
Alpine.store('lists', {
  items: [],
  setItems(items) { this.items = items || []; }
});

Alpine.store('prizes', {
  items: [],
  setItems(items) { this.items = items || []; }
});

Alpine.store('winners', {
  items: [],
  filters: { prize: '', list: '', batch: '', date: '' },

  get filtered() {
    return this.items.filter(w => {
      if (this.filters.prize && w.prizeId !== this.filters.prize) return false;
      if (this.filters.list && w.listId !== this.filters.list) return false;
      return true;
    });
  },

  setItems(items) { this.items = items || []; }
});
```

---

## Phase 3: Winners & History Tables

### 3.1 Add History Store
```javascript
Alpine.store('history', {
  items: [],

  get sorted() {
    return [...this.items].sort((a, b) => b.timestamp - a.timestamp);
  },

  setItems(items) {
    this.items = items || [];
  }
});
```

### 3.2 Winners Table Implementation

**Winner data structure:**
```javascript
{
  winnerId: 'uuid',
  displayName: 'John Doe',
  prize: 'Gift Card',
  prizeId: 'prize-uuid',
  listId: 'list-uuid',
  listName: 'Event Attendees',
  timestamp: 1702400000000,
  pickedUp: false,
  entryId: 'entry-uuid',
  orderId: 'ORDER-123',
  data: { /* original entry data */ },
  sms: { status: 'delivered', error: null },
  historyId: 'history-uuid'
}
```

**Filter dropdowns with x-for:**
```html
<select x-model="$store.winners.filters.prize" @change="filterWinners()">
  <option value="">All Prizes</option>
  <template x-for="prize in uniquePrizes" :key="prize">
    <option :value="prize" x-text="prize"></option>
  </template>
</select>
```

**Table body with x-for:**
```html
<tbody id="winnersTableBody" x-data>
  <template x-for="winner in $store.winners.filtered" :key="winner.winnerId">
    <tr>
      <td><!-- QR button --></td>
      <td><span class="badge bg-primary" x-text="winner.orderId || winner.entryId || 'N/A'"></span></td>
      <td x-text="winner.displayName"></td>
      <td x-text="winner.prize"></td>
      <td x-text="new Date(winner.timestamp).toLocaleDateString()"></td>
      <td x-text="winner.listName || 'Unknown'"></td>
      <td>
        <span :class="winner.pickedUp ? 'badge bg-success' : 'badge bg-warning'">
          <i :class="winner.pickedUp ? 'bi bi-check-circle-fill' : 'bi bi-clock'"></i>
          <span x-text="winner.pickedUp ? ' Picked up' : ' Pending'"></span>
        </span>
      </td>
      <td><!-- SMS status badge --></td>
      <td><!-- Action buttons --></td>
    </tr>
  </template>

  <!-- Empty state -->
  <tr x-show="$store.winners.filtered.length === 0">
    <td colspan="9" class="text-center text-muted">No winners match the current filters.</td>
  </tr>
</tbody>
```

### 3.3 History Table Implementation

**History data structure:**
```javascript
{
  historyId: 'uuid',
  timestamp: 1702400000000,
  listName: 'Event Attendees',
  prize: 'Gift Card',
  winners: [
    { winnerId: 'uuid', displayName: 'John Doe' },
    { winnerId: 'uuid', displayName: 'Jane Smith' }
  ]
}
```

**Table body with x-for:**
```html
<tbody id="historyTableBody" x-data>
  <template x-for="entry in $store.history.sorted" :key="entry.historyId">
    <tr>
      <td x-text="new Date(entry.timestamp).toLocaleDateString()"></td>
      <td x-text="entry.listName || 'Unknown'"></td>
      <td x-text="entry.prize"></td>
      <td x-text="entry.winners.length"></td>
      <td x-text="entry.winners.map(w => w.displayName).join(', ')"></td>
      <td>
        <button class="btn btn-sm btn-outline-danger"
                x-on:click="deleteHistoryConfirm(entry.historyId)">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>
  </template>

  <!-- Empty state -->
  <tr x-show="$store.history.items.length === 0">
    <td colspan="6" class="text-center text-muted">No selection history yet.</td>
  </tr>
</tbody>
```

### 3.4 History Stats with Alpine
```html
<div class="history-stats" x-data>
  <div class="stat-card">
    <div class="stat-number" x-text="$store.history.items.length">0</div>
    <div class="stat-label">Total Selections</div>
  </div>
  <div class="stat-card">
    <div class="stat-number" x-text="$store.winners.items.length">0</div>
    <div class="stat-label">Total Winners</div>
  </div>
  <!-- More stats... -->
</div>
```

---

## Phase 4: View State & Progress Overlay

### 4.1 View Toggle with Alpine Directives

**Before (vanilla JS in app.js):**
```javascript
document.getElementById('publicInterface').style.display = 'none';
document.getElementById('managementInterface').classList.add('active');
```

**After (Alpine directives in HTML):**
```html
<div id="publicInterface" x-show="$store.ui.view === 'public'" x-cloak>
<div id="managementInterface" :class="{ 'active': $store.ui.view === 'management' }" x-cloak>
```

**Store methods simplified:**
```javascript
showManagement() {
  this.view = 'management';  // Alpine handles DOM automatically
},
showPublic() {
  this.view = 'public';
}
```

### 4.2 Progress Overlay Migration

**Before (vanilla JS in ui.js):**
```javascript
function showProgress(title, text) {
  document.getElementById('progressTitle').textContent = title;
  document.getElementById('progressText').textContent = text;
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressOverlay').classList.remove('d-none');
}
```

**After (Alpine-controlled HTML):**
```html
<div id="progressOverlay" class="progress-overlay" x-show="$store.ui.showProgress" x-cloak>
  <div class="progress-content">
    <h5 x-text="$store.ui.progressTitle">Processing...</h5>
    <div class="progress-bar-custom">
      <div class="progress-fill" :style="{ width: $store.ui.progressPercent + '%' }"></div>
    </div>
    <p x-text="$store.ui.progressText">Please wait...</p>
  </div>
</div>
```

**Updated ui.js with Alpine bridge:**
```javascript
function showProgress(title, text) {
  if (window.Alpine && Alpine.store('ui')) {
    Alpine.store('ui').startProgress(title, text);
  } else {
    // Fallback for backward compatibility
    document.getElementById('progressOverlay').classList.remove('d-none');
  }
}
```

### 4.3 Inline onclick to @click Migration

**Before:**
```html
<a href="#" onclick="document.getElementById('uploadListModalBtn').click(); return false;">
```

**After:**
```html
<a href="#" @click.prevent="document.getElementById('uploadListModalBtn')?.click()">
```

### 4.4 Key Patterns from Phase 4

1. **x-cloak**: Prevents flash of unstyled content on page load
2. **x-show vs :class**: Use `x-show` for visibility, `:class` for CSS state
3. **Alpine store bridge**: Check `window.Alpine && Alpine.store('ui')` before using stores
4. **@click.prevent**: Cleaner than `onclick="...; return false;"`

---

## Best Practices Summary

1. **Keep components focused** - Don't cram too much logic into single x-data blocks
2. **Use stores for shared state** - `$store` for cross-component data, `x-data` for component-local
3. **Progressive enhancement** - Alpine enhances HTML, doesn't replace it
4. **Move complex logic to methods** - Avoid inline complex expressions
5. **Use computed getters** - `get filteredItems() { return this.items.filter(...) }`
6. **Don't build full SPAs** - Alpine is for interactive components, not routing/complex state
7. **Bridge to existing modules** - Keep database.js, sounds.js, etc. working alongside Alpine

---

## EventManager Coexistence

- **Keep EventManager** for: keyboard shortcuts, Web Worker communication, complex delegation
- **Use Alpine** for: click handlers (`x-on:click`), form bindings (`x-model`), visibility (`x-show`)
- **Gradual removal**: Remove EventManager registrations as sections migrate

---

## Sources

- [Alpine.js Official Documentation](https://alpinejs.dev/start-here)
- [Alpine.store() - Global State](https://alpinejs.dev/globals/alpine-store)
- [Alpine.data() - Reusable Components](https://alpinejs.dev/globals/alpine-data)
- [Alpine Persist Plugin](https://alpinejs.dev/plugins/persist)
- [Alpine.js State Management](https://alpinejs.dev/essentials/state)
