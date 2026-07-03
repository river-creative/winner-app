// ================================
// SETTINGS & THEMES
// ================================

import { Database } from './database.js';
import { DOMUtils } from './dom-utils.js';
import eventManager from './event-manager.js';
import { UI } from './ui.js';

// LocalStorage cache key
const SETTINGS_CACHE_KEY = 'settings';

// Application settings with defaults (internal - access via Settings.data)
let settings = {
  preventDuplicates: false,
  hideEntryCounts: false,
  enableDebugLogs: false,
  skipExistingWinners: false, // Only used in CSV import, not general settings
  preventSamePrize: false,
  fontFamily: 'Open Sans',
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  selectionColor: '#10b981',
  backgroundType: 'gradient',
  customBackgroundImage: null,
  selectedPrizeId: '',
  winnersCount: 1,
  enableWebhook: false,
  webhookUrl: '',
  selectionMode: 'all-at-once',
  preSelectionDelay: 0,
  delayVisualType: 'none',
  displayEffect: 'fade-in',
  displayDuration: 0.5,
  soundDuringDelay: 'none',
  soundEndOfDelay: 'none',
  soundDuringReveal: 'none',
  smsTemplate: 'Congratulations {name}! You won {prize}. Your code: {contactId}',
  celebrationEffect: 'confetti',
  celebrationDuration: 4,
  celebrationAutoTrigger: true
};

async function saveSettings() {
  // Save to localStorage immediately for instant access
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Error saving to localStorage:', error);
  }
  
  // Then sync to database in background (fire and forget)
  const operations = Object.entries(settings).map(([key, value]) => ({
    collection: 'settings',
    data: { key, value }
  }));
  
  if (operations.length > 0) {
    Database.batchSave(operations).then(() => {
      debugLog(`Batch saved ${operations.length} settings to API`);
    }).catch(error => {
      console.error('Error syncing settings to API:', error);
    });
  }
}

// Save individual setting efficiently (only updates one setting)
async function saveSingleSetting(key, value) {
  try {
    // Update local settings object
    settings[key] = value;
    
    // Save to localStorage immediately
    try {
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('Error saving to localStorage:', error);
    }
    
    // Save to database in background (fire and forget)
    const settingToSave = { key, value };
    Database.saveToStore('settings', settingToSave).then(() => {
      debugLog(`Single setting synced to API: ${key} = ${JSON.stringify(value)}`);
    }).catch(error => {
      console.error(`Error syncing setting ${key} to API:`, error);
    });
    
  } catch (error) {
    console.error(`Error saving single setting ${key}:`, error);
    // Don't throw error for settings save - just log it
  }
}

// Batch save multiple settings efficiently (for related changes)
async function saveMultipleSettings(settingsToSave) {
  try {
    // Update local settings object
    Object.assign(settings, settingsToSave);
    
    // Save to localStorage immediately
    try {
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('Error saving to localStorage:', error);
    }
    
    // Save to database in background (fire and forget)
    const operations = [];
    for (const [key, value] of Object.entries(settingsToSave)) {
      operations.push({
        collection: 'settings',
        data: { key, value }
      });
    }
    
    // Save all settings in a single batch request (don't await)
    Database.batchSave(operations).then(() => {
      debugLog(`Batch settings synced to API:`, settingsToSave);
    }).catch(error => {
      console.error('Error syncing multiple settings to API:', error);
    });
    
  } catch (error) {
    console.error('Error saving multiple settings:', error);
    throw error;
  }
}

async function loadSettings() {
  // First, load from localStorage for instant access
  try {
    const cached = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (cached) {
      const cachedSettings = JSON.parse(cached);
      Object.assign(settings, cachedSettings);
      debugLog('Settings loaded from localStorage cache');
    }
  } catch (error) {
    console.warn('Error loading settings from localStorage:', error);
  }
  
  // Then fetch from API to get latest updates (in background)
  try {
    const savedSettings = await Database.getFromStore('settings');
    let hasUpdates = false;
    
    for (const setting of savedSettings) {
      if (settings.hasOwnProperty(setting.key)) {
        // Check if value changed from cached version
        if (JSON.stringify(settings[setting.key]) !== JSON.stringify(setting.value)) {
          hasUpdates = true;
        }
        settings[setting.key] = setting.value;
      }
    }
    
    // If API had newer data, update localStorage cache
    if (hasUpdates) {
      try {
        localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
        debugLog('Settings cache updated from API');
      } catch (error) {
        console.warn('Error updating localStorage cache:', error);
      }
    }
  } catch (error) {
    console.warn('Could not load settings from API:', error);
    // Continue with cached settings if API fails
  }
}

