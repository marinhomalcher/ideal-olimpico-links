/* Transporte de homologação: dados e sessão exclusivamente no corpo POST. */
(() => {
  let accessKey='';
  const allowed=new Set(['autenticarAluno','confirmarCadastroAluno','solicitarAlteracaoCadastral','encerrarSessaoAluno','getPortalHome','getCatalogoGrupo','getOpcoesLiteratura','validarCompeticaoSerie','verificarInscricaoExistente','verificarCarrinhoAluno','criarPedido','listarPedidosAluno','cancelarPedidoAluno','obterPixPedido','enviarComprovantePedido']);
  function endpoint(){
    const value=window.PORTAL_TEST_CONFIG?.endpoint;
    if(!value)throw Error('O backend de teste aguarda autorização e implantação no Google.');
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)||url.search||url.hash)throw Error('Endereço de teste inválido.');
    if(url.pathname.includes('AKfycbwE7f_rZ04wznIY_WViTAw1cIq55drbJ_UAWV1qyys8s5ScTqvyWRwcU7myz43CJd51'))throw Error('O backend oficial está bloqueado nesta versão.');
    return url.href;
  }
  async function request(method,args){
    if(!allowed.has(method))throw Error('Operação não permitida.');
    const url=endpoint();
    if(!accessKey){accessKey=document.getElementById('testAccessKey')?.value||window.prompt('Informe a chave de acesso do ambiente de teste. Ela ficará apenas na memória desta página.')||'';if(!accessKey)throw Error('Acesso ao teste cancelado.');}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({method,args,accessKey}),mode:'cors',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response.ok)throw Error('Resposta HTTP inesperada.');
      const body=await response.json();
      if(body.environment!=='test')throw Error('Resposta fora do ambiente de teste.');
      if(!body.ok){if(/não autorizado/i.test(body.error?.message||''))accessKey='';throw Error(body.error?.message||'A operação falhou.');}
      return body.data;
    }catch(error){
      if(error.name==='AbortError'||error instanceof TypeError)throw Error('Não foi possível confirmar a resposta. Se você estava criando um pedido ou enviando comprovante, consulte Meus Pedidos antes de repetir.');
      throw error;
    }finally{clearTimeout(timer);}
  }
  function runner(success=()=>{},failure=e=>window.alert(e.message)){
    return new Proxy({}, {get(_,name){
      if(name==='withSuccessHandler')return fn=>runner(fn,failure);
      if(name==='withFailureHandler')return fn=>runner(success,fn);
      return (...args)=>{request(name,args).then(success,failure);};
    }});
  }
  window.google={script:{get run(){return runner();}}};
})();
