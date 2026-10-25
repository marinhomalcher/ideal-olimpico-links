/* Test route adapter. Mirrors the production migration client; points only to the configured test Worker. */
(() => {
  'use strict';
  const methods=Object.freeze({
    autenticarAluno:2,confirmarCadastroAluno:2,solicitarAlteracaoCadastral:2,
    encerrarSessaoAluno:1,getCatalogoGrupo:1,getOpcoesLiteratura:1,
    validarCompeticaoSerie:2,verificarInscricaoExistente:2,verificarCarrinhoAluno:2,
    criarPedido:2,listarPedidosAluno:1,cancelarPedidoAluno:2,obterPixPedido:2,
    enviarComprovantePedido:3
  });
  const configured=window.PORTAL_PROXY_TEST_CONFIG&&window.PORTAL_PROXY_TEST_CONFIG.apiUrl;
  if(!configured)throw new Error('O servidor de homologação ainda não foi configurado.');
  const url=new URL(configured);
  if(url.protocol!=='https:'||url.pathname!=='/api'||url.search||url.hash||
      !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)){
    throw new Error('Endereço do servidor de homologação inválido.');
  }
  function dispatch(method,args,success,failure){
    if(!Object.prototype.hasOwnProperty.call(methods,method)||args.length!==methods[method]){
      failure(new Error('Operação não permitida.'));return;
    }
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),method==='enviarComprovantePedido'?120000:45000);
    fetch(url.href,{method:'POST',mode:'cors',cache:'no-store',credentials:'omit',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({method,args}),signal:controller.signal})
      .then(async response=>{
        const body=await response.json();
        if(!response.ok||!body||!body.ok)throw new Error(String(body&&body.error||'A operação falhou.'));
        return body.data;
      })
      .then(success)
      .catch(error=>failure(new Error(error&&error.name==='AbortError'
        ?'O servidor não respondeu a tempo. Confira o estado do pedido antes de repetir.'
        :String(error&&error.message||'Falha na conexão de homologação.'))))
      .finally(()=>clearTimeout(timeout));
  }
  function runner(success=()=>{},failure=error=>console.error(error)){
    return new Proxy({}, {get(_target,name){
      if(name==='withSuccessHandler')return fn=>runner(typeof fn==='function'?fn:success,failure);
      if(name==='withFailureHandler')return fn=>runner(success,typeof fn==='function'?fn:failure);
      if(name==='withUserObject')return ()=>runner(success,failure);
      if(typeof name!=='string')return undefined;
      return (...args)=>dispatch(name,args,success,failure);
    }});
  }
  window.google={script:{get run(){return runner();}}};
})();

