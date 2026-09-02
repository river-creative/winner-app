# 🎉 River Winner App - Comprehensive Project Summary

## 📋 Project Overview
**River Winner App** is a professional Progressive Web Application (PWA) for random winner selection at events, presentations, and contests. Originally built with Firebase, it has been refactored to use a local Node.js/Express backend with JSON file storage. The app is containerized with Docker and deployed at tickets.revival.com/win.

## 🏗️ Architecture & Technology Stack

### Frontend Framework
- **Vite** build tool for fast development and optimized production builds
- **Bootstrap 5.3.2** for responsive UI components
- **Vanilla JavaScript modules** (ES6+) for application logic
- **Service Worker** for offline functionality and PWA features

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

### 8. **QR Scanner Module** (scan.html)
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
├── public/
│   ├── favicon.ico
│   ├── favicon.png
│   ├── manifest.json          # PWA manifest
│   ├── worker.js              # Service Worker
│   ├── icons/                 # App icons
│   └── sounds/                # Audio files
├── src/
│   ├── main.js               # Entry point
│   ├── css/
│   │   └── styles.css        # Main stylesheet
│   └── js/
│       ├── app.js            # Main application logic
│       ├── scan-app.js       # Scanner app entry
│       └── modules/
│           ├── firebase.js    # Firebase config
│           ├── firestore.js   # Database layer
│           ├── ui.js         # UI utilities
│           ├── lists.js      # List management
│           ├── prizes.js     # Prize management
│           ├── winners.js    # Winner management
│           ├── selection.js  # Selection engine
│           ├── settings.js   # Settings management
│           ├── sounds.js     # Sound effects
│           ├── animations.js # Visual effects
│           ├── csv-parser.js # CSV processing
│           ├── export.js     # Export/backup
│           └── qr-scanner.js # QR scanning
├── docs/                     # Documentation
├── index.html               # Main app
├── scan.html               # QR scanner page
├── test-*.html             # Test pages
├── package.json            # NPM config
└── vite.config.js          # Vite build config
```

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
admin path is unaffected.

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
npm install        # Install dependencies
npm run dev        # Start dev server (port 3000)
npm run build      # Production build
npm run preview    # Preview production build
```

### Deployment Options
- **GitHub Pages**: Free static hosting
- **Netlify/Vercel**: Automatic deployments
- **Firebase Hosting**: Integrated with Firestore
- **Traditional hosting**: Any HTTPS-enabled server

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

## 📝 Summary
The River Winner App has evolved from a Firebase-based PWA to a containerized, self-hosted solution with local data storage. The refactoring removed external dependencies while maintaining all features and improving performance through batch operations and optimized state management. The app is now deployed at win.revival.com with full Docker containerization and nginx reverse proxy configuration.

Recent updates focused on UI consistency, fixing selection bugs, and ensuring proper data synchronization across browser sessions. The Lists tab now matches the Prizes page design pattern with click-to-select cards, and all async operations have been properly handled to prevent UI refresh issues.

---
*Generated on: November 7, 2024*
*Last Updated: August 16, 2025 - UI improvements, bug fixes for list selection, and async operation handling*