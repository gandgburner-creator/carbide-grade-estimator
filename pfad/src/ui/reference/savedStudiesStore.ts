import { parseStudies, serializeStudies, type SavedStudy } from '../../reference/SavedStudies';

/** Saved airfoil studies live in this browser (local storage); they can also be exported to and imported from a file. */
const KEY = 'pfad-cfd-saved-studies';

export function loadSavedStudies(): SavedStudy[] {
  try {
    const t = localStorage.getItem(KEY);
    return t ? parseStudies(t).studies : [];
  } catch {
    return [];
  }
}

/** Store the list; returns null, or what went wrong in words. */
export function storeSavedStudies(list: SavedStudy[]): string | null {
  try {
    localStorage.setItem(KEY, serializeStudies(list));
    return null;
  } catch (e) {
    return `the studies could not be kept in this browser (${(e as Error).message}); export them to a file to keep them`;
  }
}
