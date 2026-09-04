# SvelteKit Migration Plan

> **Superseded by `tasks/svelte5-migration-plan.md`**, which is the plan the migration actually
> followed. This sketch stops at Phase 1, predates the Alpine migration, the Google sign-in work
> and `src/css/responsive.css`, and proposes a `/svelte` staging directory that the finished
> migration did not use (the reasoning is in §3.1 of the newer plan). The Alpine → Svelte 5
> mapping table at the end is still a useful reference.

## Overview
Migrate Winner App from Alpine.js + vanilla JS to SvelteKit with Svelte 5 runes for robust reactive property binding and state management.

## Current → Target Architecture

| Layer | Current | Target |
|-------|---------|--------|
| Framework | Alpine.js 3.15 (CDN) | SvelteKit + Svelte 5 |
| State | 7 Alpine stores in HTML | Svelte runes + stores |
| Business Logic | Vanilla JS modules | TypeScript modules |
| Routing | Single page + tabs | SvelteKit routes |
| Build | Vite (vanilla) | Vite (SvelteKit) |
| Backend | Express (keep as-is) | Express (keep as-is) |

---

## Phase 1: Project Setup

### 1.1 Initialize SvelteKit Project
- [ ] Create new SvelteKit project alongside existing code
- [ ] Configure for SPA mode (adapter-static or adapter-node)
- [ ] Set up TypeScript strict mode
- [ ] Configure Vite proxy to Express backend (port 3001)
- [ ] Add Bootstrap 5.3.3 (keep existing styles)

### 1.2 Project Structure
```
src/
├── lib/
│   ├── stores/           # Svelte stores (runes)
│   │   ├── data.svelte.ts
│   │   ├── settings.svelte.ts
│   │   ├── setup.svelte.ts
│   │   ├── ui.svelte.ts
│   │   └── index.ts
│   ├── api/              # API client (from database.js)
│   │   └── client.ts
│   ├── services/         # Business logic
│   │   ├── winners.ts
│   │   ├── prizes.ts
│   │   ├── lists.ts
│   │   ├── selection.ts
│   │   └── settings.ts
│   ├── components/       # Reusable components
│   │   ├── modals/
│   │   ├── forms/
│   │   └── ui/
│   └── types/            # TypeScript interfaces
│       └── index.ts
├── routes/
│   ├── +layout.svelte    # Main layout with nav
│   ├── +page.svelte      # Public view (winner display)
│   └── manage/
│       ├── +page.svelte  # Management dashboard
│       ├── lists/
│       ├── prizes/
│       ├── winners/
│       ├── history/
│       └── settings/
└── app.html
```

---

## Phase 2: Core Infrastructure

### 2.1 TypeScript Types
- [ ] Define interfaces from existing data structures:
  - `List`, `ListEntry`, `Prize`, `Winner`, `HistoryEntry`
  - `Settings`, `SetupState`, `UIState`
- [ ] Extract from current Alpine store shapes in index.html

### 2.2 API Client (from database.js)
- [ ] Migrate `Database` module to TypeScript
- [ ] Keep: `saveToStore()`, `getFromStore()`, `deleteFromStore()`
- [ ] Keep: `batchSave()`, `batchFetch()`
- [ ] Keep: List sharding logic for large datasets
- [ ] Add proper TypeScript return types

### 2.3 Svelte Stores with Runes

**data.svelte.ts** (central data store):
```typescript
// Using Svelte 5 runes
let lists = $state<List[]>([]);
let prizes = $state<Prize[]>([]);
let winners = $state<Winner[]>([]);
let history = $state<HistoryEntry[]>([]);

// Derived state
let pendingWinners = $derived(winners.filter(w => !w.pickedUp));

export const dataStore = {
  get lists() { return lists; },
  get prizes() { return prizes; },
  // ... etc
  async loadAll() { /* ... */ }
};
```

**settings.svelte.ts**:
```typescript
let primaryColor = $state('#0d6efd');
let preventDuplicates = $state(false);
// ... with $effect for localStorage persistence
```

