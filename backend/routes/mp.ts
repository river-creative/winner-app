import express from 'express';
import type { Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { getMPInstance, updateMissingIdCards, type MPInstance } from '../services/mp-service.js';
import { strictLimiter } from '../rate-limits.js';

export const mpRouter = express.Router();

// MinistryPlatform: Get events
mpRouter.post('/mp/events', strictLimiter, async (req: Request, res: Response) => {
  try {
    const { searchTerm, daysPast, daysFuture } = req.body;

    const mp = getMPInstance();
    if (!mp) {
      return res.status(400).json({
        error: 'MinistryPlatform credentials not configured.'
      });
    }

    let filter = '';
    let eventResults: any[] = [];
    const pastDays = daysPast || 7;
    const futureDays = daysFuture || 30;

    const today = new Date();
    const pastDate = new Date();
    pastDate.setDate(today.getDate() - pastDays);
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + futureDays);
    const pastDateStr = pastDate.toISOString().split('T')[0];
    const futureDateStr = futureDate.toISOString().split('T')[0];

    if (searchTerm) {
      filter = `Event_Start_Date >= '${pastDateStr}' AND Event_Start_Date <= '${futureDateStr}' AND Event_Title LIKE '%${searchTerm}%'`;
    } else if (daysPast !== undefined || daysFuture !== undefined) {
      filter = `Event_Start_Date >= '${pastDateStr}' AND Event_Start_Date <= '${futureDateStr}'`;
    }

    if (filter) {
      const options = {
        select: 'Event_ID, Event_Title, Event_Start_Date',
        filter: filter,
        orderBy: 'Event_Start_Date DESC'
      };

      const result = await mp.getEvents(options);

      if (result && 'error' in result) {
        console.error('MP API Error:', result.error);
        const reason = result.error.reason ? ` - ${result.error.reason}` : '';
        throw new Error((result.error.message || 'Failed to fetch events') + reason);
      }

      eventResults = Array.isArray(result) ? result : [];

      if (eventResults && eventResults.length > 0) {
        console.log('Event fields available:', Object.keys(eventResults[0]));
      }
    }

    res.json({
      success: true,
      events: eventResults || [],
      count: eventResults ? eventResults.length : 0
    });

  } catch (error: any) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events: ' + error.message });
  }
});

// MinistryPlatform: Get available queries
mpRouter.get('/mp/queries', async (req: Request, res: Response) => {
  try {
    const mpConfigPath = path.join(DATA_DIR, 'mp.json');
    const mpConfig = await fs.readFile(mpConfigPath, 'utf-8');
    const config = JSON.parse(mpConfig);

    res.json({
      success: true,
      queries: config.map((q: any) => ({
        id: q.id,
        name: q.name,
        description: q.description,
        table: q.table,
        select: q.select,
        filter: q.filter,
        distinct: q.distinct,
        category: q.metadata?.category,
        params: q.params,
        metadata: q.metadata
      }))
    });
  } catch (error: any) {
    console.error('Error reading MP queries:', error);
    res.status(500).json({ error: 'Failed to read MP queries: ' + error.message });
  }
});

// MinistryPlatform: Create new query
mpRouter.post('/mp/queries', async (req: Request, res: Response) => {
  try {
    const newQuery = req.body;

    if (!newQuery.id || !newQuery.name) {
      return res.status(400).json({ success: false, error: 'ID and Name are required' });
    }

    const mpConfigPath = path.join(DATA_DIR, 'mp.json');
    const mpConfig = await fs.readFile(mpConfigPath, 'utf-8');
    const config = JSON.parse(mpConfig);

    // Check if ID already exists
    if (config.find((q: any) => q.id === newQuery.id)) {
      return res.status(400).json({ success: false, error: 'Query with this ID already exists' });
    }

    // Add the new query
    config.push(newQuery);

    // Save back to file
    await fs.writeFile(mpConfigPath, JSON.stringify(config, null, 2));

    res.json({ success: true, query: newQuery });
  } catch (error: any) {
    console.error('Error creating MP query:', error);
    res.status(500).json({ success: false, error: 'Failed to create query: ' + error.message });
  }
});

// MinistryPlatform: Update query
mpRouter.put('/mp/queries/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updatedQuery = req.body;

    const mpConfigPath = path.join(DATA_DIR, 'mp.json');
    const mpConfig = await fs.readFile(mpConfigPath, 'utf-8');
    const config = JSON.parse(mpConfig);

    const index = config.findIndex((q: any) => q.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Query not found' });
    }

    // Update the query
    config[index] = { ...config[index], ...updatedQuery };

    // Save back to file
    await fs.writeFile(mpConfigPath, JSON.stringify(config, null, 2));

    res.json({ success: true, query: config[index] });
  } catch (error: any) {
    console.error('Error updating MP query:', error);
    res.status(500).json({ success: false, error: 'Failed to update query: ' + error.message });
  }
});

