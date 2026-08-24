import { CommandType } from './CommandType.js';

export class MessageParser {
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

  static _parseAddItem(text) {
    let rawText = text;
    let isUrgent = false;

    // Check for "urgente" anywhere in the string (case insensitive)
    const urgentRegex = /\burgente\b/i;
    if (urgentRegex.test(rawText)) {
      isUrgent = true;
      rawText = rawText.replace(urgentRegex, '').replace(/\s{2,}/g, ' ').trim();
    }

    // Explicit delimiter check (@, at, da, in, -)
    const delimiterRegex = /\s+(@|at|da|in|-)\s+/i;
    const match = rawText.match(delimiterRegex);

    let itemName = rawText;
    let storeName = null;

    if (match) {
      const splitIdx = match.index;
      itemName = rawText.slice(0, splitIdx).trim();
      storeName = rawText.slice(splitIdx + match[0].length).trim();
    }

    if (isUrgent) {
      itemName = `🔴 ${itemName}`;
    }

    return { itemName, storeName: storeName || null };
  }
}
