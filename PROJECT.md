# 🎉 River Winner App - Comprehensive Project Summary

## 📋 Project Overview
**River Winner App** is a professional Progressive Web Application (PWA) for random winner selection at events, presentations, and contests. Originally built with Firebase, it has been refactored to use a local Node.js/Express backend with JSON file storage. The app is containerized with Docker and deployed at tickets.revival.com/win.

## 🏗️ Architecture & Technology Stack

### Frontend Framework
- **SvelteKit 2 + Svelte 5 (runes)** — the whole UI. State lives in rune classes under
  `src/lib/state/*.svelte.ts`; there is no Alpine.js and no Bootstrap JavaScript.
- **`adapter-static` in SPA mode** — the build emits `dist/`, which the existing Express server
  serves exactly as it served the old Vite output. `ssr = false` is set once, in
  `src/routes/+layout.ts`: every screen depends on browser-only APIs (BarcodeDetector,
  getUserMedia, AudioContext, Fullscreen, canvas, localStorage), so server rendering would buy
  nothing and cost a class of hydration bugs.
- **Bootstrap 5.3 CSS** for the design system, from npm rather than a CDN. Its JavaScript is
  deliberately absent: modals are native `<dialog>` elements, the tab strip is real routing, and
  dropdowns are Svelte components. That is what allowed two global monkeypatches the old page
  carried — a patched `JSON.parse` and a wrapped `document.body.getAttribute` — to be deleted
  rather than ported.
- **TypeScript strict**, with `noUncheckedIndexedAccess`, checked by `svelte-check`.
- **No service worker.** It and the manifest link were removed on purpose in 34b8b7b because the
  cached shell kept serving a stale build; the backend still sends `no-store` on every HTML
  response. `public/manifest.json` is left orphaned rather than re-linked.

### Routing
Every management tab is a real route, so the back button, deep links and refresh all work:

| Path | Screen |
|---|---|
| `/` | Setup (list, prize and reveal configuration) |
| `/lists` · `/prizes` · `/templates` | Data management |
| `/winners` · `/history` | Records |
| `/queries` | Ministry Platform saved queries |
| `/settings` | Theme, display, webhook, sounds |
| `/present` | The public draw view |
| `/scan` | Prize-pickup scanner |
| `/login` · `/conditions` | Public pages, outside the authenticated group |

`/win/*` is legacy. The API still answers there; **page** requests 301 to the canonical path,
because a client-side router is compiled for exactly one base path and would 404 under a second
prefix.

### Backend & Storage
- **Node.js/Express** backend server
- **JSON file storage** in /app/data directory
- **Batch API operations** for efficient data sync
- **Docker containerization** with multi-stage builds
- **Nginx reverse proxy** at /win path

### Key Technologies
- **QR Code Scanner** for prize pickup tracking
- **Web Workers** for performance-intensive operations
- **Canvas API** for animations and visual effects
- **Web Audio API** for sound effects
- **Fullscreen API** for presentation mode

## 🎯 Core Features

### 1. **List Management**
- CSV file upload supporting unlimited entries (tested up to 20,000)
- Flexible name template configuration
- Data preview before import
- Support for multiple active lists

### 2. **Winner Selection Engine**
- Fair random selection algorithm
- Multiple selection modes:
  - All-at-once selection
  - Sequential reveal with delays
  - Individual selection
- Pre-selection delay options with visual effects
- Customizable winner display animations

### 3. **Prize Management**
- Create and manage multiple prizes
- Track prize quantities and availability
- Automatic pickup status tracking
- QR code generation for winner tickets

### 4. **Visual Effects & Animations**
- Confetti celebrations
- Gold coin burst effects
- Particle animations
- Time machine effects
- Swirl animations
- Countdown timers with multiple styles

### 5. **Sound System**
- Built-in sound effects (drum roll, applause, fanfare)
- Custom sound upload capability
- Configurable sound triggers for different events
- Sound testing interface

### 6. **Theme & Customization**
- Light/Dark mode toggle
- 6 pre-built theme presets
- Custom color configuration
- Multiple font options
- Background customization (gradient/solid/image)

### 7. **Data Management**
- Complete backup/restore functionality
- CSV export for winners
- Cloud backup with Firebase
- Offline-first with background sync
- Automatic data persistence

### 8. **QR Scanner Module** (`/scan`)
- Camera-based QR code scanning
- Manual ticket code entry
- Prize pickup tracking
- Real-time status updates
- Mobile-optimized interface

