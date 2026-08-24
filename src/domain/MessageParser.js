import { CommandType } from './CommandType.js';

/**
 * Parses raw input text from chat or CLI into structured command intents.
 */
export class MessageParser {
  /**
   * Parses raw text into a ParsedCommand object.
   * @param {string} text 
   * @returns {Object} Parsed command object
   */
  static parse(text) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return {
        command: 'unknown',
        type: CommandType.UNKNOWN,
        raw: text || '',
        payload: { rawText: text || '' },
        isValid: false,
        error: 'Empty or invalid message text'
      };
    }

    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // 1. Help Commands

    // 0. Avvia/Ferma Legacy Commands
    const cleanLower = lower.startsWith('/') ? lower.substring(1).trim() : lower;

    if (lower === '/avvia' || lower === '/ferma') {
      return {
        command: 'legacy_toggle',
        type: CommandType.HELP,
        raw: text,
        payload: { rawText: trimmed },
        isValid: true
      };
    }

    if (['help', 'aiuto', '?', 'info'].includes(cleanLower)) {
      return {
        command: 'help',
        type: CommandType.HELP,
        raw: text,
        payload: { rawText: trimmed },
        isValid: true
      };
    }

    // 2. Query List Commands
    if (
      ['list', 'lista', 'mostra', 'mostra lista', 'show list', 'shopping list'].includes(cleanLower) ||
      cleanLower.startsWith('lista supermercat') ||
      cleanLower.startsWith('lista per supermercat') ||
      cleanLower.startsWith('list store') ||
      cleanLower.startsWith('list by store') ||
      cleanLower.startsWith('mostra supermercat')
    ) {
      return {
        command: 'list',
        type: CommandType.GET_LIST,
        raw: text,
        payload: { rawText: trimmed },
        isValid: true
      };
    }

    // 3. Query Habits Commands
    if (['habits', 'abitudini', 'preferenze', 'statistiche', 'stats'].includes(cleanLower)) {
      return {
        command: 'habits',
        type: CommandType.GET_HABITS,
        raw: text,
        payload: { rawText: trimmed },
        isValid: true
      };
    }

    if (cleanLower.startsWith('habits ') || cleanLower.startsWith('abitudini ') || cleanLower.startsWith('preferenze ')) {
      const spaceIdx = trimmed.indexOf(' ');
      const item = trimmed.substring(spaceIdx + 1).trim();
      return {
        command: 'habits',
        type: CommandType.GET_HABITS,
        item: item,
        raw: text,
        payload: { itemName: item, rawText: trimmed },
        isValid: true
      };
    }

    // 4. Reset Command
    if (cleanLower === 'reset' || cleanLower.startsWith('reset ') || cleanLower === 'svuota' || cleanLower.startsWith('svuota ')) {
      if (cleanLower === 'reset' || cleanLower === 'svuota') {
        return {
          command: 'reset',
          type: CommandType.RESET_LIST,
          store: undefined,
          raw: text,
          payload: { storeName: null, rawText: trimmed },
          isValid: true
        };
      }

      const rest = trimmed.replace(/^\/?(?:reset|svuota)\s+/i, '').trim();
      // Strip optional leading prepositions (@, at, da, in, -)
      const cleanStore = rest.replace(/^(@|at|da|in|-)\s+/i, '').trim();
      
      return {
        command: 'reset',
        type: CommandType.RESET_LIST,
        store: cleanStore || undefined,
        raw: text,
        payload: { storeName: cleanStore || null, rawText: trimmed },
        isValid: true
      };
    }

    // 5. Add Item Command
    const addPayload = MessageParser._parseAddItem(trimmed);
    return {
      command: 'add',
      type: CommandType.ADD_ITEM,
      item: addPayload.itemName,
      store: addPayload.storeName || undefined,
      raw: text,
      payload: {
        itemName: addPayload.itemName,
        storeName: addPayload.storeName || null,
        rawText: trimmed
      },
      isValid: true
    };
  }

  /**
   * Internal helper to extract item and store from add item input.
   * @param {string} text 
   * @returns {{ itemName: string, storeName: string|null }}
   * @private
   */
  static _parseAddItem(text) {
    // Explicit delimiter check (@, at, da, in, -)
    const delimiterRegex = /\s+(@|at|da|in|-)\s+/i;
    const match = text.match(delimiterRegex);

    if (match) {
      const splitIdx = match.index;
      const itemName = text.slice(0, splitIdx).trim();
      const storeName = text.slice(splitIdx + match[0].length).trim();
      return { itemName, storeName: storeName || null };
    }

    // Multi-word heuristic
    const tokens = text.split(/\s+/);
    if (tokens.length === 2) {
      return {
        itemName: tokens[0],
        storeName: tokens[1]
      };
    }

    if (tokens.length > 2) {
      // Check if last word is store candidate
      const potentialStore = tokens[tokens.length - 1];
      const potentialItem = tokens.slice(0, tokens.length - 1).join(' ');
      // If store is separated or obvious
      return {
        itemName: potentialItem,
        storeName: potentialStore
      };
    }

    return {
      itemName: text,
      storeName: null
    };
  }
}
