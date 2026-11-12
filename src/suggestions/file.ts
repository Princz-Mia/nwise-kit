import type { SuggestionResult } from './greedy.js';

export const SUGGESTIONS_SCHEMA_VERSION = 1;

/** A suggestions file: the search result with its contract version and producer. */
export type SuggestionsFile = {
  readonly schemaVersion: typeof SUGGESTIONS_SCHEMA_VERSION;
  readonly toolVersion: string;
  readonly kind: 'suggestions';
} & SuggestionResult;

export function createSuggestionsFile(
  result: SuggestionResult,
  toolVersion: string,
): SuggestionsFile {
  return {
    schemaVersion: SUGGESTIONS_SCHEMA_VERSION,
    toolVersion,
    kind: 'suggestions',
    ...result,
  };
}

/** Serialises a suggestions file as indented JSON with a trailing newline. */
export function formatSuggestions(file: SuggestionsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
