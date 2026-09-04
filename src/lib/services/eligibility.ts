import type { List, ListEntry, Prize, Winner } from '$lib/types';
import { getEntryId } from '$lib/utils/format';

/** One drawable entry, remembering where it came from without mutating the entry itself. */
export interface Candidate {
  entry: ListEntry;
  listId: string;
  listName: string;
  nameConfig: string | undefined;
}

export interface Eligibility {
  candidates: Candidate[];
  /** Entries held back: duplicates across lists, and people who already won this prize. */
  excluded: number;
}

/**
 * Whether a list forbids the same person winning the same prize twice.
 *
 * A list that removes its winners has no need of the rule. A list that keeps them always does —
 * which is why the import wizard forces the flag on in that case. The flag used to be written
 * and never read, so a list configured to keep its winners could hand out the same prize twice.
 */
export function preventsSamePrize(list: List): boolean {
  const listSettings = list.metadata.listSettings;
  if (!listSettings) return false;
  if (!listSettings.removeWinnersFromList) return true;
  return listSettings.preventWinningSamePrize;
}

/**
 * The single definition of who can be drawn.
 *
 * Both the Setup screen's counts and the draw itself call this, so the number an operator reads
 * before pressing play is by construction the number of people the draw actually considers.
 * They used to be two separate walks over the same lists, which is two chances to disagree.
 *
 * Rules, in order:
 *  - an entry with no id always counts, because nothing can be matched against it;
 *  - the same id appearing in two selected lists is one candidate, not two;
 *  - an id that already won this prize is excluded, when the rule applies to its list.
 */
export function buildEligibility(
  lists: List[],
  prize: Prize | undefined,
  winners: Winner[],
  globalPreventSamePrize: boolean
): Eligibility {
  const alreadyWonThisPrize = new Set<string>();
  if (prize) {
    for (const winner of winners) {
      if (winner.prize === prize.name && winner.entryId) alreadyWonThisPrize.add(winner.entryId);
    }
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let excluded = 0;

  for (const list of lists) {
    const enforcesSamePrize = globalPreventSamePrize || preventsSamePrize(list);

    for (const entry of list.entries) {
      const entryId = getEntryId(entry);

      if (entryId) {
        if (seen.has(entryId)) {
          excluded++;
          continue;
        }
        seen.add(entryId);

        if (enforcesSamePrize && alreadyWonThisPrize.has(entryId)) {
          excluded++;
          continue;
        }
      }

      candidates.push({
        entry,
        listId: list.listId,
        listName: list.metadata.name,
        nameConfig: list.metadata.nameConfig
      });
    }
  }

  return { candidates, excluded };
}