async function handleSaveSettings() {
  try {
    const settingsForm = {
      preventDuplicates: document.getElementById('preventDuplicates')?.checked || settings.preventDuplicates,
      preventSamePrize: document.getElementById('preventSamePrize')?.checked || settings.preventSamePrize,
      hideEntryCounts: document.getElementById('hideEntryCounts')?.checked || settings.hideEntryCounts,
      enableDebugLogs: document.getElementById('enableDebugLogs')?.checked || settings.enableDebugLogs,
      fontFamily: document.getElementById('fontFamily')?.value || settings.fontFamily,
      primaryColor: document.getElementById('primaryColor')?.value || settings.primaryColor,
      secondaryColor: document.getElementById('secondaryColor')?.value || settings.secondaryColor,
      backgroundType: document.getElementById('backgroundType')?.value || settings.backgroundType,
      enableWebhook: document.getElementById('enableWebhook')?.checked || settings.enableWebhook,
      webhookUrl: document.getElementById('webhookUrl')?.value || settings.webhookUrl
    };

    const selectionState = {
      selectedPrizeId: document.getElementById('quickPrizeSelect')?.value || settings.selectedPrizeId,
      winnersCount: parseInt(document.getElementById('quickWinnersCount')?.value) || settings.winnersCount,
      selectionMode: document.getElementById('selectionMode')?.value || settings.selectionMode,
      preSelectionDelay: parseFloat(document.getElementById('preSelectionDelay')?.value) || settings.preSelectionDelay,
      delayVisualType: document.getElementById('delayVisualType')?.value || settings.delayVisualType,
      displayEffect: document.getElementById('displayEffect')?.value || settings.displayEffect,
      displayDuration: parseFloat(document.getElementById('displayDuration')?.value) || settings.displayDuration,
      soundDuringDelay: document.getElementById('soundDuringDelay')?.value || settings.soundDuringDelay,
      soundEndOfDelay: document.getElementById('soundEndOfDelay')?.value || settings.soundEndOfDelay,
      soundDuringReveal: document.getElementById('soundDuringReveal')?.value || settings.soundDuringReveal
    };

    Object.assign(settings, settingsForm, selectionState);
    await saveSettings();
    applyTheme();
    // Don't refresh quick selects on settings save - it's unnecessary and can cause timing issues
    UI.applyVisibilitySettings();

    UI.showToast('Settings saved', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    UI.showToast('Error saving settings: ' + error.message, 'error');
  }
}

function setupTheme() {
  applyTheme();
  loadSettingsToForm();
  setupSoundTestButtons();
  setupBackgroundTypeHandler();
  
  // Reload sound settings after dropdowns are populated by initSounds
  setTimeout(() => {
    loadSoundSettingsToForm();
  }, 500);
}

// Load only sound settings to form (called after sound dropdowns are updated)
function loadSoundSettingsToForm() {
  const soundFields = {
    'soundDuringDelay': settings.soundDuringDelay,
    'soundEndOfDelay': settings.soundEndOfDelay,
    'soundDuringReveal': settings.soundDuringReveal
  };
  
  for (const [fieldId, value] of Object.entries(soundFields)) {
    const element = document.getElementById(fieldId);
    if (element && value) {
      // Check if the option exists in the dropdown
      const option = element.querySelector(`option[value="${value}"]`);
      if (option) {
        element.value = value;
        debugLog(`Restored sound setting ${fieldId} = ${value}`);
      } else {
        debugLog(`Sound option ${value} not found for ${fieldId}, keeping current value`);
      }
    }
  }
}

function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty('--primary-color', settings.primaryColor);
  root.style.setProperty('--secondary-color', settings.secondaryColor);
  root.style.setProperty('--selection-color', settings.selectionColor || '#10b981');
  root.style.setProperty('--font-family', settings.fontFamily);
  
  // Convert hex to rgba for shadow
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  
  // Set primary color shadow
  root.style.setProperty('--primary-color-shadow', hexToRgba(settings.primaryColor, 0.25));

  const gradient = `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`;
  root.style.setProperty('--gradient-bg', gradient);
  document.body.style.fontFamily = `'${settings.fontFamily}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
  
  // Apply background to PUBLIC interface only
  const publicInterface = document.getElementById('publicInterface');
  if (publicInterface) {
    if (settings.backgroundType === 'gradient') {
      publicInterface.style.background = gradient;
    } else if (settings.backgroundType === 'solid') {
      publicInterface.style.background = settings.primaryColor;
    } else if (settings.backgroundType === 'image' && settings.customBackgroundImage) {
      publicInterface.style.backgroundImage = `url('${settings.customBackgroundImage}')`;
      publicInterface.style.backgroundSize = 'cover';
      publicInterface.style.backgroundPosition = 'center';
      publicInterface.style.backgroundAttachment = 'fixed';
    } else {
      // Default to gradient if no custom image is set
      publicInterface.style.background = gradient;
    }
  }
  
  // Keep body background clean for management interface
  document.body.style.background = '';
  document.body.style.fontFamily = `'${settings.fontFamily}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
}

