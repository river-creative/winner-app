// ================================
// UI UTILITIES & MODALS
// ================================
import { DOMUtils } from './dom-utils.js';
import eventManager from './event-manager.js';

// ================================
// UI UTILITIES & MODALS
// ================================

import { settings } from './settings.js'; // Import settings directly

function generateId(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function showToast(message, type = 'info') {
  const backgroundColor = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#06b6d4'
  };

  Toastify({
    text: message,
    duration: 3000,
    gravity: 'bottom',
    position: 'right',
    style: {
      background: backgroundColor[type] || backgroundColor.info,
    }
  }).showToast();
}

function showProgress(title, text) {
  // Use Alpine store if available, fallback to DOM for backward compatibility
  if (window.Alpine && Alpine.store('ui')) {
    Alpine.store('ui').startProgress(title, text);
  } else {
    document.getElementById('progressTitle').textContent = title;
    document.getElementById('progressText').textContent = text;
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressOverlay').classList.remove('d-none');
  }
}

function updateProgress(percentage, text) {
  // Use Alpine store if available
  if (window.Alpine && Alpine.store('ui')) {
    Alpine.store('ui').updateProgressState(percentage, text);
  } else {
    document.getElementById('progressFill').style.width = percentage + '%';
    if (text) {
      document.getElementById('progressText').textContent = text;
    }
  }
}

function hideProgress() {
  // Use Alpine store if available
  if (window.Alpine && Alpine.store('ui')) {
    Alpine.store('ui').endProgress();
  } else {
    document.getElementById('progressOverlay').classList.add('d-none');
  }
}


function showConfirmationModal(title, message, onConfirm, options = {}) {
  // Use Alpine modal component if available
  const alpineModal = window.alpineConfirmModal;
  if (alpineModal && alpineModal.bsModal) {
    alpineModal.show({
      title,
      message,
      customContent: options.customContent || '',
      confirmText: options.confirmText || 'Confirm',
      confirmClass: options.confirmClass || 'btn-danger',
      onConfirm: async () => {
        try {
          await onConfirm();
        } catch (error) {
          console.error(`Error in confirmation modal for "${title}":`, error);
          showToast(`Operation failed: ${error.message}`, 'error');
        }
      }
    });
    return;
  }

  // Fallback to legacy DOM manipulation if Alpine not available
  const modalTitle = document.getElementById('confirmModalLabel');
  const modalBody = document.getElementById('confirmModalBody');
  const confirmBtn = document.getElementById('confirmModalConfirmBtn');
  const cancelBtn = document.querySelector('#confirmModal .modal-footer .btn-secondary');

  modalTitle.textContent = title;
  modalBody.innerHTML = `<p>${message}</p>`;
  confirmBtn.textContent = options.confirmText || 'Confirm';
  confirmBtn.className = `btn ${options.confirmClass || 'btn-danger'}`;
  confirmBtn.style.display = 'inline-block';
  cancelBtn.textContent = 'Cancel';

  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  // Handler for confirmation
  const handleConfirm = async () => {
    try {
      await onConfirm();
    } catch (error) {
      console.error(`Error in confirmation modal for "${title}":`, error);
      showToast(`Operation failed: ${error.message}`, 'error');
    } finally {
      // Workaround for Bootstrap bug: clear data-bs-overflow before hiding
      // Bootstrap tries to JSON.parse this value which fails if it's "hidden"
      document.body.removeAttribute('data-bs-overflow');
      window.appModal.hide();
      document.removeEventListener('keydown', keyHandler);
    }
  };

  // Keyboard event handler
  const keyHandler = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      document.body.removeAttribute('data-bs-overflow');
      window.appModal.hide();
      document.removeEventListener('keydown', keyHandler);
    }
  };

  newConfirmBtn.addEventListener('click', handleConfirm, { once: true });

  // Add keyboard listener when modal is shown
  document.addEventListener('keydown', keyHandler);

  // Remove keyboard listener when modal is hidden
  const modal = document.getElementById('confirmModal');
  modal.addEventListener('hidden.bs.modal', () => {
    document.removeEventListener('keydown', keyHandler);
  }, { once: true });

  window.appModal.show();
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = e => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// populateQuickSelects removed - Alpine x-for handles list/prize dropdowns reactively

function applyVisibilitySettings() {
  const totalEntriesCard = document.getElementById('totalEntriesCard');
  if (totalEntriesCard) {
    totalEntriesCard.style.display = settings.hideEntryCounts ? 'none' : 'block';
  }
}

async function syncUI() {
  try {
    // Alpine stores handle list/prize data reactively
    applyVisibilitySettings();
  } catch (error) {
    console.error('Error syncing UI:', error);
    showToast('Failed to refresh the application interface.', 'error');
  }
}

// Promise-based confirmation modal
function showConfirmationPromise(title, message) {
  return new Promise((resolve) => {
    const modalTitle = document.getElementById('confirmModalLabel');
    const modalBody = document.getElementById('confirmModalBody');
    const confirmBtn = document.getElementById('confirmModalConfirmBtn');
    const cancelBtn = document.querySelector('#confirmModal .modal-footer .btn-secondary');

    modalTitle.textContent = title;
    modalBody.innerHTML = `<p>${message}</p>`;
    confirmBtn.textContent = 'Confirm';
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'inline-block';

    // Clean up old event listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Handler for confirmation
    const handleConfirm = () => {
      if (window.appModal) window.appModal.hide();
      document.removeEventListener('keydown', keyHandler);
      resolve(true);
    };

    // Handler for cancellation
    const handleCancel = () => {
      if (window.appModal) window.appModal.hide();
      document.removeEventListener('keydown', keyHandler);
      resolve(false);
    };

    // Keyboard event handler
    const keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    };

    newConfirmBtn.onclick = handleConfirm;
    newCancelBtn.onclick = handleCancel;

    // Add keyboard listener when modal is shown
    document.addEventListener('keydown', keyHandler);

    // Remove keyboard listener when modal is hidden
    const modal = document.getElementById('confirmModal');
    modal.addEventListener('hidden.bs.modal', () => {
      document.removeEventListener('keydown', keyHandler);
    }, { once: true });

    if (window.appModal) window.appModal.show();
  });
}

// Enhanced showConfirmationModal that supports both callbacks and promises
function enhancedShowConfirmationModal(title, message, onConfirm) {
  if (!onConfirm) {
    return showConfirmationPromise(title, message);
  }
  return showConfirmationModal(title, message, onConfirm);
}

export const UI = {
  generateId,
  showToast,
  showProgress,
  updateProgress,
  hideProgress,
  showConfirmationModal: enhancedShowConfirmationModal,
  readFileAsText,
  applyVisibilitySettings,
  syncUI
};

window.UI = UI;
