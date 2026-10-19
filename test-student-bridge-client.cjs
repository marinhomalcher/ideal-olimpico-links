const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = {};
const frameWindow = { postMessage() {} };
const frame = { contentWindow: frameWindow, setAttribute() {}, tabIndex: -1, style: {}, src: '' };
const window = {
  PORTAL_PRODUCTION_CONFIG: { bridgeUrl: 'https://script.google.com/macros/s/TEST/exec?bridge=aluno' },
  addEventListener: (type, callback) => { listeners[type] = callback; }
};
const document = {
  createElement: () => frame,
  body: { appendChild() {} }
};
vm.runInNewContext(fs.readFileSync('inscricoes/student-bridge-client.js', 'utf8'), { window, document, URL, Map, Object, Error, Date, setTimeout, clearTimeout, console });

const bridgeOrigin = 'https://script.googleusercontent.com';
const nonce = 'a'.repeat(48);
let result;
const calls = [];
const nestedWindow = { parent: frameWindow, postMessage(message, origin) {
  assert.equal(origin, bridgeOrigin);
  calls.push({ message, origin });
  if (message.type === 'ideal-student-authorize') {
    listeners.message({ source: nestedWindow, origin, data: { type: 'ideal-student-connected', nonce: message.nonce } });
  } else if (message.type === 'ideal-student-call') {
    listeners.message({ source: nestedWindow, origin, data: { type: 'ideal-student-result', id: message.id, ok: true, data: { status: 'OK' } } });
  }
} };

// Apps Script HtmlService reports its nested sandbox window as the sender.
listeners.message({ source: nestedWindow, origin: bridgeOrigin, data: { type: 'ideal-student-ready', nonce } });
window.google.script.run.withSuccessHandler(value => { result = value; }).withFailureHandler(error => { throw error; }).autenticarAluno('99999', '2010-01-01');
assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'OK' });
assert.equal(calls.some(call => call.message.type === 'ideal-student-call'), true);

let rejected;
window.google.script.run.withFailureHandler(error => { rejected = error.message; }).unknownOperation();
assert.equal(rejected, 'Operação não permitida.');
console.log('OK: HtmlService aninhado autentica a ponte e conclui RPC; origens e operações inválidas seguem bloqueadas.');