function loadSettingsToForm() {

  const settingsFields = {
    'preventDuplicates': settings.preventDuplicates,
    'preventSamePrize': settings.preventSamePrize,
    'hideEntryCounts': settings.hideEntryCounts,
    'enableDebugLogs': settings.enableDebugLogs,
    // skipExistingWinners is handled separately in CSV import dialog
    'fontFamily': settings.fontFamily,
    'primaryColor': settings.primaryColor,
    'secondaryColor': settings.secondaryColor,
    'backgroundType': settings.backgroundType,
    'enableWebhook': settings.enableWebhook,
    'webhookUrl': settings.webhookUrl
  };

  for (const [fieldId, value] of Object.entries(settingsFields)) {
    const element = document.getElementById(fieldId);
    if (element) {
      if (element.type === 'checkbox') {
        element.checked = value;
      } else {
        element.value = value;
      }
    }
  }

  // Note: quickListSelect is now handled by Alpine x-for in index.html
  const quickPrizeSelect = document.getElementById('quickPrizeSelect');
  const quickWinnersCount = document.getElementById('quickWinnersCount');
  if (quickPrizeSelect && settings.selectedPrizeId) {
    quickPrizeSelect.value = settings.selectedPrizeId;
  }
  // winnersCount is now managed by Alpine store with persistence
  // Don't overwrite - it would bypass the capped value

  // Load new selection settings
  const selectionMode = document.getElementById('selectionMode');
  const preSelectionDelay = document.getElementById('preSelectionDelay');
  const delayVisualType = document.getElementById('delayVisualType');
  const displayEffect = document.getElementById('displayEffect');
  const displayDuration = document.getElementById('displayDuration');
  
  if (selectionMode && settings.selectionMode) {
    selectionMode.value = settings.selectionMode;
  }
  if (preSelectionDelay && settings.preSelectionDelay !== undefined) {
    preSelectionDelay.value = settings.preSelectionDelay;
  }
  if (delayVisualType && settings.delayVisualType) {
    delayVisualType.value = settings.delayVisualType;
  }
  if (displayEffect && settings.displayEffect) {
    displayEffect.value = settings.displayEffect;
  }
  if (displayDuration && settings.displayDuration !== undefined) {
    displayDuration.value = settings.displayDuration;
  }
  
  // Load sound settings
  const soundDuringDelay = document.getElementById('soundDuringDelay');
  const soundEndOfDelay = document.getElementById('soundEndOfDelay');
  const soundDuringReveal = document.getElementById('soundDuringReveal');
  
  if (soundDuringDelay && settings.soundDuringDelay) {
    soundDuringDelay.value = settings.soundDuringDelay;
  }
  if (soundEndOfDelay && settings.soundEndOfDelay) {
    soundEndOfDelay.value = settings.soundEndOfDelay;
  }
  if (soundDuringReveal && settings.soundDuringReveal) {
    soundDuringReveal.value = settings.soundDuringReveal;
  }
  
  // Load celebration settings
  const celebrationEffect = document.getElementById('celebrationEffect');
  const celebrationAutoTrigger = document.getElementById('celebrationAutoTrigger');
  const celebrationDuration = document.getElementById('celebrationDuration');
  
  if (celebrationEffect && settings.celebrationEffect) {
    celebrationEffect.value = settings.celebrationEffect;
  }
  if (celebrationAutoTrigger && settings.celebrationAutoTrigger !== undefined) {
    celebrationAutoTrigger.checked = settings.celebrationAutoTrigger;
  }
  if (celebrationDuration && settings.celebrationDuration !== undefined) {
    celebrationDuration.value = settings.celebrationDuration;
  }

  // Load SMS template
}

// Update SMS character count and SMS count display
function updateSMSCharCount() {
  const smsTemplate = document.getElementById('smsTemplate');
  const smsCharCount = document.getElementById('smsCharCount');
  
  if (smsTemplate && smsCharCount) {
    const text = smsTemplate.value;
    const charCount = text.length;
    
    // Calculate SMS count (standard SMS is 160 chars, multipart starts at 153 chars per segment)
    let smsCount;
    if (charCount === 0) {
      smsCount = 1;
    } else if (charCount <= 160) {
      smsCount = 1;
    } else {
      // Multipart SMS: first segment 153 chars, subsequent segments 153 chars
      smsCount = Math.ceil(charCount / 153);
    }
    
    smsCharCount.textContent = `${charCount} characters, ${smsCount} SMS${smsCount > 1 ? ' messages' : ''}`;
    
    // Color coding based on SMS count
    if (smsCount >= 3) {
      smsCharCount.style.color = '#dc3545'; // red for 3+ SMS
    } else if (smsCount === 2) {
      smsCharCount.style.color = '#fd7e14'; // orange for 2 SMS
    } else {
      smsCharCount.style.color = '#6c757d'; // muted gray for 1 SMS
    }
  }
}

// Setup SMS template character counter
function setupSMSTemplateCounter() {
  const smsTemplate = document.getElementById('smsTemplate');
  if (smsTemplate) {
    // Add character count update and auto-save
    smsTemplate.addEventListener('input', () => {
      updateSMSCharCount();
      autoSaveIndividualSetting('smsTemplate');
    });
    updateSMSCharCount(); // Initial count
  }
}

function toggleTheme() {
  const body = document.body;
  const themeToggle = document.getElementById('themeToggle');
  const currentTheme = body.getAttribute('data-theme');

  if (currentTheme === 'dark') {
    body.setAttribute('data-theme', 'light');
    DOMUtils.safeSetHTML(themeToggle, '<i class="bi bi-moon-fill"></i>', true);
    themeToggle.classList.remove('dark');
  } else {
    body.setAttribute('data-theme', 'dark');
    DOMUtils.safeSetHTML(themeToggle, '<i class="bi bi-sun-fill"></i>', true);
    themeToggle.classList.add('dark');
  }
}

function handleThemePreset(event) {
  const theme = event.currentTarget.getAttribute('data-theme');
  
  const themeConfigs = {
    default: { primaryColor: '#6366f1', secondaryColor: '#8b5cf6', selectionColor: '#10b981', fontFamily: 'Inter' },
    emerald: { primaryColor: '#10b981', secondaryColor: '#06d6a0', selectionColor: '#14b8a6', fontFamily: 'Inter' },
    ruby: { primaryColor: '#ef4444', secondaryColor: '#f87171', selectionColor: '#f43f5e', fontFamily: 'Poppins' },
    gold: { primaryColor: '#f59e0b', secondaryColor: '#fbbf24', selectionColor: '#f97316', fontFamily: 'Poppins' },
    ocean: { primaryColor: '#0ea5e9', secondaryColor: '#06b6d4', selectionColor: '#0891b2', fontFamily: 'Open Sans' },
    corporate: { primaryColor: '#374151', secondaryColor: '#6b7280', selectionColor: '#475569', fontFamily: 'Roboto' }
  };

  const config = themeConfigs[theme];
  if (!config) return;

  settings.primaryColor = config.primaryColor;
  settings.secondaryColor = config.secondaryColor;
  settings.selectionColor = config.selectionColor;
  settings.fontFamily = config.fontFamily;

  applyTheme();
  loadSettingsToForm();
  saveSettings();

  UI.showToast(`Applied ${theme.charAt(0).toUpperCase() + theme.slice(1)} theme`, 'success');
}

