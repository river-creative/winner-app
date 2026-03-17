/**
 * SMS Texting Module for Winner Notifications
 * Integrates with Texting API
 */

import { Database } from './database.js';
import { UI } from './ui.js';
import { getCurrentWinners } from '../app.js';
import { settings } from './settings.js';
import { Templates } from './templates.js';


// Internal class (not exported)
class TextingService {
  constructor() {
    this.sendingInProgress = false;
    this.abortController = null;
  }

  /**
   * Makes a POST request to the Texting API (fire-and-forget)
   * Returns immediately after sending, doesn't wait for response
   */
  makeRequestFireAndForget(body, winnerId = null) {
    // API base path - use relative path to work from any base URL
    const apiBase = './api';
    
    // Fire the request without awaiting
    fetch(`${apiBase}/texting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    })
    .then(async response => {
      let result = null;
      try {
        // Try to parse JSON response
        const text = await response.text();
        if (text) {
          result = JSON.parse(text);
        }
      } catch (e) {
        console.warn('Could not parse SMS response:', e);
      }

      if (winnerId) {
        // Extract messageId from response
        const messageId = result?.data?.id || null;

        // Update winner record with minimal SMS data (optimized structure)
        const smsUpdateData = {
          status: 'queued',
          messageId: messageId,
          sentAt: Date.now()
        };
        
        // Only add error if response is not ok
        if (!response.ok) {
          smsUpdateData.error = result?.error || `HTTP ${response.status}`;
        }
        
        await this.updateWinnerSMSStatus(winnerId, smsUpdateData);
        
        // If we have a messageId, schedule status check
        if (messageId) {
          // Check status after 30 seconds
          setTimeout(() => this.checkMessageStatus(winnerId, messageId), 30000);
        }
      }
      return result;
    })
    .catch(async error => {
      console.error('SMS send error:', error);
      if (winnerId) {
        await this.updateWinnerSMSStatus(winnerId, {
          status: 'failed',
          sentAt: Date.now(),
          error: error.message
        });
      }
    });
  }

  /**
   * Makes a POST request to the Texting API (awaitable)
   */
  async makeRequest(body) {
    // API base path - use relative path to work from any base URL
    const apiBase = './api';
    
    const response = await fetch(`${apiBase}/texting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }


  /**
   * Sends SMS to multiple recipients with fire-and-forget pattern
   */
  async sendBatchTexts(recipients, messageTemplate, options = {}) {
    const results = {
      successful: [],
      failed: [],
      total: recipients.length,
      sent: 0,
      pending: recipients.length
    };

    // Track SMS status immediately
    let sent = 0;
    
    // Process recipients
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      
      // Check if cancelled
      if (this.abortController?.signal.aborted) {
        if (recipient.winnerId) {
          // Fire and forget - don't await
          this.updateWinnerSMSStatus(recipient.winnerId, {
            status: 'cancelled',
            sentAt: Date.now(),
            error: 'Cancelled'
          });
        }
        continue;
      }

      // Check if recipient has a phone number
      if (!recipient.phone) {
        results.failed.push({
          recipient,
          error: 'No phone number'
        });
        if (recipient.winnerId) {
          // Fire and forget - don't await
          this.updateWinnerSMSStatus(recipient.winnerId, {
            status: 'failed',
            sentAt: Date.now(),
            error: 'No phone number'
          });
        }
        continue;
      }

      // Use recipient's specific template or fall back to the provided template
      const templateToUse = recipient.messageTemplate || messageTemplate;
      if (!templateToUse) {
        console.error('No message template for recipient:', recipient);
        continue;
      }
      
      // Personalize message with all available placeholders
      let personalizedMessage = templateToUse;
      
      // Replace standard placeholders
      personalizedMessage = personalizedMessage.replace(/{name}/g, recipient.displayName || recipient.name || 'Winner');
      personalizedMessage = personalizedMessage.replace(/{firstName}/g, recipient.firstName || recipient.displayName || recipient.name || 'Winner');
      personalizedMessage = personalizedMessage.replace(/{prize}/g, recipient.prize || 'your prize');
      personalizedMessage = personalizedMessage.replace(/{ticketCode}/g, recipient.ticketCode || recipient.data?.ticketCode || recipient.winnerId || '');
      
      // Replace all CSV column placeholders from recipient.data
      if (recipient.data) {
        // Use regex to find all placeholders in the message
        const placeholderRegex = /{([^}]+)}/g;
        personalizedMessage = personalizedMessage.replace(placeholderRegex, (match, key) => {
          // Try to find the value in recipient.data
          if (recipient.data[key]) {
            return recipient.data[key];
          }
          // If not found, check if it's one of the standard placeholders we already handled
          if (key === 'name' || key === 'firstName' || key === 'prize' || key === 'ticketCode') {
            return match; // Already handled above
          }
          // Return the placeholder unchanged if no value found
          return match;
        });
      }

      // Fire-and-forget using backend queueAndSend for server-side tracking
      this.makeRequestFireAndForget({
        action: 'queueAndSend',
        data: {
          winnerId: recipient.winnerId,
          phoneNumber: recipient.phone,
          message: personalizedMessage
        }
      });

      sent++;
      results.sent = sent;
      results.pending = recipients.length - sent;

      // Small delay between requests (20ms = 50 requests per second max)
      await this.delay(20);
    }

