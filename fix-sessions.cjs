const fs = require('fs');
const file = 'src/whatsapp/whatsappClient.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add activeSessions to constructor if not exists
if (!content.includes('this.activeSessions = new Set();')) {
  content = content.replace(/this\.status = 'INITIALIZING';/, "this.status = 'INITIALIZING';\n    this.activeSessions = new Set();");
}

// 2. Extract _sendReply helper
if (!content.includes('async _sendReply(msg, from, response)')) {
  content = content.replace(/async handleIncomingMessage\(msg\) {/, `async _sendReply(msg, from, response) {
    try {
      if (typeof msg.reply === 'function') {
        await msg.reply(response);
      } else if (this.client && typeof this.client.sendMessage === 'function') {
        await this.client.sendMessage(from, response);
      } else if (this.sock && typeof this.sock.sendMessage === 'function') {
        await this.sock.sendMessage(from, { text: response });
      }
    } catch (replyErr) {
      console.error('Error sending reply:', replyErr);
    }
  }

  async handleIncomingMessage(msg) {`);
}

// 3. Inject session logic right after 'let response = '';'
const sessionLogic = `    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    if (lower === '/avvia') {
      this.activeSessions.add(from);
      const r = '🟢 Modalità Spesa ATTIVATA in questa chat.\\nOra tutto quello che scrivi verrà aggiunto direttamente alla lista! (Scrivi /ferma per disabilitare)';
      await this._sendReply(msg, from, r);
      return r;
    } else if (lower === '/ferma') {
      this.activeSessions.delete(from);
      const r = '🔴 Modalità Spesa DISATTIVATA in questa chat.\\nI messaggi normali verranno di nuovo ignorati.';
      await this._sendReply(msg, from, r);
      return r;
    }

    let isSessionActive = this.activeSessions.has(from);
    let commandText = text;

    if (!isSessionActive) {
      if (lower.startsWith('!!')) {
        commandText = text.substring(2).trim();
      } else if (lower.startsWith('!')) {
        commandText = text.substring(1).trim();
      } else {
        return null;
      }
    }`;

// Regex to replace from `let response = '';` to `const parsed = MessageParser.parse(text);`
content = content.replace(/let response = '';[\s\S]*?const parsed = MessageParser\.parse\(text\);/, 
  `let response = '';\n\n${sessionLogic}\n\n    try {\n      const parsed = MessageParser.parse(commandText);`);

// 4. Remove the old _sendReply block at the bottom since we extracted it, and replace with await this._sendReply(msg, from, response)
content = content.replace(/if \(response\) \{[\s\S]*?try \{[\s\S]*?if \(typeof msg\.reply === 'function'\) \{[\s\S]*?await msg\.reply\(response\);[\s\S]*?\} else if \(this\.client[\s\S]*?await this\.client\.sendMessage\(from, response\);[\s\S]*?\} else if \(this\.sock[\s\S]*?await this\.sock\.sendMessage\(from, \{ text: response \}\);[\s\S]*?\}[\s\S]*?\} catch \(replyErr\) \{[\s\S]*?console\.error\('Error sending reply:', replyErr\);[\s\S]*?\}[\s\S]*?\}/, 
  `if (response) {
      await this._sendReply(msg, from, response);
    }`);

fs.writeFileSync(file, content);
console.log('Session logic restored');
