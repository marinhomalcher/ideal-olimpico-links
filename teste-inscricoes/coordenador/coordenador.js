(() => {
  const statusEl=document.getElementById('status');
  const listEl=document.getElementById('list');
  const msgEl=document.getElementById('msg');
  const appEl=document.getElementById('app');
  const pending=new Map();
  let bridgeSource=null,bridgeOrigin='',connected=false,sequence=0,busy=false;
  const allowedMethods=new Set(['coordenadorDados','coordenadorAprovarPagamentoEInscricao','coordenadorRejeitarComprovante','coordenadorCsvInscritos','coordenadorSalvarValorCompeticao']);
  function trustedBridgeOrigin(origin){
    try{const u=new URL(origin);return u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('-script.googleusercontent.com'));}catch{return false;}
  }
  function setStatus(text){statusEl.textContent=text;}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function showMessage(text,kind='ok'){
    msgEl.innerHTML=text?'<div class="message '+(kind==='error'?'error':'okmsg')+'">'+escapeHtml(text)+'</div>':'';
  }
  function setBusy(value){busy=value;appEl.classList.toggle('loading',value);appEl.querySelectorAll('button,select,input').forEach(el=>el.disabled=value);}
  function call(method,...args){
    if(!connected||!allowedMethods.has(method))return Promise.reject(new Error('A conexão segura ainda não está pronta.'));
    const id='coord-'+(++sequence)+'-'+Date.now();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('O Google não respondeu a tempo. Recarregue a página antes de tentar novamente.'));},30000);
      pending.set(id,{resolve,reject,timer});
      bridgeSource.postMessage({type:'ideal-coord-call',id,method,args},bridgeOrigin);
    });
  }
  window.addEventListener('message',event=>{
    if(!trustedBridgeOrigin(event.origin)||!event.data)return;
    const data=event.data;
    if(data.type==='ideal-coord-ready'&&typeof data.nonce==='string'&&data.nonce.length>=24){
      bridgeSource=event.source;bridgeOrigin=event.origin;
      bridgeSource.postMessage({type:'ideal-coord-authorize',nonce:data.nonce},bridgeOrigin);
      return;
    }
    if(event.source!==bridgeSource||event.origin!==bridgeOrigin)return;
    if(data.type==='ideal-coord-connected'){
      connected=true;document.getElementById('fallback').classList.add('hidden');appEl.classList.remove('hidden');
      setStatus('Conectado com sua conta Google.');carregar();return;
    }
    if(data.type==='ideal-coord-result'&&typeof data.id==='string'){
      const item=pending.get(data.id);if(!item)return;clearTimeout(item.timer);pending.delete(data.id);
      if(data.ok)item.resolve(data.data);else item.reject(new Error(data.error||'A operação falhou.'));
    }
  });
  function money(value){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value||0));}
  function driveUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='drive.google.com'?u.href:'';}catch{return'';}}
  function render(data){
    listEl.innerHTML=(data.pendentes||[]).map(item=>{
      const proof=driveUrl(item.link);
      return '<article class="card"><h2>'+escapeHtml(item.nome)+'</h2><div class="meta">Matrícula: '+escapeHtml(item.matricula)+' · '+escapeHtml(item.unidade)+' · '+escapeHtml(item.serie)+' · Turma '+escapeHtml(item.turma)+'<br>Competição: '+escapeHtml((item.competicoes||[]).join(', '))+'<br>Pedido: '+escapeHtml(item.pedidoId)+' · Pagamento: '+escapeHtml(item.pagamentoId)+'<br>Valor: <b>'+money(item.valor)+'</b> · Enviado: '+escapeHtml(item.enviadoEm)+'<br>Arquivo: '+escapeHtml(item.arquivo)+'</div><div class="actions">'+(proof?'<a class="action open" href="'+escapeHtml(proof)+'" target="_blank" rel="noopener noreferrer">Abrir comprovante no Drive</a>':'')+'<button class="action approve" data-id="'+escapeHtml(item.pagamentoId)+'">Aprovar pagamento + inscrição oficial</button><button class="action reject" data-id="'+escapeHtml(item.pagamentoId)+'">Rejeitar comprovante</button></div></article>';
    }).join('')||'<div class="empty">Nenhum comprovante aguarda conferência.</div>';
    listEl.querySelectorAll('.approve').forEach(button=>button.addEventListener('click',()=>aprovar(button.dataset.id)));
    listEl.querySelectorAll('.reject').forEach(button=>button.addEventListener('click',()=>rejeitar(button.dataset.id)));
    const select=document.getElementById('competition'),old=select.value;
    select.innerHTML='<option value="">Selecione uma competição</option>'+(data.competicoes||[]).map(item=>'<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.nome)+'</option>').join('');
    if(old)select.value=old;
    const prices=document.getElementById('prices');
    prices.innerHTML=(data.competicoes||[]).map(item=>{
      const price=Number(item.valor);
      const shown=Number.isFinite(price)?price.toFixed(2):'';
      return '<article class="price-row" data-id="'+escapeHtml(item.id)+'"><div class="price-name"><strong>'+escapeHtml(item.nome)+'</strong><span>'+escapeHtml(item.grupoId||'')+'</span></div><label>Valor (R$)<input type="number" min="0.01" max="99999.99" step="0.01" inputmode="decimal" value="'+shown+'" aria-label="Valor da '+escapeHtml(item.nome)+'"></label><button class="button price-save">Salvar valor</button></article>';
    }).join('')||'<div class="empty">Nenhuma competição disponível.</div>';
    prices.querySelectorAll('.price-save').forEach(button=>button.addEventListener('click',()=>salvarPreco(button)));
    document.getElementById('stamp').textContent='Atualizado '+(data.atualizadoEm||'');
  }
  async function carregar(){
    if(busy)return;setBusy(true);showMessage('');
    try{render(await call('coordenadorDados'));}
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  async function aprovar(id){
    if(!confirm('Ao confirmar, o pagamento será aprovado e a inscrição oficial será marcada como concluída. Confirme somente se o comprovante foi conferido e a inscrição já foi feita no site da competição.'))return;
    setBusy(true);showMessage('');
    try{const result=await call('coordenadorAprovarPagamentoEInscricao',id);showMessage('Pagamento e '+result.inscricoes+' inscrição(ões) oficial(is) confirmados.');render(await call('coordenadorDados'));}
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  async function rejeitar(id){
    const reason=prompt('Informe o motivo da rejeição. O aluno poderá enviar outro comprovante.');
    if(reason===null)return;if(reason.trim().length<3){showMessage('Informe um motivo com pelo menos 3 caracteres.','error');return;}
    if(!confirm('Rejeitar este comprovante? O arquivo ficará preservado para auditoria e o aluno poderá enviar outro.'))return;
    setBusy(true);showMessage('');
    try{await call('coordenadorRejeitarComprovante',id,reason);showMessage('Comprovante rejeitado. O pedido voltou a aguardar novo envio.');render(await call('coordenadorDados'));}
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  async function baixar(){
    const id=document.getElementById('competition').value;
    if(!id){showMessage('Selecione uma competição.','error');return;}
    setBusy(true);showMessage('');
    try{const result=await call('coordenadorCsvInscritos',id);const blob=new Blob(['\ufeff'+String(result.csv||'').replace(/^\ufeff/,'')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=result.nomeArquivo;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);showMessage('CSV gerado com '+result.quantidade+' inscrito(s).');}
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  async function salvarPreco(button){
    const row=button.closest('.price-row'),input=row&&row.querySelector('input'),id=row&&row.dataset.id;
    const value=input&&input.valueAsNumber;
    if(!id||!Number.isFinite(value)||value<=0||value>99999.99||Math.abs(value*100-Math.round(value*100))>0.000001){showMessage('Informe um preço maior que zero, com até duas casas decimais e no máximo R$ 99.999,99.','error');return;}
    setBusy(true);showMessage('');
    try{const result=await call('coordenadorSalvarValorCompeticao',id,value);showMessage('Valor atualizado para '+money(result.valor)+'. A mudança vale para novos pedidos.');render(await call('coordenadorDados'));}
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  document.getElementById('refresh').addEventListener('click',carregar);
  document.getElementById('download').addEventListener('click',baixar);
  document.getElementById('fallbackLink').href=window.COORD_CONFIG.standaloneUrl;
  document.getElementById('backendBridge').src=window.COORD_CONFIG.bridgeUrl;
  setTimeout(()=>{if(!connected){setStatus('A conexão segura não respondeu. Se o Google pedir autorização, conclua e recarregue esta página.');document.getElementById('fallback').classList.remove('hidden');}},10000);
})();