    // Update final stats
    results.sent = sent;
    UI.showToast(`SMS messages dispatched: ${sent}`, 'success');
    
    return results;
  }

  /**
   * Batch update queue for SMS status updates
   */
  smsUpdateQueue = [];
  smsUpdateTimer = null;

  /**
   * Process batched SMS status updates
   */
  async processSMSUpdateQueue() {
    if (this.smsUpdateQueue.length === 0) return;
    
    const updates = [...this.smsUpdateQueue];
    this.smsUpdateQueue = [];
    
    try {
      // Get all winners in a single batch request
      const winnerIds = [...new Set(updates.map(u => u.winnerId))];
      const batchResults = await Database.batchFetch([
        { collection: 'winners' }
      ]);
      const allWinners = batchResults.winners || [];
      
      // Process each update
      const operations = [];
      const missingWinners = [];
      for (const update of updates) {
        const winner = allWinners.find(w => w.winnerId === update.winnerId);
        if (winner) {
          // Apply SMS data updates
          if (!winner.sms) winner.sms = {};
          Object.assign(winner.sms, update.smsData);
          
          operations.push({ collection: 'winners', data: winner });
        } else {
          // Track missing winners but don't fail
          missingWinners.push(update.winnerId);
        }
      }
      
      if (missingWinners.length > 0) {
        console.warn(`SMS status update skipped for ${missingWinners.length} missing winners:`, missingWinners);
      }
      
      // Batch save all updates
      if (operations.length > 0) {
        await Database.batchSave(operations);
      }
    } catch (error) {
      console.error('Error processing SMS update queue:', error);
    }
  }

  /**
   * Updates winner record with SMS status (batched)
   */
  async updateWinnerSMSStatus(winnerId, smsData) {
    // Add to queue
    this.smsUpdateQueue.push({ winnerId, smsData });
    
    // Clear existing timer
    if (this.smsUpdateTimer) {
      clearTimeout(this.smsUpdateTimer);
    }
    
    // Set timer to process queue after 100ms of inactivity
    this.smsUpdateTimer = setTimeout(() => {
      this.processSMSUpdateQueue();
    }, 100);
    
    // For immediate updates in current winners (UI responsiveness)
    try {
      const currentWinners = getCurrentWinners();
      const winner = currentWinners.find(w => w.winnerId === winnerId);
      
      if (winner) {
        // Update in-memory winner for immediate UI feedback
        if (!winner.sms) winner.sms = {};
        Object.assign(winner.sms, smsData);
      }
    } catch (error) {
      console.error('Error updating winner SMS status:', error);
    }
  }

  /**
   * Sends SMS to current winners (the ones just selected)
   */
  async sendToCurrentWinners() {
    if (this.sendingInProgress) {
      UI.showToast('Already sending messages. Please wait...', 'warning');
      return;
    }

    const currentWinners = getCurrentWinners();
    
    if (!currentWinners || currentWinners.length === 0) {
      UI.showToast('No current winners to send messages to.', 'warning');
      return;
    }


    // Get templates for prize-specific messages
    const templates = await Templates.loadTemplates();
    const defaultTemplate = templates.find(t => t.isDefault);
    
    if (!defaultTemplate && templates.length === 0) {
      UI.showToast('No SMS templates found. Please create a template in the Templates tab.', 'warning');
      return;
    }

    this.sendingInProgress = true;

    try {
      // Find winners with phone numbers
      const winnersWithPhone = currentWinners.filter(winner => {
        // Check if winner has phone data in the standard data object
        if (winner.data) {
          // Check standard field name first, then common variations (including mobilePhone)
          return !!(winner.data.phoneNumber || winner.data.phone || winner.data.mobile || 
                    winner.data.mobilePhone || winner.data.cellPhone || winner.data.cell || 
                    winner.data.telephone || winner.data.Phone || winner.data.Mobile || 
                    winner.data.MobilePhone || winner.data.CellPhone);
        }
        return false;
      });

      if (winnersWithPhone.length === 0) {
        UI.showToast('No winners with phone numbers found', 'warning');
        return;
      }

      // Load prizes to get template mappings
      const prizes = await Database.getFromStore('prizes');
      
      // Send messages asynchronously with proper rate limiting
      const results = await this.sendBatchTexts(
        winnersWithPhone.map(winner => {
          // Get phone number from the standard data object (phoneNumber is preferred)
          const phone = winner.data && (
            winner.data.phoneNumber || winner.data.phone || winner.data.mobile || 
            winner.data.mobilePhone || winner.data.cellPhone || winner.data.cell || 
            winner.data.telephone || winner.data.Phone || winner.data.Mobile || 
            winner.data.MobilePhone || winner.data.CellPhone
          );
          
          // Find the prize and its template
          const prize = prizes.find(p => p.name === winner.prize);
          let templateMessage = defaultTemplate?.message;
          
          if (prize?.templateId) {
            const prizeTemplate = templates.find(t => t.templateId === prize.templateId);
            if (prizeTemplate) {
              templateMessage = prizeTemplate.message;
            }
          }
          
          return {
            ...winner,
            phone: this.cleanPhoneNumber(phone),
            messageTemplate: templateMessage
          };
        }),
        null // No single message template since each winner may have their own
      );
      
      // Ensure all SMS status updates are saved before finishing
      await this.processSMSUpdateQueue();
      
      // If at least one SMS was sent successfully, mark the lastAction as having SMS sent
      if (results && results.sent > 0) {
        const { getLastAction, setLastAction } = await import('../app.js');
        const lastAction = getLastAction();
        if (lastAction) {
          lastAction.smsSent = true;
          lastAction.smsSentCount = results.sent;
          lastAction.smsSentAt = Date.now();
          setLastAction(lastAction);
        }
      }

    } catch (error) {
      UI.showToast('Error sending messages: ' + error.message, 'error');
    } finally {
      // Ensure any pending updates are processed
      await this.processSMSUpdateQueue();
      this.sendingInProgress = false;
    }
  }




  /**
   * Shows results of bulk send operation
   */
  showSendResults(results) {
    // Use Alpine viewModal component
    if (window.alpineViewModal) {
      window.alpineViewModal.showSmsResults(results);
    } else {
      console.error('Alpine viewModal not initialized');
    }
  }

  /**
   * Logs SMS send event to database
   */
  async logSendEvent(results, messageTemplate) {
    try {
      const logEntry = {
        timestamp: Date.now(),
        type: 'sms_bulk_send',
        message: messageTemplate,
        results: {
          total: results.total,
          successful: results.successful.length,
          failed: results.failed.length
        },
        date: new Date().toISOString()
      };

      await Database.saveToStore('sms_logs', logEntry);
    } catch (error) {
      console.error('Error logging SMS event:', error);
    }
  }

  /**
   * Cleans and validates phone number
   */
  cleanPhoneNumber(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters
    const cleaned = String(phone).replace(/\D/g, '');
    
    // Add country code if missing (assuming US)
    if (cleaned.length === 10) {
      return '1' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Check message status using Texting API
   */
  async checkMessageStatus(winnerId, messageId) {
    try {
      // API base path - use relative path to work from any base URL
      const apiBase = './api';
      
      console.log('Checking message status for:', { winnerId, messageId, url: `${apiBase}/texting` });
      
      const response = await fetch(`${apiBase}/texting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'getMessageReport',
          data: {
            messageId: messageId
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to get message status: HTTP ${response.status}`);
      }

      const result = await response.json();
      
      // Extract status from the response
      let status = 'unknown';
      let deliveryInfo = {};
      
      if (result?.data?.delivery) {
        // The API returns message report data with delivery stats
        const delivery = result.data.delivery;
        
        // Determine status based on delivery data
        if (delivery.total_delivered?.data > 0) {
          status = 'delivered';
          deliveryInfo.deliveredAt = Date.now();
        } else if (delivery.bounced?.data > 0) {
          status = 'bounced';
          deliveryInfo.bouncedAt = Date.now();
          deliveryInfo.error = 'Message bounced';
        } else if (delivery.total_not_sent?.data > 0) {
          status = 'failed';
          deliveryInfo.failedAt = Date.now();
          deliveryInfo.error = 'Message not sent';
        } else if (delivery.queued?.data > 0) {
          status = 'queued';
        } else {
          status = 'sent';
        }
        
        // Don't store full delivery report - just extract what we need
        // This saves ~1KB per winner record
        
        // Check for engagement actions (only store if true)
        if (result.data.engagement) {
          if (result.data.engagement.opted_out?.data > 0) {
            deliveryInfo.optedOut = true;
            deliveryInfo.optedOutAt = Date.now();
          }
          if (result.data.engagement.replied?.data > 0) {
            deliveryInfo.replied = true;
            deliveryInfo.repliedAt = Date.now();
          }
        }
      }
      
      // Update winner record with delivery status
      await this.updateWinnerSMSStatus(winnerId, {
        status: status,
        ...deliveryInfo,
        lastChecked: Date.now()
      });
      
      // If still queued or unknown, check again later
      if (status === 'queued' || status === 'unknown') {
        // Check again in 10 seconds for queued, 30 seconds for unknown
        const delay = status === 'queued' ? 10000 : 30000;
        setTimeout(() => this.checkMessageStatus(winnerId, messageId), delay);
      }
      
    } catch (error) {
      console.error('Error checking message status:', error);
      // Try again in 30 seconds if there was an error
      setTimeout(() => this.checkMessageStatus(winnerId, messageId), 30000);
    }
  }

  /**
   * Process pending SMS jobs via backend scheduler
   */
  async checkAllPendingStatuses() {
    try {
      const result = await this.makeRequest({
        action: 'processQueue',
        data: {}
      });
      console.log(`Backend processed ${result.processed} pending jobs`);
      return result.processed;
    } catch (error) {
      console.error('Error processing queue:', error);
      throw error;
    }
  }

  /**
   * Get job statistics from backend
   */
  async getJobStats() {
    try {
      return await this.makeRequest({
        action: 'getJobStats',
        data: {}
      });
    } catch (error) {
      console.error('Error getting job stats:', error);
      throw error;
    }
  }

  /**
   * Mark stuck messages (queued with no messageId) as 'sent' since we can't verify them
   */
  async markUntrackableAsSent() {
    try {
      const winners = await Database.getFromStore('winners');

      // Find winners with queued status but no messageId
      const stuckWinners = winners.filter(w =>
        w.sms &&
        !w.sms.messageId &&
        (w.sms.status === 'queued' || w.sms.status === 'sending' || w.sms.status === 'pending')
      );

      console.log(`Found ${stuckWinners.length} stuck messages without messageId`);

      if (stuckWinners.length === 0) {
        return 0;
      }

      // Update each stuck winner
      const operations = [];
      for (const winner of stuckWinners) {
        winner.sms.status = 'sent';
        winner.sms.unverified = true;
        winner.sms.note = 'Marked as sent - no messageId available for delivery tracking';
        operations.push({ collection: 'winners', data: winner });
      }

      await Database.batchSave(operations);
      console.log(`Marked ${stuckWinners.length} messages as 'sent' (unverified)`);

      return stuckWinners.length;
    } catch (error) {
      console.error('Error marking untrackable messages:', error);
      throw error;
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cancels ongoing send operation
   */
  cancelSending() {
    if (this.abortController) {
      this.abortController.abort();
      UI.showToast('Sending cancelled', 'info');
    }
  }
  
  /**
   * Abort sending SMS messages
   * Alias for cancelSending that also hides the progress bar
   */
  abortSending() {
    this.sendingInProgress = false;
    this.cancelSending();
    // Progress bar removed - no longer hiding progress
  }


  /**
   * Gets SMS sending statistics
   */
  async getStats() {
    try {
      const logs = await Database.getAllFromStore('sms_logs');
      
      const stats = {
        totalSent: 0,
        totalFailed: 0,
        lastSent: null
      };

      logs.forEach(log => {
        if (log.type === 'sms_bulk_send') {
          stats.totalSent += log.results.successful;
          stats.totalFailed += log.results.failed;
          if (!stats.lastSent || log.timestamp > stats.lastSent) {
            stats.lastSent = log.timestamp;
          }
        }
      });

      return stats;
    } catch (error) {
      console.error('Error getting SMS stats:', error);
      return null;
    }
  }
}

// Create singleton instance
const textingInstance = new TextingService();

// Export as object with methods (standard pattern)
export const Texting = {
  sendWinnerSMS: (winner) => textingInstance.sendWinnerSMS(winner),
  sendBulkWinnerSMS: (winners) => textingInstance.sendBulkWinnerSMS(winners),
  sendCurrentWinnersSMS: () => textingInstance.sendCurrentWinnersSMS(),
  sendToCurrentWinners: () => textingInstance.sendToCurrentWinners(),
  checkAllPendingStatuses: () => textingInstance.checkAllPendingStatuses(),
  markUntrackableAsSent: () => textingInstance.markUntrackableAsSent(),
  getJobStats: () => textingInstance.getJobStats(),
  abortSending: () => textingInstance.abortSending(),
  getSMSStats: (messageId) => textingInstance.getSMSStats(messageId),
  showSMSDialog: () => textingInstance.showSMSDialog(),
  // Expose state getters if needed
  get sendingInProgress() { return textingInstance.sendingInProgress; }
};

// Make available globally for debugging
window.Texting = Texting;

// Simple test function
window.testSMS = () => {
  // Set mock current winners
  window.setCurrentWinners([{
    name: 'Test Winner',
    displayName: 'Test Winner',
    phone: '5551234567',
    prize: 'Test Prize',
    ticketCode: 'TEST123'
  }]);
  
  // Show SMS button
  const btn = document.getElementById('sendSMSBtn');
  if (btn) {
    btn.classList.remove('d-none');
    console.log('SMS button should now be visible. Click it to test.');
  }
};

