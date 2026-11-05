const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = {};
const frameWindow = { postMessage() {}, frames: [] };
const frame = { contentWindow: frameWindow, setAttribute() {}, tabIndex: -1, style: {}, src: '' };
const window = {
  PORTAL_PRODUCTION_CONFIG: { bridgeUrl: 'https://script.google.com/macros/s/TEST/exec?bridge=aluno' },
  addEventListener: (type, callback) => { listeners[type] = callback; }
};
const document = {
  createElement: () => frame,
  body: { appendChild() {} }
};
const studentHtml = fs.readFileSync('inscricoes/index.html', 'utf8');
assert.equal(studentHtml.includes('Área da coordenação'), false, 'student portal must not link to coordinator area');
class LegacySafariURL extends URL {
  get searchParams() {
    const params = super.searchParams;
    return { get: params.get.bind(params), [Symbol.iterator]: params[Symbol.iterator].bind(params) };
  }
}
assert.equal(new LegacySafariURL('https://script.google.com/macros/s/TEST/exec?bridge=aluno').searchParams.size, undefined);
vm.runInNewContext(fs.readFileSync('inscricoes/student-bridge-client.js', 'utf8'), { window, document, URL: LegacySafariURL, Map, Object, Error, Date, setTimeout, clearTimeout, console });

const bridgeOrigin = 'https://script.googleusercontent.com';
const nonce = 'a'.repeat(48);
let result;
const calls = [];
const innerWindow = { frames: [], postMessage(message, origin) {
  assert.equal(origin, bridgeOrigin);
  calls.push({ message, origin });
  if (message.type === 'ideal-student-authorize') {
    listeners.message({ source: innerWindow, origin, data: { type: 'ideal-student-connected', nonce: message.nonce } });
  } else if (message.type === 'ideal-student-call') {
    listeners.message({ source: innerWindow, origin, data: { type: 'ideal-student-result', id: message.id, ok: true, data: { status: 'OK' } } });
  }
} };
const middleWindow = { frames: [innerWindow] };
const nestedWindow = { frames: [middleWindow], postMessage: innerWindow.postMessage };
frameWindow.frames = [nestedWindow];

// Queue a request before the Apps Script bridge is ready.
window.google.script.run.withSuccessHandler(value => { result = value; }).withFailureHandler(error => { throw error; }).autenticarAluno('99999', '2010-01-01');
// Apps Script HtmlService reports a deeply nested sandbox window as the sender.
listeners.message({ source: innerWindow, origin: bridgeOrigin, data: { type: 'ideal-student-ready', nonce } });
assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'OK' });
assert.equal(calls.some(call => call.message.type === 'ideal-student-call'), true);

let rejected;
window.google.script.run.withFailureHandler(error => { rejected = error.message; }).unknownOperation();
assert.equal(rejected, 'Operação não permitida.');
console.log('OK: Safari antigo sem URLSearchParams.size, iframe profundamente aninhado e chamada antes da conexão funcionam; origens e operações inválidas seguem bloqueadas.');