// MinistryPlatform: Delete query
mpRouter.delete('/mp/queries/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const mpConfigPath = path.join(DATA_DIR, 'mp.json');
    const mpConfig = await fs.readFile(mpConfigPath, 'utf-8');
    const config = JSON.parse(mpConfig);

    const index = config.findIndex((q: any) => q.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Query not found' });
    }

    // Remove the query
    config.splice(index, 1);

    // Save back to file
    await fs.writeFile(mpConfigPath, JSON.stringify(config, null, 2));

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting MP query:', error);
    res.status(500).json({ success: false, error: 'Failed to delete query: ' + error.message });
  }
});

// MinistryPlatform: Get family members by idCard (for scanner fallback)
mpRouter.post('/mp/family-members', strictLimiter, async (req: Request, res: Response) => {
  try {
    const { idCard } = req.body;

    // Validate idCard format (A-XXXXXX)
    const idCardPattern = /^[A-Z]-\d{5,7}$/;
    if (!idCard || !idCardPattern.test(idCard)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid idCard format. Expected format: A-123456'
      });
    }

    const mp = getMPInstance();
    if (!mp) {
      return res.status(400).json({
        success: false,
        error: 'MinistryPlatform credentials not configured.'
      });
    }

    // Step 1: Get the contact's Household_ID by their ID_Card
    const contactResult = await mp.getContacts({
      select: 'Contact_ID, Household_ID, ID_Card',
      filter: `ID_Card = '${idCard}'`
    });

    if ('error' in contactResult) {
      throw new Error(contactResult.error.message || 'Failed to fetch contact');
    }

    if (!Array.isArray(contactResult) || contactResult.length === 0) {
      return res.json({
        success: true,
        familyIdCards: [],
        message: 'Contact not found'
      });
    }

    const contact = contactResult[0];
    const householdId = contact.householdID;
    const contactId = contact.contactID;

    if (!householdId) {
      return res.json({
        success: true,
        familyIdCards: [],
        message: 'Contact has no household'
      });
    }

    // Step 2: Get all contacts in the same household (excluding the scanned contact)
    const householdMembers = await mp.getContacts({
      select: 'Contact_ID, ID_Card, Display_Name',
      filter: `Household_ID = ${householdId} AND Contact_ID != ${contactId}`
    });

    if ('error' in householdMembers) {
      throw new Error(householdMembers.error.message || 'Failed to fetch household members');
    }

    // Step 3: Extract idCards (generate if missing)
    const familyIdCards: string[] = [];
    if (Array.isArray(householdMembers)) {
      for (const member of householdMembers) {
        const memberIdCard = member.idCard || `A-${member.contactID}`;
        familyIdCards.push(memberIdCard);
      }
    }

    console.log(`Family lookup for ${idCard}: found ${familyIdCards.length} family members in household ${householdId}`);

    res.json({
      success: true,
      familyIdCards,
      householdId,
      scannedContactId: contactId
    });

  } catch (error: any) {
    console.error('Error fetching family members:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch family members: ' + error.message
    });
  }
});

// Helper: Fetch parent (Head of Household) phones by household IDs
async function fetchParentPhones(mp: MPInstance, householdIds: number[]): Promise<Map<number, string>> {
  const parentPhoneMap = new Map<number, string>();

  if (householdIds.length === 0) return parentPhoneMap;

  const idsString = householdIds.join(',');
  const result = await mp.getContacts({
    select: 'Household_ID, Mobile_Phone',
    filter: `Household_ID IN (${idsString}) AND Household_Position_ID = 1`
  });

  if ('error' in result) {
    console.error('Failed to fetch parent phones:', result.error);
    return parentPhoneMap;
  }

  if (Array.isArray(result)) {
    for (const contact of result) {
      const householdId = contact.householdID;
      const phone = contact.mobilePhone;
      if (householdId && phone) {
        parentPhoneMap.set(householdId, phone);
      }
    }
  }

  console.log(`Fetched ${parentPhoneMap.size} parent phones for ${householdIds.length} households`);
  return parentPhoneMap;
}