### 9. **SMS Texting System**
- Bulk SMS messaging to all winners
- Rate limiting compliance (200 requests/minute)
- Message personalization with variables
- Batch processing with progress indicators
- Integration with EZ Texting API via Netlify Functions

## 📁 Project Structure

```
winner-app/
├── public/                    # Static assets, copied into dist by the build
│   ├── favicon.ico / favicon.png
│   ├── icons/
│   ├── sounds/                # The six built-in sound files
│   └── manifest.json          # Orphaned on purpose — see "No service worker"
├── src/
│   ├── app.html               # The SPA shell
│   ├── css/
│   │   ├── styles.css         # The design system. NO viewport media queries live here.
│   │   └── responsive.css     # Every viewport-width rule, loaded last so it wins ties.
│   ├── lib/
│   │   ├── api/client.ts      # The only place that talks to the Express API
│   │   ├── components/        # Shared UI + one folder per feature
│   │   ├── constants/         # Settings defaults, select options, sort options
│   │   ├── services/          # Pure logic: eligibility, shuffle, csv, export, sounds, texting
│   │   ├── state/*.svelte.ts  # Rune stores: settings, data, setup, draw, filters, ui, session
│   │   ├── types/index.ts     # The domain model — every stored field name
│   │   ├── utils/             # csv, format, id, persisted
│   │   └── workers/           # The selection worker
│   └── routes/
│       ├── +layout.svelte     # Toasts, dialogs, progress, session overlay
│       ├── (app)/             # Everything behind sign-in; boots settings + data
│       │   ├── (console)/     # The management screens, with header and nav
│       │   ├── present/       # The public draw view
│       │   └── scan/          # The prize-pickup scanner
│       ├── login/ conditions/ # Public pages — never make an authenticated call
│       └── +error.svelte
├── backend/                   # Express API (TypeScript, compiled in place)
├── data/                      # JSON collections + uploads (bind-mounted volume)
├── docs/ · tasks/             # Documentation and plans
├── svelte.config.js · vite.config.ts · tsconfig.json · eslint.config.js
└── Dockerfile · docker-compose.yml · deploy.sh
```

### The two stylesheets — read this before adding CSS
`src/css/responsive.css` owns **every** `@media (max-width: …)` rule in the app and loads after
`styles.css` so it wins ties at equal specificity. `styles.css` keeps the container queries, the
print rules and the `:has()`-based winners-grid brackets. Putting a viewport rule anywhere else —
including a component's `<style>` block — is how the tab strip ended up with a scroll rule that
never took effect. Breakpoints follow Bootstrap 5 exactly.

## 🚀 Key Implementation Highlights

### Local-First Architecture
- **Immediate response**: UI updates happen instantly without waiting for network
- **Local storage**: All data stored in local JSON files
- **Offline capability**: Full functionality without internet connection
- **Fire-and-forget operations**: Non-blocking database writes

### Performance Optimizations
- **Web Workers**: CPU-intensive operations run in background threads
- **Lazy loading**: Resources loaded on-demand
- **Efficient caching**: Service Worker with intelligent cache strategies
- **Debounced auto-save**: Settings saved efficiently without performance impact

### Security & Reliability
- **No sensitive data exposure**: All data stored locally or in user's Firebase
- **Input validation**: Comprehensive CSV validation and sanitization
- **Error handling**: Graceful error recovery throughout
- **Data integrity**: Automatic backups and restore points

### Authentication

Two sign-in paths, both ending in the same `session` cookie (HttpOnly, SameSite=Lax, 3 days,
persisted to `data/sessions.json` so a deploy does not sign everyone out):

1. **Google sign-in (primary)** — Google Identity Services, ID-token only: no client secret, no
   code exchange, no API scopes. The browser gets an ID token and POSTs it to
   `/api/auth/google`, which verifies it against Google's signing keys and the configured
   audience, then requires the `hd` claim to match `GOOGLE_HOSTED_DOMAIN`, the email to be
   verified, and the address itself to sit inside that domain. Any `@revival.com` Workspace
   account can sign in — there is no per-user allow-list.
2. **Admin credentials (backdoor)** — `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`, behind a
   disclosure on the login page. Retained on purpose: prize-scanner volunteers have no Workspace
   account, and it is the way back in if Google is unreachable. Compared in constant time and
   rate-limited to 10 attempts/minute in production.

