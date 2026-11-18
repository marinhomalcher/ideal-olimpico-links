// R2 falso com a mesma exigência da Cloudflare real: um fluxo (ReadableStream) só é aceito
// se o tamanho for conhecido (FixedLengthStream). Sem isso, o envio de lotes passava nos
// testes e falhava no ar com "Erro interno" (corrigido em 14/11/2026).
const TAMANHO = Symbol('tamanho conhecido');

// Imitação do FixedLengthStream da Cloudflare (não existe no Node).
if (typeof globalThis.FixedLengthStream !== 'function') {
  globalThis.FixedLengthStream = class FixedLengthStream extends TransformStream {
    constructor(esperado) {
      let recebidos = 0;
      super({
        transform(pedaco, controle) {
          recebidos += pedaco.byteLength;
          if (recebidos > esperado) throw new TypeError('FixedLengthStream: mais bytes do que o informado.');
          controle.enqueue(pedaco);
        },
        flush() { if (recebidos !== esperado) throw new TypeError('FixedLengthStream: menos bytes do que o informado.'); }
      });
      this.readable[TAMANHO] = esperado;
    }
  };
}

export function r2Rigoroso(objetos, opcoes = {}) {
  return {
    put: async (key, body) => {
      if (body instanceof ReadableStream && body[TAMANHO] === undefined) {
        throw new TypeError('Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)');
      }
      objetos.set(key, Buffer.from(await new Response(body).arrayBuffer()));
    },
    get: async key => objetos.has(key) ? { body: objetos.get(key) } : null,
    delete: async key => { if (opcoes.falharExclusao?.()) throw Error('Falha temporária simulada'); for (const k of Array.isArray(key) ? key : [key]) objetos.delete(k); },
    /* lista por prefixo, em páginas, como a Cloudflare (cursor = posição) */
    list: async ({ prefix = '', cursor, limit = 1000 } = {}) => {
      const todas = [...objetos.keys()].filter(k => k.startsWith(prefix)).sort();
      const inicio = Number(cursor || 0), fatia = todas.slice(inicio, inicio + limit);
      const objects = fatia.map(key => ({ key, size: objetos.get(key).length, uploaded: new Date(0) }));
      const truncated = inicio + limit < todas.length;
      return { objects, truncated, cursor: truncated ? String(inicio + limit) : undefined };
    }
  };
}
