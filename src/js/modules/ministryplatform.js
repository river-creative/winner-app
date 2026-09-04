// MinistryPlatform Integration Module
import { UI } from './ui.js';
import { Lists } from './lists.js';
import { Database } from './database.js';
import { SafeHTML } from './safe-html.js';

class MinistryPlatformModule {
  constructor() {
    this.modal = null;
    this.queries = [];
    this.currentQuery = null;
    this.currentData = null;
  }

  async init() {
    // Initialize modal
    const modalElement = document.getElementById('mpImportModal');
    if (modalElement) {
      this.modal = new bootstrap.Modal(modalElement);
    }

    // Set up event listeners
    this.setupEventListeners();
    
    // Load available queries when modal opens
    modalElement?.addEventListener('show.bs.modal', () => {
      this.loadQueries();
    });
  }

  setupEventListeners() {
    // Add from MP button
    const addFromMPBtn = document.getElementById('addFromMPBtn');
    addFromMPBtn?.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent anchor default behavior
      this.showModal();
    });

    // Query selection change
    const querySelect = document.getElementById('mpQuerySelect');
    querySelect?.addEventListener('change', (e) => {
      this.onQuerySelect(e.target.value);
    });


    // Import button
    const importBtn = document.getElementById('mpImportBtn');
    importBtn?.addEventListener('click', () => {
      this.importData();
    });
  }

  showModal() {
    if (this.modal) {
      this.modal.show();
    }
  }

  async loadQueries() {
    try {
      const querySelect = document.getElementById('mpQuerySelect');
      const errorAlert = document.getElementById('mpErrorAlert');
      
      // Hide error alert
      errorAlert.style.display = 'none';
      
      // Load queries from server
      const response = await fetch('/api/mp/queries');
      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load queries');
      }
      
      this.queries = result.queries;
      
      // Populate query dropdown
      querySelect.innerHTML = '<option value="">Select a query...</option>';
      
      // Group queries by category
      const categories = {};
      this.queries.forEach(query => {
        const category = query.category || 'Other';
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(query);
      });
      
      // Add grouped options
      for (const [category, queries] of Object.entries(categories)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;
        
        queries.forEach(query => {
          const option = document.createElement('option');
          option.value = query.id;
          option.textContent = query.name;
          optgroup.appendChild(option);
        });
        
        querySelect.appendChild(optgroup);
      }
      
      // Reset form
      this.resetForm();
      
    } catch (error) {
      console.error('Error loading MP queries:', error);
      this.showError(error.message);
    }
  }

  onQuerySelect(queryId) {
    const descriptionDiv = document.getElementById('mpQueryDescription');
    const parametersSection = document.getElementById('mpParametersSection');
    const parametersContainer = document.getElementById('mpParametersContainer');
    if (!queryId) {
      descriptionDiv.textContent = '';
      parametersSection.style.display = 'none';
      this.currentQuery = null;
      return;
    }
    
    // Find selected query
    this.currentQuery = this.queries.find(q => q.id === queryId);
    if (!this.currentQuery) return;
    
    // Show description
    descriptionDiv.textContent = this.currentQuery.description || '';
    
    // Show parameters if needed
    if (this.currentQuery.params && Object.keys(this.currentQuery.params).length > 0) {
      // Check if any parameters need manual input UI 
      // (not hardcoded value, searchTerm, or date range)
      const hasVisibleParams = Object.entries(this.currentQuery.params).some(([key, config]) => 
        !config.value && !config.searchTerm && !config.daysPast && !config.daysFuture
      );
      
      if (hasVisibleParams) {
        parametersSection.style.display = 'block';
      } else {
        parametersSection.style.display = 'none';
      }
      
      parametersContainer.innerHTML = '';
      
      // Create input fields for parameters
      for (const [paramName, paramConfig] of Object.entries(this.currentQuery.params)) {
        // Skip rendering if parameter has a hardcoded value or searchTerm
        if (paramConfig.value || paramConfig.searchTerm) {
          continue;
        }
        
        // Skip if has hardcoded date range values
        if (paramConfig.daysPast !== undefined && paramConfig.daysFuture !== undefined) {
          continue;
        }
        
        // Create unified search interface for all manual input types
        const div = document.createElement('div');
        div.className = 'mb-3';
        
        // Determine the type of search
        const isDateRange = paramConfig.label && 
          (paramConfig.label.toLowerCase().includes('day') || 
           paramConfig.description?.toLowerCase().includes('date range'));
        const isEventId = paramName === 'eventId' && paramConfig.type === 'number' && !isDateRange;
        const isEventName = paramName === 'eventId' && paramConfig.type === 'text';
        
        if (isDateRange) {
          // Date range search
          const label = document.createElement('label');
          label.className = 'form-label';
          label.innerHTML = '<i class="bi bi-calendar-range me-2"></i>Date Range <span class="text-danger">*</span>';
          div.appendChild(label);
          
          const row = document.createElement('div');
          row.className = 'row g-2';
          
          // Days Past input
          const colPast = document.createElement('div');
          colPast.className = 'col-6';
          
          const pastLabel = document.createElement('label');
          pastLabel.className = 'form-label small';
          pastLabel.textContent = 'Days Past';
          colPast.appendChild(pastLabel);
          
          const pastInput = document.createElement('input');
          pastInput.type = 'number';
          pastInput.className = 'form-control';
          pastInput.id = `mpParam_${paramName}_daysPast`;
          pastInput.placeholder = 'e.g., 3';
          pastInput.min = '0';
          pastInput.value = '3';
          colPast.appendChild(pastInput);
          
          // Days Future input
          const colFuture = document.createElement('div');
          colFuture.className = 'col-6';
          
          const futureLabel = document.createElement('label');
          futureLabel.className = 'form-label small';
          futureLabel.textContent = 'Days Future';
          colFuture.appendChild(futureLabel);
          
          const futureInput = document.createElement('input');
          futureInput.type = 'number';
          futureInput.className = 'form-control';
          futureInput.id = `mpParam_${paramName}_daysFuture`;
          futureInput.placeholder = 'e.g., 3';
          futureInput.min = '0';
          futureInput.value = '3';
          colFuture.appendChild(futureInput);
          
          row.appendChild(colPast);
          row.appendChild(colFuture);
          div.appendChild(row);
          
          // Add search button
          const searchBtn = document.createElement('button');
          searchBtn.type = 'button';
          searchBtn.className = 'btn btn-primary mt-2';
          searchBtn.innerHTML = '<i class="bi bi-search me-2"></i>Search Events';
          searchBtn.onclick = async () => {
            const daysPast = parseInt(pastInput.value) || 0;
            const daysFuture = parseInt(futureInput.value) || 0;
            await this.searchEventsByDateRange(daysPast, daysFuture, paramName);
          };
          div.appendChild(searchBtn);
          
        } else if (isEventId) {
          // Event ID search
          const label = document.createElement('label');
          label.className = 'form-label';
          label.innerHTML = `${paramConfig.label || 'Event ID'} <span class="text-danger">*</span>`;
          div.appendChild(label);
          
          const inputGroup = document.createElement('div');
          inputGroup.className = 'input-group';
          
          const input = document.createElement('input');
          input.type = 'text';  // Keep as text to allow comma-separated multiple IDs
          input.className = 'form-control';
          input.id = `mpEventIdNumbers`;  // Unique ID to prevent text autocomplete
          input.name = 'mp-event-ids';  // Unique name for this specific input
          input.autocomplete = 'off';  // Disable autocomplete
          input.placeholder = 'Enter event ID(s) separated by commas (e.g., 71619, 71141)';
          input.pattern = '^[0-9, ]+$';  // Only allow numbers, commas, and spaces
          input.required = true;
          
          const searchBtn = document.createElement('button');
          searchBtn.type = 'button';
          searchBtn.className = 'btn btn-primary';
          searchBtn.innerHTML = '<i class="bi bi-search me-2"></i>Search Events';
          searchBtn.onclick = () => {
            const eventIds = input.value.trim();
            if (!eventIds) {
              UI.showToast('Please enter event ID(s)', 'warning');
              return;
            }
            // Store the value in a hidden input with the expected parameter name
            let hiddenInput = document.getElementById(`mpParam_${paramName}`);
            if (!hiddenInput) {
              hiddenInput = document.createElement('input');
              hiddenInput.type = 'hidden';
              hiddenInput.id = `mpParam_${paramName}`;
              document.getElementById('mpParametersContainer').appendChild(hiddenInput);
            }
            hiddenInput.value = eventIds;
            // Direct execution with the provided IDs
            this.executeQuery();
          };
          
          inputGroup.appendChild(input);
          inputGroup.appendChild(searchBtn);
          div.appendChild(inputGroup);
          
        } else if (isEventName) {
          // Event name search - will be handled by showEventNameSearch
          continue;
        } else {
          // Other parameter types (like Group ID)
          const label = document.createElement('label');
          label.className = 'form-label';
          label.innerHTML = `${paramConfig.label || paramName} ${paramConfig.required ? '<span class="text-danger">*</span>' : ''}`;
          div.appendChild(label);
          
          const inputGroup = document.createElement('div');
          inputGroup.className = 'input-group';
          
          const input = document.createElement('input');
          input.type = paramConfig.type === 'number' ? 'number' : 'text';
          input.className = 'form-control';
          input.id = `mpParam_${paramName}`;
          input.placeholder = paramConfig.placeholder || `Enter ${paramConfig.label || paramName}`;
          input.required = paramConfig.required || false;
          
          if (paramConfig.defaultValue) {
            input.value = paramConfig.defaultValue;
          }
          
          const searchBtn = document.createElement('button');
          searchBtn.type = 'button';
          searchBtn.className = 'btn btn-primary';
          searchBtn.innerHTML = '<i class="bi bi-search me-2"></i>Search';
          searchBtn.onclick = () => {
            if (input.value.trim() || !paramConfig.required) {
              this.executeQuery();
            } else {
              UI.showToast(`Please enter ${paramConfig.label || paramName}`, 'warning');
            }
          };
          
          inputGroup.appendChild(input);
          inputGroup.appendChild(searchBtn);
          div.appendChild(inputGroup);
          
          if (paramConfig.description) {
            const helpText = document.createElement('div');
            helpText.className = 'form-text';
            helpText.textContent = paramConfig.description;
            div.appendChild(helpText);
          }
        }
        
        parametersContainer.appendChild(div);
      }
    } else {
      parametersSection.style.display = 'none';
    }
    
    
    // Reset preview
    document.getElementById('mpPreviewSection').style.display = 'none';
    document.getElementById('mpImportBtn').style.display = 'none';
    
    // Auto-execute ONLY if parameters have hardcoded values
    // For searchTerm and date ranges, we need to load events for selection first
    let shouldAutoExecute = false;
    let shouldLoadEvents = false;
    let needsEventNameInput = false;
    let hasSearchOrDateRange = false;
    
    if (this.currentQuery.params) {
      // Check what type of parameters we have
      const hasHardcodedValues = Object.entries(this.currentQuery.params).every(([key, config]) => {
        if (config.required) {
          return config.value; // Only check for hardcoded value
        }
        return true;
      });
      
      hasSearchOrDateRange = Object.entries(this.currentQuery.params).some(([key, config]) => {
        return config.searchTerm || config.daysPast || config.daysFuture;
      });
      
      // Check if we need to show event name search input
      // This happens when we have a text parameter that needs event search but doesn't have searchTerm or value
      const needsEventSearch = Object.entries(this.currentQuery.params).some(([key, config]) => {
        // If it's a text type parameter without a value or searchTerm, we need user input
        return config.type === 'text' && !config.searchTerm && !config.value && config.required;
      });
      
      shouldAutoExecute = hasHardcodedValues && !hasSearchOrDateRange; // Don't auto-execute if we need event selection
      shouldLoadEvents = hasSearchOrDateRange; // Always load events if searchTerm or date range is present
      needsEventNameInput = needsEventSearch;
    }
    
    if (shouldAutoExecute) {
      console.log('Auto-executing query with hardcoded parameters...');
      setTimeout(() => this.executeQuery(), 100);
    } else if (shouldLoadEvents) {
      console.log('Loading events for selection...', {
        hasSearchOrDateRange,
        eventParam: this.currentQuery.params
      });
      setTimeout(() => this.loadEventsForSelection(), 100);
    } else if (needsEventNameInput) {
      console.log('Showing event name search input...');
      this.showEventNameSearch();
    }
  }

  showEventNameSearch() {
    const parametersSection = document.getElementById('mpParametersSection');
    const parametersContainer = document.getElementById('mpParametersContainer');
    
    parametersSection.style.display = 'block';
    parametersContainer.innerHTML = '';
    
    // Find which parameter needs the search input
    let searchParamKey = null;
    let searchParamConfig = null;
    for (const [key, config] of Object.entries(this.currentQuery.params)) {
      if (config.type === 'text' && !config.searchTerm && !config.value && config.required) {
        searchParamKey = key;
        searchParamConfig = config;
        break;
      }
    }
    
    if (!searchParamKey) return;
    
    // Create event name input
    const div = document.createElement('div');
    div.className = 'mb-3';
    
    const label = document.createElement('label');
    label.className = 'form-label';
    label.innerHTML = `${searchParamConfig.label || searchParamKey} <span class="text-danger">*</span>`;
    div.appendChild(label);
    
    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-group';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.id = 'mpEventNameSearch';  // Unique ID for event name search
    input.name = 'mp-event-name-search';  // Unique name
    input.autocomplete = 'off';  // Disable autocomplete to prevent ID suggestions
    input.placeholder = 'Enter event name to search';
    input.required = true;
    
    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'btn btn-primary';
    searchBtn.innerHTML = '<i class="bi bi-search me-2"></i>Search Events';
    searchBtn.onclick = async () => {
      const searchTerm = input.value.trim();
      if (!searchTerm) {
        UI.showToast('Please enter an event name', 'warning');
        return;
      }
      
      // Search for events with this name and pass the parameter key
      await this.searchEventsByName(searchTerm, searchParamKey);
    };
    
    inputGroup.appendChild(input);
    inputGroup.appendChild(searchBtn);
    div.appendChild(inputGroup);
    
    parametersContainer.appendChild(div);
    
    // Allow Enter key to trigger search
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchBtn.click();
      }
    });
  }
  
  async searchEventsByDateRange(daysPast, daysFuture, paramKey) {
    try {
      const parametersContainer = document.getElementById('mpParametersContainer');
      
      // Clear and show loading
      parametersContainer.innerHTML = '';
      
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'alert alert-info';
      loadingDiv.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Searching for events in date range...';
      parametersContainer.appendChild(loadingDiv);
      
      // Fetch events
      const response = await fetch('/api/mp/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          daysPast: daysPast,
          daysFuture: daysFuture
        })
      });
      
      const result = await response.json();
      
      // Remove loading
      loadingDiv.remove();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load events');
      }
      
      if (result.events && result.events.length > 0) {
        // Show event selection
        this.showEventSelection(result.events, paramKey);
      } else {
        const noEventsDiv = document.createElement('div');
        noEventsDiv.className = 'alert alert-warning';
        noEventsDiv.textContent = 'No events found in the specified date range';
        parametersContainer.appendChild(noEventsDiv);
      }
    } catch (error) {
      console.error('Error loading events:', error);
      this.showError(error.message);
    }
  }
  
  async searchEventsByName(searchTerm, paramKey) {
    try {
      const parametersContainer = document.getElementById('mpParametersContainer');
      
      // Show loading
      const loadingDiv = document.createElement('div');
      loadingDiv.id = 'mpEventSearchLoading';
      loadingDiv.className = 'alert alert-info mt-3';
      loadingDiv.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Searching for events...';
      parametersContainer.appendChild(loadingDiv);
      
      // Search for events
      const response = await fetch('/api/mp/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          searchTerm: searchTerm
        })
      });
      
      const result = await response.json();
      
      // Remove loading
      loadingDiv.remove();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to search events');
      }
      
      if (result.events && result.events.length > 0) {
        // Show event selection dropdown
        // Use the dynamic parameter key from the query configuration
        this.showEventSelection(result.events, paramKey);
      } else {
        const noEventsDiv = document.createElement('div');
        noEventsDiv.className = 'alert alert-warning mt-3';
        noEventsDiv.textContent = `No events found matching "${searchTerm}"`;
        parametersContainer.appendChild(noEventsDiv);
      }
      
    } catch (error) {
      console.error('Error searching events:', error);
      this.showError(error.message);
    }
  }
  
  showEventSelection(events, paramKey) {
    const parametersContainer = document.getElementById('mpParametersContainer');
    
    // Remove any existing event selector
    const existingSelect = document.getElementById(`mpEventSelect_${paramKey}`);
    if (existingSelect) {
      existingSelect.remove();
    }
    
    // Events are already sorted by the backend
    
    // Create event selector
    const selectorDiv = document.createElement('div');
    selectorDiv.id = `mpEventSelect_${paramKey}`;
    selectorDiv.className = 'mb-3 mt-3';
    
    const label = document.createElement('label');
    label.className = 'form-label';
    label.innerHTML = `<i class="bi bi-calendar-check me-2"></i>Select Events (${events.length} found)`;
    selectorDiv.appendChild(label);
    
    const select = document.createElement('select');
    select.id = `mpParam_${paramKey}`;
    select.className = 'form-select';
    select.multiple = true;
    select.size = Math.min(10, events.length);
    
    // Add events to select (already sorted by backend)
    events.forEach(event => {
      const option = document.createElement('option');
      // mp-js-api returns consistent camelCase field names
      const eventId = event.eventID;
      const eventTitle = event.eventTitle || 'Unnamed Event';
      const eventDate = event.eventStartDate || '';

      // Format: "12345 | Dec 15, 2024 | Event Name"
      const dateStr = eventDate
        ? new Date(eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';

      option.value = eventId || '';
      option.textContent = `${eventId} | ${dateStr} | ${eventTitle}`;
      option.selected = false; // Don't select by default
      select.appendChild(option);
    });
    
    selectorDiv.appendChild(select);
    
    // Add select all/none buttons
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'btn-group mt-2';
    
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'btn btn-sm btn-outline-secondary';
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.onclick = () => {
      Array.from(select.options).forEach(opt => opt.selected = true);
    };
    
    const selectNoneBtn = document.createElement('button');
    selectNoneBtn.type = 'button';
    selectNoneBtn.className = 'btn btn-sm btn-outline-secondary';
    selectNoneBtn.textContent = 'Select None';
    selectNoneBtn.onclick = () => {
      Array.from(select.options).forEach(opt => opt.selected = false);
    };
    
    buttonGroup.appendChild(selectAllBtn);
    buttonGroup.appendChild(selectNoneBtn);

    // Add execute button
    const executeBtn = document.createElement('button');
    executeBtn.type = 'button';
    executeBtn.className = 'btn btn-primary';
    executeBtn.innerHTML = '<i class="bi bi-search me-2"></i>Get Participants';
    executeBtn.onclick = () => {
      // Get selected event IDs
      const selectedIds = Array.from(select.selectedOptions).map(opt => opt.value).join(', ');
      if (selectedIds) {
        // Update the hidden input with selected IDs
        const hiddenInput = document.getElementById(`mpParam_${paramKey}_hidden`);
        if (hiddenInput) {
          hiddenInput.value = selectedIds;
        } else {
          // Create hidden input if it doesn't exist
          const newHiddenInput = document.createElement('input');
          newHiddenInput.type = 'hidden';
          newHiddenInput.id = `mpParam_${paramKey}_hidden`;
          newHiddenInput.value = selectedIds;
          parametersContainer.appendChild(newHiddenInput);
        }
        // Execute the query
        this.executeQuery();
      } else {
        UI.showToast('Please select at least one event', 'warning');
      }
    };

    // Wrap buttons in flex container
    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'd-flex justify-content-between align-items-center mt-2';
    buttonWrapper.appendChild(buttonGroup);
    buttonWrapper.appendChild(executeBtn);
    selectorDiv.appendChild(buttonWrapper);
    
    parametersContainer.appendChild(selectorDiv);
  }

  async loadEventsForSelection() {
    try {
      const errorAlert = document.getElementById('mpErrorAlert');
      const parametersSection = document.getElementById('mpParametersSection');
      const parametersContainer = document.getElementById('mpParametersContainer');
      
      // Hide error
      errorAlert.style.display = 'none';
      
      // Make sure parameters section is visible
      parametersSection.style.display = 'block';
      parametersContainer.innerHTML = '';
      
      // Find the event parameter config
      let eventParam = null;
      let eventParamKey = null;
      for (const [key, config] of Object.entries(this.currentQuery.params)) {
        if (key === 'eventId' || config.searchTerm || config.daysPast || config.daysFuture) {
          eventParam = config;
          eventParamKey = key;
          break;
        }
      }
      
      if (!eventParam) return;
      
      // Show loading indicator
      const existingSelect = document.getElementById(`mpEventSelect_${eventParamKey}`);
      if (existingSelect) {
        existingSelect.remove();
      }
      
      const loadingDiv = document.createElement('div');
      loadingDiv.id = `mpEventLoading_${eventParamKey}`;
      loadingDiv.className = 'alert alert-info';
      loadingDiv.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Loading events...';
      parametersContainer.appendChild(loadingDiv);
      
      // Fetch events based on config
      const response = await fetch('/api/mp/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          searchTerm: eventParam.searchTerm,
          daysPast: eventParam.daysPast,
          daysFuture: eventParam.daysFuture
        })
      });
      
      const result = await response.json();
      
      // Remove loading indicator
      loadingDiv.remove();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load events');
      }
      
      if (result.events && result.events.length > 0) {
        // Events are already sorted by the backend
        
        // Create event selector
        const selectorDiv = document.createElement('div');
        selectorDiv.id = `mpEventSelect_${eventParamKey}`;
        selectorDiv.className = 'mb-3';
        
        const label = document.createElement('label');
        label.className = 'form-label';
        label.innerHTML = `<i class="bi bi-calendar-check me-2"></i>Select Events (${result.events.length} found)`;
        selectorDiv.appendChild(label);
        
        const select = document.createElement('select');
        select.id = `mpParam_${eventParamKey}`;
        select.className = 'form-select';
        select.multiple = true;
        select.size = Math.min(10, result.events.length);
        
        // Add events to select (already sorted by backend)
        result.events.forEach(event => {
          const option = document.createElement('option');
          // mp-js-api returns consistent camelCase field names
          const eventId = event.eventID;
          const eventTitle = event.eventTitle || 'Unnamed Event';
          const eventDate = event.eventStartDate || '';

          // Format: "12345 | Dec 15, 2024 | Event Name"
          const dateStr = eventDate
            ? new Date(eventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—';

          option.value = eventId || '';
          option.textContent = `${eventId} | ${dateStr} | ${eventTitle}`;
          option.selected = false; // Don't select by default
          select.appendChild(option);
        });
        
        selectorDiv.appendChild(select);
        
        // Add select all/none buttons
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'btn-group mt-2';
        
        const selectAllBtn = document.createElement('button');
        selectAllBtn.type = 'button';
        selectAllBtn.className = 'btn btn-sm btn-outline-secondary';
        selectAllBtn.textContent = 'Select All';
        selectAllBtn.onclick = () => {
          Array.from(select.options).forEach(opt => opt.selected = true);
        };
        
        const selectNoneBtn = document.createElement('button');
        selectNoneBtn.type = 'button';
        selectNoneBtn.className = 'btn btn-sm btn-outline-secondary';
        selectNoneBtn.textContent = 'Select None';
        selectNoneBtn.onclick = () => {
          Array.from(select.options).forEach(opt => opt.selected = false);
        };
        
        buttonGroup.appendChild(selectAllBtn);
        buttonGroup.appendChild(selectNoneBtn);

        // Add execute button
        const executeBtn = document.createElement('button');
        executeBtn.type = 'button';
        executeBtn.className = 'btn btn-primary';
        executeBtn.innerHTML = '<i class="bi bi-search me-2"></i>Get Participants';
        executeBtn.onclick = () => {
          // Get selected event IDs
          const selectedIds = Array.from(select.selectedOptions).map(opt => opt.value).join(', ');
          if (selectedIds) {
            // Update the hidden input with selected IDs
            const hiddenInput = document.getElementById(`mpParam_${eventParamKey}_hidden`);
            if (hiddenInput) {
              hiddenInput.value = selectedIds;
            }
            // Execute the query
            this.executeQuery();
          } else {
            UI.showToast('Please select at least one event', 'warning');
          }
        };

        // Wrap buttons in flex container
        const buttonWrapper = document.createElement('div');
        buttonWrapper.className = 'd-flex justify-content-between align-items-center mt-2';
        buttonWrapper.appendChild(buttonGroup);
        buttonWrapper.appendChild(executeBtn);
        selectorDiv.appendChild(buttonWrapper);
        
        parametersContainer.appendChild(selectorDiv);
        
        // Also create a hidden input to store the selected values
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.id = `mpParam_${eventParamKey}_hidden`;
        hiddenInput.value = Array.from(select.options).map(opt => opt.value).join(', ');
        parametersContainer.appendChild(hiddenInput);
        
      } else {
        const noEventsDiv = document.createElement('div');
        noEventsDiv.className = 'alert alert-warning';
        noEventsDiv.textContent = 'No events found matching the criteria';
        parametersContainer.appendChild(noEventsDiv);
      }
      
    } catch (error) {
      console.error('Error loading events:', error);
      this.showError(error.message);
    }
  }
  
  async executeQuery() {
    try {
      const importBtn = document.getElementById('mpImportBtn');
      const errorAlert = document.getElementById('mpErrorAlert');
      const previewSection = document.getElementById('mpPreviewSection');
      
      // Hide error
      errorAlert.style.display = 'none';
      
      
      // Collect parameters
      const params = {};
      if (this.currentQuery.params) {
        for (const [paramName, paramConfig] of Object.entries(this.currentQuery.params)) {
          // Priority 1: Use hardcoded value if present
          if (paramConfig.value) {
            params[paramName] = paramConfig.value;
          }
          // Priority 2: Check for hidden input (used for event selection from dropdown)
          else {
            const hiddenInput = document.getElementById(`mpParam_${paramName}_hidden`);
            if (hiddenInput && hiddenInput.value) {
              params[paramName] = hiddenInput.value;
            } else {
              // Priority 3: Use regular input field
              const input = document.getElementById(`mpParam_${paramName}`);
              if (input && input.value) {
                params[paramName] = input.value;
              }
            }
          }
        }
      }
      
      // Execute query
      const response = await fetch('/api/mp/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          queryId: this.currentQuery.id,
          params: params
        })
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to execute query');
      }
      
      this.currentData = result.data;
      
      // Show preview using metadata from current query
      const previewFields = this.currentQuery.metadata?.previewFields;
      this.showPreview(result.data, previewFields);
      
      // Show sections
      previewSection.style.display = 'block';
      importBtn.style.display = 'inline-block';
      
      // Update record count
      document.getElementById('mpRecordCount').textContent = `${result.count} records`;
      
    } catch (error) {
      console.error('Error executing MP query:', error);
      this.showError(error.message);
    } finally {
      // Cleanup if needed
    }
  }

  showPreview(data, fields) {
    const table = document.getElementById('mpPreviewTable');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    
    thead.replaceChildren();
    tbody.replaceChildren();

    // Builds a full-width message row (empty state, truncation notice)
    const messageRow = (text, colspan) => {
      const row = SafeHTML.createElement('tr');
      row.appendChild(SafeHTML.createElement('td', text, {
        colspan: String(colspan),
        className: 'text-center text-muted'
      }));
      return row;
    };

    if (!data || data.length === 0) {
      tbody.appendChild(messageRow('No data returned', '100%'));
      return;
    }

    // Use specified fields or get all fields from first record.
    // An empty array is truthy, so it must be treated as "unspecified" — queries created
    // through the query editor are seeded with previewFields: [], and falling through with
    // that would render a table with zero columns.
    const displayFields = fields?.length ? fields : Object.keys(data[0]);

    // Create header
    const headerRow = SafeHTML.createElement('tr');
    for (const field of displayFields) {
      headerRow.appendChild(SafeHTML.createElement('th', field));
    }
    thead.appendChild(headerRow);

    // Show first 10 records as preview. Values are rendered as text, never markup —
    // these come straight from MinistryPlatform and must not be able to inject HTML.
    // createTableRow only fills a cell it recognises as a string, so numeric columns
    // (Contact_ID and friends) have to be stringified here or they render blank.
    const toCellText = (value) => (value === null || value === undefined ? '' : String(value));

    for (const record of data.slice(0, 10)) {
      tbody.appendChild(SafeHTML.createTableRow(displayFields.map(field => toCellText(record[field]))));
    }

    if (data.length > 10) {
      tbody.appendChild(messageRow(`... and ${data.length - 10} more records`, displayFields.length));
    }
  }

