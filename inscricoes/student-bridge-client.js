/* Static-site adapter: preserves the existing google.script.run call sites. */
(() => {
  'use strict';
  const methods=Object.freeze({
    autenticarAluno:2,confirmarCadastroAluno:2,solicitarAlteracaoCadastral:2,
    encerrarSessaoAluno:1,getCatalogoGrupo:1,getOpcoesLiteratura:1,
    validarCompeticaoSerie:2,verificarInscricaoExistente:2,verificarCarrinhoAluno:2,
    criarPedido:2,listarPedidosAluno:1,cancelarPedidoAluno:2,obterPixPedido:2,
    enviarComprovantePedido:3
  });
  const configured=window.PORTAL_PRODUCTION_CONFIG&&window.PORTAL_PRODUCTION_CONFIG.bridgeUrl;
  if(!configured)throw new Error('A conexão segura do portal não foi configurada.');
  const bridgeUrl=new URL(configured);
  if(bridgeUrl.protocol!=='https:'||bridgeUrl.hostname!=='script.google.com'||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(bridgeUrl.pathname)||
      bridgeUrl.hash||bridgeUrl.searchParams.size!==1||bridgeUrl.searchParams.get('bridge')!=='aluno'){
    throw new Error('Endereço da conexão segura inválido.');
  }
  const frame=document.createElement('iframe');
  frame.title='Conexão segura com o portal';
  frame.setAttribute('aria-hidden','true');
  frame.tabIndex=-1;
  frame.style.cssText='position:absolute;width:1px;height:1px;left:-10000px;top:auto;border:0';
  let source=null,origin='',nonce='',ready=false,sequence=0;
  const pending=new Map();
  function trustedOrigin(value){
    try{
      const u=new URL(value);
      return u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||/^[a-z0-9-]+-script\.googleusercontent\.com$/.test(u.hostname));
    }catch{return false;}
  }
  function isBridgeFrameSource(source){
    // Apps Script may add more than one internal HtmlService frame. Walk up
    // the sender's frame ancestry instead of assuming a fixed nesting depth.
    let current=source;
    for(let depth=0;current&&depth<8;depth++){
      if(current===frame.contentWindow)return true;
      try{if(current===current.parent)return false;current=current.parent;}catch{return false;}
    }
    return false;
  }
  function dispatch(method,args,success,failure){
    if(!Object.prototype.hasOwnProperty.call(methods,method)||args.length!==methods[method]){
      failure(new Error('Operação não permitida.'));return;
    }
    if(!ready||!source){failure(new Error('A conexão segura ainda está carregando. Tente novamente.'));return;}
    const id='student-'+(++sequence)+'-'+Date.now();
    const timer=setTimeout(()=>{pending.delete(id);failure(new Error('O Google não respondeu a tempo. Se você enviou um comprovante ou criou um pedido, confira Meus Pedidos antes de repetir.'));},90000);
    pending.set(id,{success,failure,timer});
    source.postMessage({type:'ideal-student-call',id,method,args},origin);
  }
  window.addEventListener('message',event=>{
    if(!isBridgeFrameSource(event.source)||!trustedOrigin(event.origin)||!event.data)return;
    const data=event.data;
    if(data.type==='ideal-student-ready'&&typeof data.nonce==='string'&&data.nonce.length===48){
      source=event.source;origin=event.origin;nonce=data.nonce;
      source.postMessage({type:'ideal-student-authorize',nonce:data.nonce},origin);
      return;
    }
    if(event.source!==source||event.origin!==origin)return;
    if(data.type==='ideal-student-connected'){
      if(data.nonce===nonce)ready=true;
      return;
    }
    if(data.type!=='ideal-student-result'||typeof data.id!=='string')return;
    const request=pending.get(data.id);if(!request)return;
    clearTimeout(request.timer);pending.delete(data.id);
    if(data.ok)request.success(data.data);else request.failure(new Error(String(data.error||'A operação falhou.')));
  });
  frame.src=bridgeUrl.href;
  (document.body||document.documentElement).appendChild(frame);
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
