const fs = require('fs');
const file = 'src/domain/MessageParser.js';
let content = fs.readFileSync(file, 'utf8');

const helpBlock = `    if (['help', 'aiuto', '?', 'info'].includes(lower)) {`;
const avviaBlock = `
    // 0. Avvia/Ferma Legacy Commands
    if (lower === '/avvia' || lower === '/ferma') {
      return {
        command: 'legacy_toggle',
        type: CommandType.HELP,
        raw: text,
        payload: { rawText: trimmed },
        isValid: true
      };
    }

    if (['help', 'aiuto', '?', 'info'].includes(lower)) {`;

content = content.replace(helpBlock, avviaBlock);
fs.writeFileSync(file, content);

const clientFile = 'src/whatsapp/whatsappClient.js';
let clientContent = fs.readFileSync(clientFile, 'utf8');

const helpHandleBlock = `      if (parsed.command === 'help') {`;
const avviaHandleBlock = `      if (parsed.command === 'legacy_toggle') {
        response = '🟢 *Novità!* Il bot è stato aggiornato ed è ora **SEMPRE ATTIVO**.\\nNon c\\'è più bisogno di scrivere /avvia o /ferma.\\nScrivi semplicemente il nome del prodotto per aggiungerlo alla lista!';
      } else if (parsed.command === 'help') {`;

clientContent = clientContent.replace(helpHandleBlock, avviaHandleBlock);
fs.writeFileSync(clientFile, clientContent);
console.log('Fixed parser and handler');