function setupWebhookToggle() {
  const enableWebhook = document.getElementById('enableWebhook');
  const webhookUrl = document.getElementById('webhookUrl');
  
  if (enableWebhook && webhookUrl) {
    enableWebhook.addEventListener('change', function() {
      webhookUrl.disabled = !this.checked;
      if (!this.checked) {
        webhookUrl.value = '';
      }
    });
    
    // Set initial state
    webhookUrl.disabled = !enableWebhook.checked;
  }
}

async function triggerWebhook(webhookData) {
  if (!settings.enableWebhook || !settings.webhookUrl) {
    return;
  }

  try {
    const payload = {
      timestamp: Date.now(),
      ...webhookData
    };

    debugLog('Sending webhook to:', settings.webhookUrl);
    debugLog('Payload:', payload);

    let response;
    try {
      // Try POST first with bypass service worker to avoid caching issues
      response = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(payload),
        cache: 'no-store' // Bypass service worker cache
      });
    } catch (corsError) {
      console.warn('POST request failed, trying with query parameters:', corsError);
      
      // Method 2: Fallback to GET with only event in query parameters  
      const queryParams = new URLSearchParams({
        event: webhookData.event || 'winners_selected',
        timestamp: Date.now().toString()
      });
      
      response = await fetch(`${settings.webhookUrl}?${queryParams.toString()}`, {
        method: 'GET',
        cache: 'no-store' // Bypass service worker cache
      });
    }

    if (!response.ok) {
      throw new Error(`Webhook failed with status: ${response.status} - ${response.statusText}`);
    }

    const responseText = await response.text();
    debugLog('Webhook response:', responseText);
    debugLog('Webhook notification sent successfully');
    
  } catch (error) {
    console.error('Webhook notification failed:', error);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    
    // Don't show error toast for webhook failures to avoid disrupting user experience
    console.warn('Webhook failed silently - user experience not affected');
  }
}

