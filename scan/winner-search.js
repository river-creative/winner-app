// Winner Search Module - handles lookup by ticket code or winner name
import { Database } from '../src/js/modules/database.js';

export class WinnerSearch {
  /**
   * Check if input matches a ticket code format
   * Supports:
   * - 8-24 alphanumeric (mixed case) (e.g., "HWFXaOUlVT", "abc123def456...")
   * - [A-Z]-[0-9]{5,7} prefix format (e.g., "A-369008", "B-1234567")
   */
  static isTicketCode(input) {
    const alphanumericPattern = /^[a-zA-Z0-9]{8,24}$/;
    const prefixPattern = /^[A-Z]-\d{5,7}$/;
    return alphanumericPattern.test(input) || prefixPattern.test(input);
  }

  /**
   * Check if input matches MP idCard format (for family fallback)
   */
  static isMPIdCard(input) {
    return /^[A-Z]-\d{5,7}$/.test(input);
  }

  /**
   * Search by ticket code (exact match on entryId)
   * Returns single winner with all their prizes, or null if not found
   * If no direct match and idCard is MP format, falls back to family search
   */
  static async findByTicketCode(ticketCode) {
    const winners = await Database.getFromStore('winners');

    const matchingWinners = winners.filter(w => w.entryId === ticketCode);

    if (matchingWinners.length === 0) {
      // No direct match - try family fallback for MP idCards only
      if (this.isMPIdCard(ticketCode)) {
        const familyResults = await this.findFamilyWinners(ticketCode, winners);
        if (familyResults && familyResults.length > 0) {
          return { type: 'familyWinners', scannedIdCard: ticketCode, results: familyResults };
        }
      }
      return null;
    }

    console.log(`Found ${matchingWinners.length} prizes for ticket code: ${ticketCode}`);

    // Verify all matches are for the same person
    const firstWinnerName = matchingWinners[0].displayName;
    const allSamePerson = matchingWinners.every(w => w.displayName === firstWinnerName);

    if (!allSamePerson) {
      console.warn('Warning: Found prizes for different people with same ticket code!');
      // Filter to only show prizes for the first person found
      const filteredWinners = matchingWinners.filter(w => w.displayName === firstWinnerName);
      return this._groupWinnerPrizes(filteredWinners);
    }

    return this._groupWinnerPrizes(matchingWinners);
  }

  /**
   * Find family members who won prizes by looking up household in MP
   * @param {string} idCard - The scanned parent's idCard
   * @param {Array} winners - Pre-loaded winners array (optional, will load if not provided)
   * @returns {Array} Array of family member winner results
   */
  static async findFamilyWinners(idCard, winners = null) {
    try {
      // Call MP API to get family member idCards
      const response = await fetch('/api/mp/family-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idCard })
      });

      const result = await response.json();

      if (!result.success || !result.familyIdCards || result.familyIdCards.length === 0) {
        console.log(`No family members found for ${idCard}`);
        return [];
      }

      console.log(`Found ${result.familyIdCards.length} family members for ${idCard}:`, result.familyIdCards);

      // Load winners if not provided
      if (!winners) {
        winners = await Database.getFromStore('winners');
      }

      // Match family idCards against winners
      const familyWinners = [];
      for (const familyIdCard of result.familyIdCards) {
        const matchingWinners = winners.filter(w =>
          w.entryId === familyIdCard || w.data?.idCard === familyIdCard
        );

        if (matchingWinners.length > 0) {
          const grouped = this._groupWinnerPrizes(matchingWinners);
          familyWinners.push({
            ...grouped,
            prizeCount: grouped.prizes.length,
            pendingCount: grouped.prizes.filter(p => !p.pickedUp).length
          });
        }
      }

      console.log(`Found ${familyWinners.length} family members who won prizes`);
      return familyWinners;

    } catch (error) {
      console.error('Error finding family winners:', error);
      return [];
    }
  }

  /**
   * Search by winner name (case-insensitive partial match)
   * Returns array of unique persons, each with their prizes
   */
  static async findByName(searchTerm) {
    const winners = await Database.getFromStore('winners');
    const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(w => w);

    // Find all winners whose displayName contains ALL search words
    const matchingWinners = winners.filter(w => {
      if (!w.displayName) return false;
      const nameLower = w.displayName.toLowerCase();
      return searchWords.every(word => nameLower.includes(word));
    });

    if (matchingWinners.length === 0) {
      return [];
    }

    console.log(`Found ${matchingWinners.length} prize records matching name: ${searchTerm}`);

    // Group by entryId to get unique persons
    const groupedByPerson = new Map();

    for (const winner of matchingWinners) {
      const key = winner.entryId;
      if (!groupedByPerson.has(key)) {
        groupedByPerson.set(key, []);
      }
      groupedByPerson.get(key).push(winner);
    }

    // Convert to array of person results
    const results = Array.from(groupedByPerson.values()).map(winnerRecords => {
      const grouped = this._groupWinnerPrizes(winnerRecords);
      return {
        ...grouped,
        prizeCount: grouped.prizes.length,
        pendingCount: grouped.prizes.filter(p => !p.pickedUp).length
      };
    });

    // Sort alphabetically by name
    results.sort((a, b) => a.winner.displayName.localeCompare(b.winner.displayName));

    console.log(`Grouped into ${results.length} unique persons`);
    return results;
  }

  /**
   * Auto-detect search type and perform search
   * Returns { type: 'ticketCode' | 'name', results: ... }
   */
  static async search(input) {
    if (!this.isTicketCode(input)) {
      const results = await this.findByName(input);
      return { type: 'name', results };
    }

    const result = await this.findByTicketCode(input);
    if (result) return { type: 'ticketCode', result };

    // A surname is shaped exactly like a ticket code — "Whitmore", "Okonkwo" and
    // "Delacroix" all satisfy isTicketCode()'s 8-24 alphanumeric rule — so a
    // typed name used to be looked up as a code, miss, and tell the operator
    // there was no such winner. A miss now falls through to a name search; only
    // when that misses too is it really "no winner", and the ticketCode type is
    // kept so the alert still quotes what was scanned.
    const byName = await this.findByName(input);
    if (byName.length > 0) return { type: 'name', results: byName };

    return { type: 'ticketCode', result: null };
  }

  /**
   * Helper: Group winner records into { winner, prizes } structure
   */
  static _groupWinnerPrizes(winnerRecords) {
    const representative = winnerRecords[0];
    const prizes = winnerRecords.map(w => ({
      winnerId: w.winnerId,
      prize: w.prize,
      timestamp: w.timestamp,
      pickedUp: w.pickedUp || false,
      pickupTimestamp: w.pickupTimestamp || null,
      pickupStation: w.pickupStation || null
    }));

    return {
      winner: representative,
      prizes: prizes
    };
  }
}