async importData() {
    try {
      const listNameInput = document.getElementById('mpListName');
      const importBtn = document.getElementById('mpImportBtn');

      if (!this.currentData || this.currentData.length === 0) {
        throw new Error('No data to import');
      }

      // Store data for CSV parser
      const queryName = this.currentQuery ? this.currentQuery.name : 'Query';
      const listNameValue = listNameInput.value.trim() || queryName;
      const dataToImport = this.currentData;

      // Collect the parameters that were used for this query (for sync capability)
      const usedParams = {};
      if (this.currentQuery && this.currentQuery.params) {
        for (const [paramName, paramConfig] of Object.entries(this.currentQuery.params)) {
          // Priority 1: Hidden input (from event selection dropdown)
          const hiddenInput = document.getElementById(`mpParam_${paramName}_hidden`);
          if (hiddenInput && hiddenInput.value) {
            usedParams[paramName] = hiddenInput.value;
            continue;
          }
          // Priority 2: Visible input field
          const visibleInput = document.getElementById(`mpParam_${paramName}`);
          if (visibleInput && visibleInput.value) {
            usedParams[paramName] = visibleInput.value;
            continue;
          }
          // Priority 3: Hardcoded value from query config
          if (paramConfig.value) {
            usedParams[paramName] = paramConfig.value;
          }
        }
      }

      // Create MP source metadata for sync capability
      const mpSourceInfo = {
        queryId: this.currentQuery ? this.currentQuery.id : null,
        queryName: this.currentQuery ? this.currentQuery.name : 'Query',
        params: usedParams,
        importedAt: Date.now()
      };

      // Close MP modal
      this.modal.hide();

      // Pass data to CSV parser's configuration modal
      // Import dynamically to avoid circular dependency
      import('./csv-parser.js').then(({ CSVParser }) => {
        // Set pending data first
        CSVParser.pendingCSVData = {
          listName: listNameValue,
          fileName: `MinistryPlatform_${queryName}.json`,
          data: dataToImport,
          mpSource: mpSourceInfo  // Add MP source info for sync
        };
        // Then show preview
        CSVParser.showCSVPreview(dataToImport, listNameValue);
      });

      // Reset form after passing data
      this.resetForm();

    } catch (error) {
      console.error('Error importing MP data:', error);
      this.showError(error.message);
      const importBtn = document.getElementById('mpImportBtn');
      importBtn.disabled = false;
      importBtn.innerHTML = '<i class="bi bi-download me-2"></i>Import Data';
    }
  }

  resetForm() {
    // Reset query selection
    document.getElementById('mpQuerySelect').value = '';
    document.getElementById('mpQueryDescription').textContent = '';
    
    // Hide sections
    document.getElementById('mpParametersSection').style.display = 'none';
    document.getElementById('mpPreviewSection').style.display = 'none';
    
    // Reset buttons
    document.getElementById('mpImportBtn').style.display = 'none';
    
    // Clear inputs
    document.getElementById('mpListName').value = '';
    
    // Clear data
    this.currentQuery = null;
    this.currentData = null;
    
    // Hide error
    document.getElementById('mpErrorAlert').style.display = 'none';
  }

  showError(message) {
    const errorAlert = document.getElementById('mpErrorAlert');
    if (errorAlert) {
      errorAlert.textContent = message;
      errorAlert.style.display = 'block';
    }
  }
}

// Create singleton instance
export const MinistryPlatform = new MinistryPlatformModule();