function showDelayDisplay(delaySeconds, displayType) {
  debugLog('showDelayDisplay called with:', delaySeconds, displayType);
  
  if (delaySeconds <= 0) {
    debugLog('No delay - returning immediately');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const overlay = document.getElementById('delayOverlay');
    const spinner = document.getElementById('delaySpinner');
    const countdown = document.getElementById('delayCountdown');
    const progress = document.getElementById('delayProgress');
    const dots = document.getElementById('delayDots');

    debugLog('Elements found:', { 
      overlay: !!overlay, 
      spinner: !!spinner, 
      countdown: !!countdown, 
      progress: !!progress, 
      dots: !!dots 
    });

    if (!overlay) {
      console.error('Delay overlay not found!');
      debugLog('Available elements with "delay" in ID:', 
        Array.from(document.querySelectorAll('[id*="delay"]')).map(el => el.id)
      );
      resolve();
      return;
    }

    // Hide all delay types
    [spinner, countdown, progress, dots].forEach(el => {
      if (el) el.classList.add('d-none');
    });

    // Show overlay
    overlay.classList.remove('d-none');
    debugLog('Overlay shown, display type:', displayType);

    switch (displayType) {
      case 'spinner':
        debugLog('Showing spinner');
        if (spinner) {
          spinner.classList.remove('d-none');
          debugLog('Spinner shown, waiting', delaySeconds, 'seconds');
        } else {
          console.error('Spinner element not found!');
        }
        setTimeout(() => {
          debugLog('Delay complete, hiding overlay');
          overlay.classList.add('d-none');
          resolve();
        }, delaySeconds * 1000);
        break;

      case 'countdown':
        countdown.classList.remove('d-none');
        let count = Math.ceil(delaySeconds);
        const countdownNumber = document.getElementById('delayCountdownNumber');
        countdownNumber.textContent = count;

        const interval = setInterval(() => {
          count--;
          if (count > 0) {
            countdownNumber.textContent = count;
          } else {
            clearInterval(interval);
            overlay.classList.add('d-none');
            resolve();
          }
        }, 1000);
        break;

      case 'progress':
        progress.classList.remove('d-none');
        const progressBar = document.getElementById('delayProgressBar');
        let currentProgress = 0;
        const totalSteps = delaySeconds * 100; // Update every 10ms for smooth animation
        const stepDuration = 10;

        const progressInterval = setInterval(() => {
          currentProgress++;
          const percentage = (currentProgress / totalSteps) * 100;
          progressBar.style.width = percentage + '%';

          if (currentProgress >= totalSteps) {
            clearInterval(progressInterval);
            overlay.classList.add('d-none');
            resolve();
          }
        }, stepDuration);
        break;

      case 'dots':
        dots.classList.remove('d-none');
        setTimeout(() => {
          overlay.classList.add('d-none');
          resolve();
        }, delaySeconds * 1000);
        break;

      case 'animation':
        // Show countdown overlay with particle animation canvas
        const animationCountdownOverlay = document.getElementById('countdownOverlay');
        const animationCountdownNumber = document.getElementById('countdownNumber');
        
        debugLog('Animation case - Elements found:', {
          overlay: !!animationCountdownOverlay,
          number: !!animationCountdownNumber,
          animations: !!window.Animations,
          startParticle: !!(window.Animations && window.Animations.startParticleAnimation)
        });
        
        if (animationCountdownOverlay && animationCountdownNumber) {
          // Hide delay overlay and show countdown overlay
          overlay.classList.add('d-none');
          animationCountdownOverlay.classList.remove('d-none');
          debugLog('Countdown overlay shown for animation');
          
          // Start particle animation
          if (window.Animations && window.Animations.startParticleAnimation) {
            window.Animations.startParticleAnimation();
            debugLog('Particle animation started');
          } else {
            debugLog('Particle animation not available');
          }
          
          let animationCount = Math.ceil(delaySeconds);
          animationCountdownNumber.textContent = animationCount;
          debugLog('Starting countdown from:', animationCount);

          const animationInterval = setInterval(() => {
            animationCount--;
            debugLog('Countdown tick:', animationCount);
            if (animationCount > 0) {
              animationCountdownNumber.textContent = animationCount;
            } else {
              clearInterval(animationInterval);
              animationCountdownOverlay.classList.add('d-none');
              if (window.Animations && window.Animations.stopAnimation) {
                window.Animations.stopAnimation();
              }
              debugLog('Animation countdown completed');
              resolve();
            }
          }, 1000);
        } else {
          debugLog('Animation elements not found, falling back to silent delay');
          overlay.classList.add('d-none');
          setTimeout(resolve, delaySeconds * 1000);
        }
        break;

      case 'swirl-animation':
        // Show countdown overlay with swirl animation canvas
        const swirlCountdownOverlay = document.getElementById('countdownOverlay');
        const swirlCountdownNumber = document.getElementById('countdownNumber');
        
        debugLog('Swirl animation case - Elements found:', {
          overlay: !!swirlCountdownOverlay,
          number: !!swirlCountdownNumber,
          animations: !!window.Animations,
          startSwirl: !!(window.Animations && window.Animations.startSwirlAnimation)
        });
        
        if (swirlCountdownOverlay && swirlCountdownNumber) {
          // Hide delay overlay and show countdown overlay
          overlay.classList.add('d-none');
          swirlCountdownOverlay.classList.remove('d-none');
          debugLog('Countdown overlay shown for swirl animation');
          
          // Start swirl animation
          if (window.Animations && window.Animations.startSwirlAnimation) {
            window.Animations.startSwirlAnimation();
            debugLog('Swirl animation started');
          } else {
            debugLog('Swirl animation not available');
          }
          
          let swirlCount = Math.ceil(delaySeconds);
          swirlCountdownNumber.textContent = swirlCount;
          debugLog('Starting swirl countdown from:', swirlCount);

          const swirlInterval = setInterval(() => {
            swirlCount--;
            debugLog('Swirl countdown tick:', swirlCount);
            if (swirlCount > 0) {
              swirlCountdownNumber.textContent = swirlCount;
            } else {
              clearInterval(swirlInterval);
              swirlCountdownOverlay.classList.add('d-none');
              if (window.Animations && window.Animations.stopAnimation) {
                window.Animations.stopAnimation();
              }
              debugLog('Swirl animation countdown completed');
              resolve();
            }
          }, 1000);
        } else {
          debugLog('Swirl animation elements not found, falling back to silent delay');
          overlay.classList.add('d-none');
          setTimeout(resolve, delaySeconds * 1000);
        }
        break;

      case 'christmas-snow':
        // Show countdown overlay with Christmas snow animation canvas
        const christmasCountdownOverlay = document.getElementById('countdownOverlay');
        const christmasCountdownNumber = document.getElementById('countdownNumber');

        debugLog('Christmas snow animation case - Elements found:', {
          overlay: !!christmasCountdownOverlay,
          number: !!christmasCountdownNumber,
          animations: !!window.Animations,
          startChristmasSnow: !!(window.Animations && window.Animations.startChristmasSnowAnimation)
        });

        if (christmasCountdownOverlay && christmasCountdownNumber) {
          // Hide delay overlay and show countdown overlay
          overlay.classList.add('d-none');
          christmasCountdownOverlay.classList.remove('d-none');
          debugLog('Countdown overlay shown for Christmas snow animation');

          // Start Christmas snow animation
          if (window.Animations && window.Animations.startChristmasSnowAnimation) {
            window.Animations.startChristmasSnowAnimation();
            debugLog('Christmas snow animation started');
          } else {
            debugLog('Christmas snow animation not available');
          }

          let christmasCount = Math.ceil(delaySeconds);
          christmasCountdownNumber.textContent = christmasCount;
          debugLog('Starting Christmas snow countdown from:', christmasCount);

          const christmasInterval = setInterval(() => {
            christmasCount--;
            debugLog('Christmas countdown tick:', christmasCount);
            if (christmasCount > 0) {
              christmasCountdownNumber.textContent = christmasCount;
            } else {
              clearInterval(christmasInterval);
              christmasCountdownOverlay.classList.add('d-none');
              if (window.Animations && window.Animations.stopAnimation) {
                window.Animations.stopAnimation();
              }
              debugLog('Christmas snow animation countdown completed');
              resolve();
            }
          }, 1000);
        } else {
          debugLog('Christmas snow animation elements not found, falling back to silent delay');
          overlay.classList.add('d-none');
          setTimeout(resolve, delaySeconds * 1000);
        }
        break;

      case 'none':
      default:
        // Silent delay - hide overlay immediately and just wait
        overlay.classList.add('d-none');
        setTimeout(resolve, delaySeconds * 1000);
        break;
    }
  });
}

// Test function for debugging delay
function testDelay() {
  // Get current settings from the form
  const delaySeconds = parseFloat(document.getElementById('preSelectionDelay')?.value) || 3;
  const delayVisualType = document.getElementById('delayVisualType')?.value || 'countdown';
  
  debugLog('Testing delay with settings:', delaySeconds, delayVisualType);
  showDelayDisplay(delaySeconds, delayVisualType);
}