Both endpoints are unauthenticated by definition and carry the strict rate limiter.
`GOOGLE_CLIENT_ID`, `GOOGLE_HOSTED_DOMAIN`, `ADMIN_USERNAME` and `ADMIN_PASSWORD` are **all
required** — the server validates them at startup and refuses to boot if any is missing, rather
than failing at the first sign-in attempt.

**Google Cloud Console:** the client ID must list this app's origins under *Authorized
JavaScript origins* (`https://win.revival.com`, `http://localhost:3000`,
`http://localhost:3001`). Without them the button renders but no sign-in ever succeeds; the
admin path is unaffected. *Authorized redirect URIs* are not used by this flow and should stay
empty, and **no client secret is needed** — the server verifies ID tokens and never exchanges
an authorization code.

#### Two response headers Google sign-in depends on — do not revert them

`helmetMiddleware` in `backend/middleware.ts` overrides two of helmet's defaults. Both
overrides are load-bearing, and removing either breaks sign-in in a way that does **not** look
like our bug:

| Header | helmet default | Required | What breaks |
|---|---|---|---|
| `Referrer-Policy` | `no-referrer` | `strict-origin-when-cross-origin` | GIS reads the embedding origin from the `Referer` header on its `/gsi/button` iframe request. With none, it rejects **every** origin |
| `Cross-Origin-Opener-Policy` | `same-origin` | `same-origin-allow-popups` | Severs `window.opener` when the sign-in popup opens, so the credential can never return to the page |

The referrer failure is the dangerous one, because the browser console reports:

```
[GSI_LOGGER]: The given origin is not allowed for the given client ID.
```

That message points at Google Cloud Console, where nothing is wrong. On 2026-09-03 it cost
hours: the origin was re-added, propagation was waited out, and an entirely new OAuth client
was created — none of which could have helped, because the request never carried an origin for
Google to check.

**How to tell in one command.** Compare against a page that works with the same client ID —
RiverRSVP at `mp.revival.com` serves the identical client:

```bash
curl -sI https://win.revival.com/login      | grep -i 'referrer-policy\|cross-origin-opener'
curl -sI https://mp.revival.com/rsvp/login  | grep -i 'referrer-policy'
```

Differing headers mean the headers are the cause, not the console. Note that `curl`-ing
`/gsi/button` directly proves nothing — it returns 400 even for a known-good origin, because it
omits parameters GIS sends. Validate any probe against a known-good case before trusting a
negative.

## 🎨 User Interface Highlights

### Public Selection Interface
- **Glass morphism design**: Modern translucent UI elements
- **Responsive layout**: Adapts to all screen sizes
- **Fullscreen mode**: Optimized for projectors and large displays
- **Real-time updates**: Live information cards

### Management Interface
- **Tabbed navigation**: Organized feature sections
- **Bootstrap components**: Professional, consistent UI
- **Dark mode support**: Complete theme implementation
- **Mobile-friendly**: Touch-optimized controls

## 📱 PWA Features

### Installation
- **App-like experience**: Installable on all platforms
- **Offline functionality**: Complete feature set without internet
- **Auto-updates**: Service Worker manages updates seamlessly
- **Native feel**: Standalone window, custom icon

### Service Worker
- **Smart caching**: Static files cached, dynamic content updated
- **Background sync**: Data syncs when connection restored
- **Push notifications**: Ready for future notification features
- **Network resilience**: Graceful degradation when offline

## 🔧 Development & Deployment

### Development
```bash
pnpm install       # Install dependencies
pnpm dev:all       # Backend on 3001 and the Vite dev server on 3000, together
pnpm dev           # Frontend only (proxies /api and /uploads to the backend)
pnpm dev:server    # Backend only

pnpm check         # svelte-check: types and accessibility
pnpm lint          # Prettier + ESLint
pnpm test          # Vitest
pnpm build         # vite build → dist/, then tsc → backend/*.js
```

To run a second checkout alongside the first, set `PORT` in its `.env` and start Vite with
`BACKEND_PORT=<that port> pnpm dev --port <free port>`. Pick a web port already in the CORS
allowlist in `backend/middleware.ts` (5173 or 6001), or the browser's `Origin` header will be
rejected.

### Deployment
`deploy.sh` rsyncs the tree to `rmi-services:/srv/winner-app` over an IAP tunnel and rebuilds the
container there; `dist/` is built inside the image and never uploaded. The frontend migration did
not change any of this — `pnpm build` still emits `dist/`, and the Dockerfile still copies it.

The static hosting the app once targeted (GitHub Pages, Netlify, Firebase) is no longer an option:
the Express backend owns sessions, the JSON collections, uploads and the Ministry Platform and
texting integrations.

