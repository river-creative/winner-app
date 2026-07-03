// Templates Module - Manages SMS templates
import { Database } from './database.js';
import { UI } from './ui.js';
import eventManager from './event-manager.js';

// Get available placeholders from lists
async function getAvailablePlaceholders() {
  try {
    const fieldSet = new Set();
    
    // Always include standard placeholders
    fieldSet.add('name');
    fieldSet.add('prize');
    fieldSet.add('ticketCode');
    fieldSet.add('eventName');
    
    // Try to get fields from selected lists first (Alpine setup store is the
    // single source of truth for the current draw selection).
    const selectedIds = window.Alpine?.store('setup')?.selectedListIds || [];
    if (selectedIds.length > 0) {
      const lists = await Database.getFromStore('lists');
      const selectedLists = lists.filter(list =>
        selectedIds.includes(list.listId)
      );
      
      if (selectedLists.length > 0) {
        selectedLists.forEach(list => {
          if (list.entries && list.entries.length > 0) {
            const firstEntry = list.entries[0];
            if (firstEntry.data) {
              Object.keys(firstEntry.data).forEach(key => {
                fieldSet.add(key);
              });
            }
          }
        });
      }
    } else {
      // Fall back to all lists if none selected
      const lists = await Database.getFromStore('lists');
      lists.forEach(list => {
        if (list.entries && list.entries.length > 0) {
          const firstEntry = list.entries[0];
          if (firstEntry.data) {
            Object.keys(firstEntry.data).forEach(key => {
              fieldSet.add(key);
            });
          }
        }
      });
    }
    
    return Array.from(fieldSet).sort();
  } catch (error) {
    console.error('Error getting placeholders:', error);
    // Return default placeholders
    return ['name', 'prize', 'ticketCode', 'eventName'];
  }
}

// Template management functions
async function loadTemplates() {
  try {
    const templates = await Database.getFromStore('templates');
    displayTemplates(templates);
    
    // Update placeholders display
    await updatePlaceholdersDisplay();
    
    return templates;
  } catch (error) {
    console.error('Error loading templates:', error);
    UI.showToast('Failed to load templates', 'error');
    return [];
  }
}

// Update the placeholders display
async function updatePlaceholdersDisplay() {
  const placeholdersList = document.getElementById('placeholdersList');
  if (!placeholdersList) return;
  
  const placeholders = await getAvailablePlaceholders();
  
  if (placeholders.length > 0) {
    placeholdersList.innerHTML = placeholders.map(p => 
      `<code>{${p}}</code>`
    ).join(', ');
  } else {
    placeholdersList.innerHTML = '<em>No fields available</em>';
  }
}