// Auto-save function for quick setup fields (efficient batch save)
async function autoSaveQuickSetup(triggerElementId = null) {
  try {
    const changedSettings = {};
    
    // Only include settings that have actually changed
    const fieldMappings = {
      'quickPrizeSelect': 'selectedPrizeId',
      'quickWinnersCount': 'winnersCount',
      'selectionMode': 'selectionMode',
      'preSelectionDelay': 'preSelectionDelay',
      'delayVisualType': 'delayVisualType',
      'displayEffect': 'displayEffect',
      'displayDuration': 'displayDuration',
      'soundDuringDelay': 'soundDuringDelay',
      'soundEndOfDelay': 'soundEndOfDelay',
      'soundDuringReveal': 'soundDuringReveal',
      'celebrationEffect': 'celebrationEffect',
      'celebrationDuration': 'celebrationDuration',
      'celebrationAutoTrigger': 'celebrationAutoTrigger'
    };

    // If a specific element triggered this, only process that specific element
    let fieldsToProcess = fieldMappings;
    if (triggerElementId) {
      // Only process the specific field that triggered the save
      fieldsToProcess = {};
      if (fieldMappings[triggerElementId]) {
        fieldsToProcess[triggerElementId] = fieldMappings[triggerElementId];
        debugLog(`Processing single field for trigger: ${triggerElementId}`);
      }
    }

    for (const [elementId, settingKey] of Object.entries(fieldsToProcess)) {
      const element = document.getElementById(elementId);
      if (element) {
        debugLog(`Checking field ${elementId} (${settingKey}): element.value="${element.value}", current setting="${settings[settingKey]}"`);
        
        let newValue;
        if (settingKey === 'winnersCount') {
          newValue = parseInt(element.value) || settings[settingKey];
        } else if (settingKey === 'preSelectionDelay' || settingKey === 'displayDuration' || settingKey === 'celebrationDuration') {
          newValue = parseFloat(element.value);
          // Allow 0 as a valid value, only use fallback for NaN
          if (isNaN(newValue)) {
            newValue = settings[settingKey];
          }
        } else if (element.type === 'checkbox') {
          newValue = element.checked;
        } else {
          newValue = element.value || settings[settingKey];
        }
        
        debugLog(`Processed value for ${settingKey}: "${newValue}" (type: ${typeof newValue})`);
        
        // Only add to changedSettings if value actually changed
        if (newValue !== settings[settingKey]) {
          changedSettings[settingKey] = newValue;
          debugLog(`✅ Quick setup detected change for ${settingKey}: ${settings[settingKey]} → ${newValue}`);
        } else {
          debugLog(`❌ No change for ${settingKey}: both are ${newValue}`);
        }
      }
    }

    // Only save if something actually changed
    if (Object.keys(changedSettings).length > 0) {
      await saveMultipleSettings(changedSettings);
      debugLog('Quick setup auto-saved:', Object.keys(changedSettings));
    }
  } catch (error) {
    console.error('Error auto-saving quick setup:', error);
  }
}

// Auto-save function for individual settings (single field changes)
async function autoSaveIndividualSetting(fieldId) {
  try {
    const element = document.getElementById(fieldId);
    if (!element) return;

    let newValue;
    if (element.type === 'checkbox') {
      newValue = element.checked;
    } else {
      newValue = element.value;
    }

    // Map field ID to setting key
    const fieldToSettingMap = {
      'preventDuplicates': 'preventDuplicates',
      'preventSamePrize': 'preventSamePrize',
      'hideEntryCounts': 'hideEntryCounts',
      'celebrationAutoTrigger': 'celebrationAutoTrigger',
      'enableDebugLogs': 'enableDebugLogs',
      'fontFamily': 'fontFamily',
      'primaryColor': 'primaryColor',
      'secondaryColor': 'secondaryColor',
      'selectionColor': 'selectionColor',
      'backgroundType': 'backgroundType',
      'enableWebhook': 'enableWebhook',
      'webhookUrl': 'webhookUrl',
      'smsTemplate': 'smsTemplate'
    };

    const settingKey = fieldToSettingMap[fieldId];
    if (settingKey && newValue !== settings[settingKey]) {
      await saveSingleSetting(settingKey, newValue);
      
      // Apply theme changes immediately for UI settings
      if (['primaryColor', 'secondaryColor', 'selectionColor', 'fontFamily'].includes(settingKey)) {
        applyTheme();
      }
      
      // Apply visibility changes immediately
      if (settingKey === 'hideEntryCounts') {
        UI.applyVisibilitySettings();
        // Also reload lists to update their display
        if (window.Lists && window.Lists.loadLists) {
          window.Lists.loadLists();
        }
      }
      
      debugLog(`Individual setting auto-saved: ${settingKey} = ${newValue}`);
    }
  } catch (error) {
    console.error('Error auto-saving individual setting:', error);
    UI.showToast('Error saving setting', 'error');
  }
}

// Legacy function for bulk saves (now more efficient)
async function autoSaveAllSettings() {
  try {
    await handleSaveSettings();
    // Note: handleSaveSettings already shows its own toast, so we don't show another one here
  } catch (error) {
    console.error('Error auto-saving settings:', error);
    UI.showToast('Error saving settings', 'error');
  }
}