## 📊 Testing Pages
- **test-firestore.html**: Basic Firestore operations testing
- **test-firestore-persistent.html**: Persistent data testing with Firebase console integration
- **test-upload-performance.html**: Performance comparison between local-first and traditional approaches

## 🎯 Use Cases
1. **Corporate Events**: Employee recognition and prize draws
2. **Conferences**: Attendee giveaways and raffles
3. **Educational**: Student selection for activities
4. **Marketing**: Customer loyalty programs
5. **Community Events**: Fair participant selection

## 🔮 Future Enhancements Potential
- Multi-language support
- Advanced analytics dashboard
- Team/group selection modes
- API integration for external data sources
- Real-time collaboration features
- Mobile native apps (iOS/Android)

## 📝 Module Summaries

### Core Modules

#### **firestore.js** - Database Management  
Core database service that replaced Firebase with a local Express backend. Provides REST API calls to the server for data operations, batch operations for efficiency, and automatic path detection for /win subdirectory deployment.

#### **ui.js** - User Interface Utilities
Essential UI helper functions including toast notifications, progress indicators, confirmation modals, and form population. Manages quick selection dropdowns and maintains UI synchronization.

#### **lists.js** - List Management
Manages participant list operations including loading, viewing, and deleting lists. Provides backward compatibility for list data structures and handles display name formatting using configurable templates.

#### **prizes.js** - Prize Management
Handles all prize-related operations including adding, editing, and deleting prizes. Manages prize quantities, descriptions, and availability status with automatic UI updates.

#### **winners.js** - Winner Management & Filtering
Comprehensive winner management system handling loading, filtering, and displaying winner records. Provides advanced filtering, manages pickup status, supports QR code generation, and includes undo functionality.

#### **selection.js** - Winner Selection Logic
Core winner selection engine handling random selection using web workers. Supports multiple selection modes, implements pre-selection delays with visual effects, and manages winner display with sound integration.

#### **settings.js** - Application Settings
Manages comprehensive application settings including theme customization, selection preferences, sound configuration, and webhook notifications. Provides efficient auto-save functionality with debounced updates.

#### **sounds.js** - Sound Effects Management
Handles audio file management including built-in sounds and custom uploads. Manages sound dropdowns, provides testing functionality, and supports database storage for custom sounds.

#### **animations.js** - Visual Animations
Provides various visual effects including particle animations, confetti celebrations, time machine effects, and swirl animations. Handles canvas-based animations with theme color integration.

#### **csv-parser.js** - CSV File Processing
Handles CSV file upload and processing with comprehensive data validation. Supports flexible name and info field configuration using template systems with configurable display formats.

#### **export.js** - Data Export & Backup
Manages data export and backup operations including CSV winner exports, complete data backup in JSON format, and cloud-based backup storage with restore capabilities.

#### **qr-scanner.js** - QR Code Scanning
Implements QR code scanning functionality for winner pickup tracking. Provides real-time QR recognition, winner lookup by ticket codes, and integrates with the winner database.

## 🎲 Random Selection Algorithm Details

### **Winner Selection Process**
The app uses a sophisticated randomization system to ensure fair and truly random winner selection:

#### **Data Handling for Large Lists**
- Lists of any size are stored as single JSON objects without sharding
- The selection algorithm receives the ENTIRE list regardless of size (tested up to 20,000 entries)
- No artificial limits on list size due to local storage

#### **Randomization Algorithm (Updated)**
Located in `selection.js`, the algorithm uses:

1. **Cryptographically Secure Random Numbers**
   - Uses `crypto.getRandomValues()` when available for true randomness
   - Falls back to `Math.random()` only if crypto API is unavailable
   - Provides uniform distribution across the entire range

2. **Fisher-Yates Shuffle Algorithm**
   - Industry-standard shuffling algorithm
   - Guarantees each entry has exactly equal probability
   - Time complexity: O(n) - efficient even for large lists

3. **Triple Shuffle Technique**
   - **First shuffle**: Randomizes the entire list thoroughly
   - **Second shuffle**: Additional randomization to break any residual patterns
   - **Third shuffle**: Randomizes the display order of selected winners
   - This eliminates clustering issues where adjacent entries (like family members) were winning together

#### **Previous Issues (Fixed)**
The original algorithm had several problems:
- Used `Math.sin()` based pseudo-random generator which created predictable patterns
- Selected winners sequentially without proper shuffling
- Entries near each other in the CSV remained clustered
- This caused the "family clustering" issue where adjacent CSV entries won multiple prizes

