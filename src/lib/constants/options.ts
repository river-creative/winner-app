import type {
  CelebrationEffect,
  DelayVisualType,
  DisplayEffect,
  DisplayFontSize,
  DisplayRatio,
  FontFamily,
  ListSortField,
  PrizeSortField,
  SelectionMode,
  SortOption
} from '$lib/types';

/**
 * Every `<select>`'s options, typed against the unions they write into.
 *
 * These lists and the types are checked against each other by the compiler, so a menu can no
 * longer offer a value the rest of the app does not implement — which is how the partial rewrite
 * ended up offering five reveal effects when only three had any CSS, and three sound names that
 * matched no sound file.
 */

export interface Option<T extends string> {
  value: T;
  label: string;
}

export const SELECTION_MODES: Option<SelectionMode>[] = [
  { value: 'all-at-once', label: 'All at Once' },
  { value: 'sequential', label: 'Sequential Reveal' },
  { value: 'individual', label: 'One at a Time (manual)' }
];

export const DISPLAY_EFFECTS: Option<DisplayEffect>[] = [
  { value: 'fade-in', label: 'Fade In' },
  { value: 'fly-in', label: 'Fly In' },
  { value: 'zoom-in', label: 'Zoom In' },
  { value: 'slide-in', label: 'Slide In' },
  { value: 'bounce-in', label: 'Bounce In' }
];

export const DELAY_VISUALS: Option<DelayVisualType>[] = [
  { value: 'none', label: 'No Visual (Silent)' },
  { value: 'countdown', label: 'Countdown Timer' },
  { value: 'animation', label: 'Particle Animation' },
  { value: 'swirl-animation', label: 'Swirl Animation' },
  { value: 'christmas-snow', label: 'Christmas Snow' },
  { value: 'time-machine', label: 'Time Machine' }
];

export const CELEBRATION_EFFECTS: Option<CelebrationEffect>[] = [
  { value: 'none', label: 'No Animation' },
  { value: 'confetti', label: 'Confetti' },
  { value: 'coins', label: 'Gold Coins' },
  { value: 'both', label: 'Both Confetti & Coins' }
];

export const FONT_FAMILIES: Option<FontFamily>[] = [
  { value: 'Open Sans', label: 'Open Sans' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Lato', label: 'Lato' },
  { value: 'Poppins', label: 'Poppins' }
];

export const DISPLAY_FONT_SIZES: Option<DisplayFontSize>[] = [
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra Large' },
  { value: 'max', label: 'Maximum' }
];

/** Grouped, because a projector and a vertical screen are different decisions. */
export const DISPLAY_RATIO_GROUPS: Array<{ label: string; options: Option<DisplayRatio>[] }> = [
  {
    label: '',
    options: [{ value: 'fit', label: 'Fit to Screen (Default)' }]
  },
  {
    label: 'Landscape',
    options: [
      { value: '16:9', label: '16 : 9 — Widescreen' },
      { value: '16:10', label: '16 : 10' },
      { value: '4:3', label: '4 : 3 — Standard' },
      { value: '21:9', label: '21 : 9 — Ultrawide' }
    ]
  },
  {
    label: 'Portrait',
    options: [
      { value: '9:16', label: '9 : 16 — Vertical' },
      { value: '3:4', label: '3 : 4' },
      { value: '10:12', label: '10 : 12 — Portrait Screen' }
    ]
  }
];

export const BACKGROUND_TYPES = [
  { value: 'gradient', label: 'Gradient' },
  { value: 'solid', label: 'Solid Color' },
  { value: 'image', label: 'Custom Image' }
] as const;

// ---------------------------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------------------------

export const LIST_SORT_OPTIONS: SortOption<ListSortField>[] = [
  { field: 'name', label: 'Name', asc: 'bi-sort-alpha-down', desc: 'bi-sort-alpha-up' },
  { field: 'entries', label: 'Entries', asc: 'bi-sort-numeric-down', desc: 'bi-sort-numeric-up' },
  { field: 'date', label: 'Date', asc: 'bi-sort-down', desc: 'bi-sort-up' }
];

export const PRIZE_SORT_OPTIONS: SortOption<PrizeSortField>[] = [
  { field: 'name', label: 'Name', asc: 'bi-sort-alpha-down', desc: 'bi-sort-alpha-up' },
  { field: 'quantity', label: 'Quantity', asc: 'bi-sort-numeric-down', desc: 'bi-sort-numeric-up' },
  { field: 'date', label: 'Date', asc: 'bi-sort-down', desc: 'bi-sort-up' }
];

// ---------------------------------------------------------------------------------------------
// Giveaway reports (Pretix)
// ---------------------------------------------------------------------------------------------

export const REPORT_TYPES = [
  { value: 'export_giveaways_adults_car.sql', label: 'Adults - Car Giveaway (License Required)' },
  { value: 'export_giveaways_adults_general.sql', label: 'Adults - General Giveaway' },
  { value: 'export_giveaways_minors_over_12.sql', label: 'Teens - Over 12' },
  { value: 'export_giveaways_minors_under_12.sql', label: 'Kids - Under 12' },
  { value: 'export_giveaways_minors_all.sql', label: 'Minors - All Ages' }
] as const;

export const REPORT_TIME_RANGES = [
  { value: 'today', label: 'Today (4am to now)' },
  { value: 'morning', label: 'Morning (4am - 3pm CDT)' },
  { value: 'night', label: 'Night (3pm - 4am CDT)' },
  { value: 'last5', label: 'Last 5 Hours' },
  { value: 'custom', label: 'Custom Range' }
] as const;