// Setup sound test buttons
function setupSoundTestButtons() {
  const testSoundDuringDelay = document.getElementById('testSoundDuringDelay');
  const testSoundEndOfDelay = document.getElementById('testSoundEndOfDelay');
  const testSoundDuringReveal = document.getElementById('testSoundDuringReveal');

  if (testSoundDuringDelay) {
    testSoundDuringDelay.addEventListener('click', () => {
      testSoundEffect('delay');
    });
  }

  if (testSoundEndOfDelay) {
    testSoundEndOfDelay.addEventListener('click', () => {
      testSoundEffect('end');
    });
  }

  if (testSoundDuringReveal) {
    testSoundDuringReveal.addEventListener('click', () => {
      testSoundEffect('reveal');
    });
  }
}

// Function to show/hide image sections (called from HTML)
function showImageSection(section) {
  const selectExistingSection = document.getElementById('selectExistingSection');
  const uploadNewSection = document.getElementById('uploadNewSection');
  const selectExistingBtn = document.getElementById('selectExistingBtn');
  const uploadNewBtn = document.getElementById('uploadNewBtn');
  
  if (section === 'existing') {
    selectExistingSection.style.display = 'block';
    uploadNewSection.style.display = 'none';
    selectExistingBtn.classList.add('active');
    uploadNewBtn.classList.remove('active');
  } else if (section === 'upload') {
    selectExistingSection.style.display = 'none';
    uploadNewSection.style.display = 'block';
    selectExistingBtn.classList.remove('active');
    uploadNewBtn.classList.add('active');
  }
}

// Setup background type handler for showing/hiding image upload
function setupBackgroundTypeHandler() {
  const backgroundTypeSelect = document.getElementById('backgroundType');
  const backgroundImageUpload = document.getElementById('backgroundImageUpload');
  const backgroundImageInput = document.getElementById('backgroundImage');
  const existingImagesGallery = document.getElementById('existingImagesGallery');
  
  if (backgroundTypeSelect && backgroundImageUpload) {
    // Show/hide image upload based on background type
    backgroundTypeSelect.addEventListener('change', async (e) => {
      if (e.target.value === 'image') {
        backgroundImageUpload.style.display = 'block';
        await loadExistingImages(); // Load gallery when shown
      } else {
        backgroundImageUpload.style.display = 'none';
      }
    });
    
    // Set initial visibility
    if (settings.backgroundType === 'image') {
      backgroundImageUpload.style.display = 'block';
      loadExistingImages(); // Load gallery on init
    }
  }
  
  // Handle new image upload
  if (backgroundImageInput) {
    backgroundImageInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        try {
          // Create FormData and upload file to server
          const formData = new FormData();
          formData.append('image', file);
          
          const response = await fetch('./api/upload-background', {
            method: 'POST',
            body: formData
          });
          
          if (!response.ok) {
            let errorMessage = 'Failed to upload image';
            try {
              const errorData = await response.json();
              errorMessage = errorData.error || errorMessage;
            } catch {
              // If response is not JSON, try text
              try {
                const text = await response.text();
                if (text.includes('File too large')) {
                  errorMessage = 'Image file is too large. Maximum size is 10MB.';
                } else if (text.includes('Only image files')) {
                  errorMessage = 'Please select a valid image file.';
                }
              } catch {}
            }
            throw new Error(errorMessage);
          }
          
          const result = await response.json();
          
          // Save the image path in settings
          settings.customBackgroundImage = result.imagePath;
          await saveSingleSetting('customBackgroundImage', settings.customBackgroundImage);
          applyTheme();
          UI.showToast('Background image uploaded and applied', 'success');
          
          // Reload gallery to show new image
          await loadExistingImages();
          
          // Switch to select existing section to show the new upload
          showImageSection('existing');
        } catch (error) {
          console.error('Error uploading background image:', error);
          UI.showToast('Failed to upload background image', 'error');
        }
      }
    });
  }
  
  // Load existing images into gallery
  async function loadExistingImages() {
    if (!existingImagesGallery) return;
    
    try {
      const response = await fetch('./api/uploaded-images');
      const images = await response.json();
      
      if (images.length === 0) {
        existingImagesGallery.innerHTML = '<div class="col-12 text-center text-muted">No images uploaded yet</div>';
        return;
      }
      
      existingImagesGallery.innerHTML = images.map(img => `
        <div class="col-4 col-md-3">
          <div class="position-relative image-thumbnail" style="cursor: pointer; border: 2px solid transparent; border-radius: 8px; overflow: hidden; aspect-ratio: 1;">
            <img src="${img.url}" 
                 data-path="${img.path}" 
                 class="w-100 h-100" 
                 style="object-fit: cover;"
                 alt="${img.filename}">
            ${settings.customBackgroundImage === img.path ? '<div class="position-absolute top-0 end-0 m-1"><i class="bi bi-check-circle-fill text-success"></i></div>' : ''}
          </div>
        </div>
      `).join('');
      
      // Add click handlers to images
      existingImagesGallery.querySelectorAll('img').forEach(img => {
        img.addEventListener('click', async () => {
          const imagePath = img.dataset.path;
          settings.customBackgroundImage = imagePath;
          await saveSingleSetting('customBackgroundImage', settings.customBackgroundImage);
          applyTheme();
          UI.showToast('Background image selected', 'success');
          
          // Update UI to show selection
          existingImagesGallery.querySelectorAll('.bi-check-circle-fill').forEach(check => check.remove());
          const checkIcon = document.createElement('div');
          checkIcon.className = 'position-absolute top-0 end-0 m-1';
          checkIcon.innerHTML = '<i class="bi bi-check-circle-fill text-success"></i>';
          img.parentElement.appendChild(checkIcon);
        });
      });
      
    } catch (error) {
      console.error('Error loading existing images:', error);
      existingImagesGallery.innerHTML = '<div class="col-12 text-center text-danger">Failed to load images</div>';
    }
  }
}