function displayTemplates(templates) {
  const grid = document.getElementById('templatesGrid');
  if (!grid) return;

  if (templates.length === 0) {
    grid.innerHTML = `
      <div class="col-12 text-center py-5">
        <i class="bi bi-chat-text display-1 text-muted"></i>
        <p class="text-muted mt-3">No templates yet.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = templates.map(template => `
    <div class="col-12 col-md-6 col-lg-4">
      <div class="card h-100 ${template.isDefault ? 'border-primary' : ''}">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h6 class="mb-0">${template.name}</h6>
          ${template.isDefault ? '<span class="badge bg-success"><i class="bi bi-star"></i> Default</span>' : ''}
        </div>
        <div class="card-body">
          <p class="card-text small text-muted">${template.message}</p>
          <div class="d-flex justify-content-between mt-3">
            ${!template.isDefault ? `
              <button class="btn btn-sm btn-outline-info" data-template-id="${template.templateId}" data-action="set-default">
                <i class="bi bi-star"></i> Set Default
              </button>
            ` : '<div></div>'}
            <div>
              <button class="btn btn-sm btn-outline-primary" data-template-id="${template.templateId}" data-action="edit">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" data-template-id="${template.templateId}" data-action="delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  // Set up event delegation for template actions
  setupTemplateEventDelegation();
}

let templateEventCleanup = null;

function setupTemplateEventDelegation() {
  // Clean up previous delegation if it exists
  if (templateEventCleanup) {
    templateEventCleanup();
    templateEventCleanup = null;
  }
  
  const grid = document.getElementById('templatesGrid');
  if (grid) {
    templateEventCleanup = eventManager.delegate(grid, '[data-template-id]', 'click', function(e) {
      const templateId = this.dataset.templateId;
      const action = this.dataset.action;
      
      switch(action) {
        case 'edit':
          editTemplate(templateId);
          break;
        case 'delete':
          deleteTemplate(templateId);
          break;
        case 'set-default':
          setDefaultTemplate(templateId);
          break;
      }
    });
  }
}

// Open Add Template modal via Alpine formModal
async function showAddTemplateModal() {
  if (window.alpineFormModal) {
    await window.alpineFormModal.openTemplateForm();
  } else {
    console.error('Alpine formModal not initialized');
    UI.showToast('Error: Form modal not properly initialized', 'error');
  }
}

// Open Edit Template modal via Alpine formModal
async function editTemplate(templateId) {
  const templates = await Database.getFromStore('templates');
  const template = templates.find(t => t.templateId === templateId);

  if (!template) {
    UI.showToast('Template not found', 'error');
    return;
  }

  if (window.alpineFormModal) {
    await window.alpineFormModal.openTemplateForm(template);
  } else {
    console.error('Alpine formModal not initialized');
    UI.showToast('Error: Form modal not properly initialized', 'error');
  }
}

async function deleteTemplate(templateId) {
  const confirmed = await UI.showConfirmation(
    'Delete Template',
    'Are you sure you want to delete this template?'
  );

  if (!confirmed) return;

  try {
    await Database.deleteFromStore('templates', templateId);
    await loadTemplates();
    UI.showToast('Template deleted', 'success');
  } catch (error) {
    console.error('Error deleting template:', error);
    UI.showToast('Failed to delete template', 'error');
  }
}

async function setDefaultTemplate(templateId) {
  try {
    const templates = await Database.getFromStore('templates');
    
    for (const tmpl of templates) {
      if (tmpl.templateId === templateId) {
        tmpl.isDefault = true;
      } else if (tmpl.isDefault) {
        tmpl.isDefault = false;
      }
      await Database.saveToStore('templates', tmpl);
    }

    await loadTemplates();
    UI.showToast('Default template updated', 'success');
  } catch (error) {
    console.error('Error setting default template:', error);
    UI.showToast('Failed to set default template', 'error');
  }
}

// Get the default template
async function getDefaultTemplate() {
  const templates = await Database.getFromStore('templates');
  return templates.find(t => t.isDefault);
}

// Create default template if none exists
async function ensureDefaultTemplate() {
  try {
    const templates = await Database.getFromStore('templates');
    if (templates.length === 0) {
      // Create default template
      const defaultTemplate = {
        templateId: 'tmpl_default',
        name: 'Default Winner Notification',
        message: 'Congratulations {name}! You won {prize}. Your code: {contactId}',
        isDefault: true,
        createdAt: new Date().toISOString()
      };
      await Database.saveToStore('templates', defaultTemplate);
    }
  } catch (error) {
    console.error('Error ensuring default template:', error);
  }
}

// Initialize templates module
async function initTemplates() {
  // Ensure default template exists
  await ensureDefaultTemplate();
  
  // Set up add template button
  const addBtn = document.getElementById('addTemplateBtn');
  if (addBtn) {
    addBtn.addEventListener('click', showAddTemplateModal);
  }

  // Load templates when tab is shown
  const templatesTab = document.getElementById('templates-tab');
  if (templatesTab) {
    templatesTab.addEventListener('shown.bs.tab', loadTemplates);
  }
}

// Export functions
export const Templates = {
  loadTemplates,
  showAddTemplateModal,
  editTemplate,
  deleteTemplate,
  setDefaultTemplate,
  getDefaultTemplate,
  initTemplates
};

window.Templates = Templates;