#### **Current Guarantees**
- ✅ Every single entry from the uploaded CSV is included
- ✅ Lists of any size are fully supported without sharding
- ✅ Each entry has an equal, independent probability of selection
- ✅ No clustering or pattern biases
- ✅ Cryptographically secure randomness when available

#### **texting.js** - SMS Integration
Handles SMS messaging through EZ Texting API. Sends winner notifications, tracks delivery status, and provides batch SMS operations for multiple winners.

#### **reports.js** - Giveaway Reports Integration
Integrates with the Giveaway Reports API to import attendee lists directly. Fetches CSV data from reports, parses and imports as lists, and allows field configuration through CSV dialog.

## 🚀 Recent Updates (August 2025)

### Infrastructure Changes
- **Removed Firebase dependency** - Migrated from Firebase to local Express backend
- **Docker containerization** - Multi-stage Docker build for production deployment
- **Route migration** - Changed all routes from `/testwin` to `/win`
- **Nginx configuration** - Updated reverse proxy settings for new routing

### Performance Optimizations
- **Batch operations** - Reduced database queries by batching operations
- **Settings optimization** - Fixed issue where selecting lists/prizes triggered 20+ settings saves
- **Single setting updates** - Changed from `saveSettings()` to `saveSingleSetting()` for efficiency

### Feature Additions
- **Giveaway Reports integration** - Added "Add from Report" button to import attendee lists
- **CSV field configuration** - Report imports now use CSV configuration dialog
- **Order ID display** - Winners table now shows Order ID instead of internal winner ID

### Bug Fixes
- **Undo functionality** - Fixed race condition where prize selection was cleared after undo
- **SMS status tracking** - Corrected field names for proper status checking
- **Prize quantity restoration** - Ensured quantities are properly restored during undo
- **Entry count display** - Fixed issue where lists showing 0 entries would fall back to cached count
- **UI refresh issues** - Added proper async/await to ensure UI updates complete before displaying
- **Single vs Multiple list selection** - Fixed bug where single list selection was creating duplicate lists

### UI/UX Improvements (August 16, 2025)
- **Lists tab redesign** - Changed from checkbox selection to clickable cards that turn green when selected
- **Card-based selection** - Lists now use same selection UI pattern as Prizes page for consistency
- **Public View refresh** - Added comprehensive data refresh when clicking "Public View" to sync all settings
- **Selection state persistence** - Fixed issues with selection states not persisting properly across UI updates
- **Zero entry handling** - Properly displays "0" when all entries are removed from a list

### Technical Improvements
- **Async operation handling** - Fixed race conditions in list deletion and UI updates
- **Proper promise handling** - Used Promise.all() for parallel UI updates
- **Entry count logic** - Changed from falsy check to explicit undefined check for 0 entries
- **SMS module exports** - Added missing checkAllPendingStatuses export
- **Domain migration support** - Updated from tickets.revival.com/win to win.revival.com

## 🚀 Svelte 5 migration (September 2026)

The frontend was rewritten from Alpine.js and vanilla ES modules to SvelteKit 2 with Svelte 5
runes. The backend is unchanged in behaviour; the plan, the parity contract and the full list of
defects fixed on the way are in `tasks/svelte5-migration-plan.md`.

What changed structurally:
- 8 Alpine stores declared inline in a 3 700-line `index.html` became typed rune stores in
  `src/lib/state`; 15 000 lines of untyped ES modules became typed modules in `src/lib/services`.
- Bootstrap tabs became real routes; Bootstrap modals became native `<dialog>` elements. Removing
  Bootstrap's JavaScript removed both global monkeypatches the old page needed to survive it.
- The selection worker is a real module worker that is terminated after each draw, instead of a
  Blob built from a template string that leaked one worker and one object URL per draw.
- Eligibility is computed once and shared, so the count shown on Setup is by construction the
  pool the draw runs against.
- Settings became one object instead of two half-overlapping ones, which is what made settings
  backup, `stableGrid` and "turn a checkbox off" work for the first time.

## 📝 Summary
The River Winner App has evolved from a Firebase-based PWA to a containerized, self-hosted
solution with local data storage, and its frontend from Alpine.js to Svelte 5. The app is
deployed at win.revival.com with full Docker containerization behind an nginx reverse proxy.

---
*Generated on: November 7, 2024*
*Last Updated: September 4, 2026 — SvelteKit 2 / Svelte 5 runes migration*