// Test sound effects based on current dropdown selections
function testSoundEffect(phase) {
  if (phase === 'delay') {
    const soundType = document.getElementById('soundDuringDelay')?.value || 'none';
    if (soundType !== 'none') {
      // Import and use the Selection module's playSound function
      import('./selection.js').then(({ Selection }) => {
        Selection.playSound(soundType);
        if (soundType.includes('drum')) {
          setTimeout(() => {
            Selection.playSound('drumroll-stop'); // Stop after 3 seconds for testing
          }, 3000);
        }
      }).catch(error => {
        console.warn('Could not test sound:', error);
      });
    }
  } else if (phase === 'end') {
    const soundType = document.getElementById('soundEndOfDelay')?.value || 'none';
    if (soundType !== 'none') {
      import('./selection.js').then(({ Selection }) => {
        Selection.playSound(soundType);
      }).catch(error => {
        console.warn('Could not test sound:', error);
      });
    }
  } else if (phase === 'reveal') {
    const soundType = document.getElementById('soundDuringReveal')?.value || 'none';
    if (soundType !== 'none') {
      import('./selection.js').then(({ Selection }) => {
        Selection.playSound(soundType);
      }).catch(error => {
        console.warn('Could not test sound:', error);
      });
    }
  }
}

// Store cleanup functions for event listeners
let cleanupFunctions = [];

// Cleanup existing listeners before adding new ones
function cleanupEventListeners() {
  cleanupFunctions.forEach(cleanup => cleanup());
  cleanupFunctions = [];
}

// Setup auto-save listeners for quick setup fields with proper cleanup
function setupQuickSetupAutoSave() {
  // Clean up any existing listeners first
  cleanupEventListeners();
  
  const quickFields = [
    'quickPrizeSelect',
    'quickWinnersCount',
    'selectionMode',
    'preSelectionDelay',
    'delayVisualType',
    'displayEffect',
    'displayDuration',
    'soundDuringDelay',
    'soundEndOfDelay',
    'soundDuringReveal',
    'celebrationEffect',
    'celebrationDuration',
    'celebrationAutoTrigger'
  ];

  quickFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) {
      // Create field-specific handlers that pass the field ID
      const fieldSpecificDebouncedSave = debounce(() => autoSaveQuickSetup(fieldId), 500);
      const fieldSpecificImmediateSave = () => autoSaveQuickSetup(fieldId);
      
      if (field.type === 'number' || field.type === 'text') {
        cleanupFunctions.push(
          eventManager.on(field, 'input', fieldSpecificDebouncedSave),
          eventManager.on(field, 'change', fieldSpecificImmediateSave)
        );
      } else {
        cleanupFunctions.push(
          eventManager.on(field, 'change', fieldSpecificImmediateSave)
        );
      }

      debugLog(`Quick setup auto-save listener added for: ${fieldId} (type: ${field.type})`);
    }
  });
}


// Setup auto-save listeners for all settings fields (efficient individual saves)
function setupAllSettingsAutoSave() {
  const allSettingsFields = [
    'preventDuplicates',
    'preventSamePrize',
    'hideEntryCounts',
    'enableDebugLogs',
    // 'skipExistingWinners', - handled in CSV import dialog
    'fontFamily',
    'primaryColor',
    'secondaryColor',
    'backgroundType',
    'enableWebhook',
    'webhookUrl',
    'smsTemplate'
  ];

  allSettingsFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) {
      // Create a debounced save function for this specific field
      const debouncedSave = debounce(() => autoSaveIndividualSetting(fieldId), 500);
      
      if (field.type === 'checkbox') {
        field.addEventListener('change', () => autoSaveIndividualSetting(fieldId));
      } else if (field.type === 'color' || field.type === 'url' || field.type === 'text' || field.tagName === 'TEXTAREA') {
        field.addEventListener('input', debouncedSave); // Debounced for frequent changes
        field.addEventListener('change', () => autoSaveIndividualSetting(fieldId)); // Immediate on blur
        debugLog(`Auto-save listeners added for ${fieldId} (${field.tagName})`);
      } else {
        field.addEventListener('change', () => autoSaveIndividualSetting(fieldId));
      }
    }
  });
}

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Debug logging utility function
function debugLog(message, ...args) {
  if (settings.enableDebugLogs) {
    console.log(`[DEBUG] ${message}`, ...args);
  }
}

// Single export with both data and methods
export const Settings = {
  // Settings data object - access via Settings.data
  get data() { return settings; },
  set data(newSettings) { Object.assign(settings, newSettings); },
  
  // All methods
  saveSettings,
  saveSingleSetting,
  saveMultipleSettings,
  loadSettings,
  handleSaveSettings,
  setupTheme,
  applyTheme,
  loadSettingsToForm,
  loadSoundSettingsToForm,
  toggleTheme,
  handleThemePreset,
  setupWebhookToggle,
  triggerWebhook,
  showDelayDisplay,
  testDelay,
  setupSoundTestButtons,
  setupBackgroundTypeHandler,
  showImageSection,
  testSoundEffect,
  autoSaveQuickSetup,
  autoSaveIndividualSetting,
  autoSaveAllSettings,
  setupQuickSetupAutoSave,
  setupAllSettingsAutoSave,
  setupSMSTemplateCounter,
  updateSettings: function(newSettings) { Object.assign(settings, newSettings); },
  debugLog,
  cleanupEventListeners, // Add cleanup function to exports
  
  // Direct access to specific settings (for backward compatibility)
  get(key) { return settings[key]; },
  set(key, value) { settings[key] = value; }
};


// Export getter that returns the internal settings object
export { settings };

window.Settings = Settings;