// MinistryPlatform: Execute query
mpRouter.post('/mp/execute', strictLimiter, async (req: Request, res: Response) => {
  try {
    const { queryId, params } = req.body;

    const mpConfigPath = path.join(DATA_DIR, 'mp.json');
    const mpConfig = await fs.readFile(mpConfigPath, 'utf-8');
    const config = JSON.parse(mpConfig);

    const query = config.find((q: any) => q.id === queryId);
    if (!query) {
      return res.status(404).json({ error: `Query '${queryId}' not found` });
    }

    const mp = getMPInstance();
    if (!mp) {
      return res.status(400).json({
        error: 'MinistryPlatform credentials not configured. Please add MP_USERNAME and MP_PASSWORD to .env file.'
      });
    }

    let filter = query.filter || '';
    if (query.params) {
      for (const [key, paramConfig] of Object.entries(query.params as Record<string, any>)) {
        const value = params && params[key] ? params[key] : '';

        if (value) {
          filter = filter.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
          console.log(`Replaced {{${key}}} with: ${value}`);
        } else if (paramConfig.required) {
          return res.status(400).json({
            error: `Missing required parameter: ${key}`,
            details: `The query requires ${paramConfig.label || key} to be provided`
          });
        }
      }
    }

    const tableName = query.table;
    const camelCaseTable = tableName.replace(/_([a-z])/gi, (match: string, letter: string) => letter.toUpperCase());
    const methodName = `get${camelCaseTable}` as keyof MPInstance;

    console.log(`Table: ${tableName}, Method: ${methodName}`);

    const mpMethod = mp[methodName] as any;
    if (typeof mpMethod !== 'function') {
      return res.status(400).json({ error: `Invalid table name: ${tableName} (method: ${methodName})` });
    }

    const queryOptions: any = {};
    if (query.select) queryOptions.select = query.select;
    if (filter) queryOptions.filter = filter;
    if (query.distinct) queryOptions.distinct = true;

    console.log(`Executing MP query: ${queryId}`, queryOptions);

    const results = await mpMethod(queryOptions);

    if ('error' in results) {
      console.error('MP API Error:', results.error);
      const errorMessage = results.error.message || 'Unknown error';
      const reason = results.error.reason ? ` - ${results.error.reason}` : '';
      return res.status(500).json({ error: `MP API Error: ${errorMessage}${reason}` });
    }

    const rawData = Array.isArray(results) ? results : [];

    // De-duplicate results by contactId (keep first occurrence)
    const seenContactIds = new Set<number>();
    const data = rawData.filter((record: any) => {
      const contactId = record.contactId || record.contactID;
      if (!contactId || seenContactIds.has(contactId)) {
        return false;
      }
      seenContactIds.add(contactId);
      return true;
    });

    if (rawData.length !== data.length) {
      console.log(`De-duplicated results: ${rawData.length} -> ${data.length} (removed ${rawData.length - data.length} duplicates)`);
    }

    // Process records with missing idCard
    const recordsToUpdate: Array<{ contactID: number; idCard: string; }> = [];

    for (const record of data) {
      if ('idCard' in record && (record.idCard === null || record.idCard === '')) {
        const contactId = record.contactId || record.contactID;
        if (contactId) {
          const generatedIdCard = `A-${contactId}`;
          record.idCard = generatedIdCard;
          recordsToUpdate.push({ contactID: Number(contactId), idCard: generatedIdCard });
        } else {
          console.warn('Record missing contactId, cannot generate idCard:', record);
        }
      }
    }

    if (recordsToUpdate.length > 0) {
      updateMissingIdCards(mp, recordsToUpdate).catch(err => {
        console.error('Background idCard update failed:', err);
      });
    }

    // Fetch parent phones if enabled in query config
    if (query.fetchParentPhone) {
      const householdIds = [...new Set(
        data
          .map((r: any) => r.householdID || r.householdId)
          .filter((id: any): id is number => typeof id === 'number')
      )];

      if (householdIds.length > 0) {
        const parentPhoneMap = await fetchParentPhones(mp, householdIds);
        for (const record of data) {
          const householdId = record.householdID || record.householdId;
          if (householdId && parentPhoneMap.has(householdId)) {
            record.parentPhone = parentPhoneMap.get(householdId);
            // Use parentPhone as mobilePhone if mobilePhone is empty
            if (!record.mobilePhone) {
              record.mobilePhone = record.parentPhone;
            }
          }
        }
      }
    }

    res.json({
      success: true,
      data: data,
      count: data.length
    });

  } catch (error: any) {
    console.error('Error executing MP query:', error);
    res.status(500).json({ error: 'Failed to execute MP query: ' + error.message });
  }
});