---

## Phase 3: Component Migration

### 3.1 Layout & Navigation
- [ ] Main layout with Bootstrap navbar
- [ ] Public/Management view toggle
- [ ] Tab navigation for management sections

### 3.2 Modal System
- [ ] `ConfirmModal.svelte` - confirmation dialogs
- [ ] `FormModal.svelte` - CRUD forms
- [ ] `ViewModal.svelte` - detail views
- [ ] Use Svelte's `{#if}` for show/hide (no x-show)

### 3.3 Core Views
- [ ] **Public View** - Winner display wheel/selection
- [ ] **Lists Management** - CRUD, import, entries
- [ ] **Prizes Management** - CRUD, images
- [ ] **Winners Management** - filters, pickup status
- [ ] **History View** - selection history
- [ ] **Settings** - all configuration options

### 3.4 Selection System
- [ ] Quick setup component with reactive bindings
- [ ] Selection animation/wheel
- [ ] Web Worker integration (keep existing)
- [ ] Sound effects integration

---

## Phase 4: Feature Parity Checklist

### Data Management
- [ ] List CRUD operations
- [ ] List entry management (add/remove/import)
- [ ] Prize CRUD with image upload
- [ ] Winner management with pickup tracking
- [ ] History logging

### Selection Features
- [ ] Quick setup (list + prize selection)
- [ ] Eligible entries calculation (reactive)
- [ ] Random selection with animation
- [ ] Duplicate prevention logic
- [ ] Multi-winner selection

### Settings
- [ ] Color theming (primary/secondary)
- [ ] Font selection
- [ ] Sound toggles
- [ ] SMS template
- [ ] All persisted to localStorage + backend

### Scanning (scan.html)
- [ ] QR/barcode scanner integration
- [ ] Winner lookup
- [ ] Family member search (MP integration)
- [ ] Pickup marking

---

## Phase 5: Migration Strategy

### Option A: Big Bang (Recommended for this size)
1. Build complete SvelteKit app in `/svelte` directory
2. Test thoroughly against same backend
3. Replace frontend entirely when ready
4. Keep Express backend unchanged

### Option B: Incremental
1. Embed Svelte components in existing HTML
2. Migrate section by section
3. More complex, longer timeline

---

## Phase 6: Testing & Deployment

- [ ] Test all CRUD operations
- [ ] Test selection with large lists (20k+ entries)
- [ ] Test localStorage persistence
- [ ] Test backend sync
- [ ] Update Docker build for SvelteKit
- [ ] Update vite.config.js

---

## Migration Mapping Reference

| Alpine.js | Svelte 5 |
|-----------|----------|
| `x-data="{ count: 0 }"` | `let count = $state(0)` |
| `x-text="count"` | `{count}` |
| `x-model="name"` | `bind:value={name}` |
| `x-show="visible"` | `{#if visible}` or `class:hidden` |
| `x-for="item in items"` | `{#each items as item}` |
| `@click="handler()"` | `onclick={handler}` |
| `Alpine.store('data')` | Svelte store module |
| `Alpine.effect()` | `$effect()` |
| `$persist()` | `$effect` + localStorage |
| `:class="{ active }"` | `class:active` |

---

## Estimated Scope

- **Types**: ~200 lines
- **Stores**: ~500 lines (replacing ~700 lines in HTML)
- **API Client**: ~300 lines (from database.js)
- **Components**: ~2000 lines (from index.html sections)
- **Routes**: ~500 lines
- **Services**: ~800 lines (from JS modules)

**Total**: ~4300 lines TypeScript/Svelte (well-structured) replacing ~6000+ lines (HTML + JS)

---

## Next Steps

1. [ ] Initialize SvelteKit project
2. [ ] Define TypeScript interfaces
3. [ ] Migrate API client
4. [ ] Create first store (settings) as proof of concept
5. [ ] Build one complete feature (e.g., Prizes CRUD) end-to-end
