/**
 * Normalizes item names for case-insensitive, whitespace-trimmed, and emoji/status-tolerant comparison.
 * Removes leading emoji/status markers (e.g. 🔴, ✅, ⚠️, ⏳, bullet points, etc.) and collapses internal whitespace.
 * @param {string} str
 * @returns {string}
 */
export function normalizeForComparison(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/^[\s🔴✅⏳⚠️*~•\-_]+\s*/u, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Parses numeric indices from a query string with arbitrary separators.
 * Supports: "1,2,3", "1 2 3", "1/2/3", "1;3;4", "1-3", "1 | 2", etc.
 * Returns an array of unique integers, or an empty array if the string contains non-numeric tokens.
 * @param {string} str
 * @returns {number[]}
 */
export function parseNumericIndices(str) {
  if (!str || typeof str !== 'string') return [];
  const trimmed = str.trim();
  if (!trimmed) return [];

  // If the query contains any letters or non-separator characters, it's not a pure numeric index query
  if (!/^[\d\s,;/|\\\-+]+$/.test(trimmed)) {
    return [];
  }

  const indices = [];
  const seen = new Set();
  const tokens = trimmed.split(/[,;/|\\\s]+/).filter(Boolean);

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start <= end && (end - start) < 100) {
        for (let i = start; i <= end; i++) {
          if (!seen.has(i)) {
            seen.add(i);
            indices.push(i);
          }
        }
      } else {
        if (!seen.has(start)) { seen.add(start); indices.push(start); }
        if (!seen.has(end)) { seen.add(end); indices.push(end); }
      }
    } else {
      const num = parseInt(token, 10);
      if (!isNaN(num) && !seen.has(num)) {
        seen.add(num);
        indices.push(num);
      }
    }
  }

  return indices;
}
