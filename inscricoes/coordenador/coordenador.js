(() => {
  const statusEl=document.getElementById('status');
  const listEl=document.getElementById('list');
  const msgEl=document.getElementById('msg');
  const appEl=document.getElementById('app');
  const bridgeFrame=document.getElementById('backendBridge');
  const gateEl=document.getElementById('coordinatorGate');
  const enterButton=document.getElementById('enterCoordinator');
  const pending=new Map();
  let bridgeSource=null,bridgeOrigin='',connected=false,sequence=0,busy=false;
  const LITERATURE_ALL_ID='__literatura_todas_as_obras__';
  const allowedMethods=new Set(['coordenadorDados','coordenadorAprovarPagamentoEInscricao','coordenadorRejeitarComprovante','coordenadorCsvInscritos','coordenadorSalvarValorCompeticao']);
  function trustedBridgeOrigin(origin){
    try{const u=new URL(origin);return u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('-script.googleusercontent.com'));}catch{return false;}
  }
  function trustedBridgeFrame(source){
    if(!source)return false;
    let current=source;
    for(let depth=0;depth<8&&current&&current!==window;depth++){
      if(current===bridgeFrame.contentWindow)return true;
      try{const parent=current.parent;if(!parent||parent===current)return false;current=parent;}catch{return false;}
    }
    return current===bridgeFrame.contentWindow;
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
    if(!trustedBridgeFrame(event.source)||!trustedBridgeOrigin(event.origin)||!event.data)return;
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
  function priceGroups(competicoes){
    const groups=[{id:'literatura',label:'OLIMPÍADA DE LITERATURA',matches:[]},{id:'seleta',label:'GRUPO SELETA',matches:[]}];
    const other=[];
    (competicoes||[]).forEach(item=>{
      const name=String(item.nome||'').trim().toLocaleUpperCase('pt-BR');
      const group=name.startsWith('LITERATURA')?groups[0]:name.startsWith('SELETA')?groups[1]:null;
      if(group)group.matches.push(item);else other.push(item);
    });
    return groups.filter(group=>group.matches.length).concat(other.map(item=>({id:'individual-'+item.id,label:item.nome,matches:[item],individual:true})));
  }
  function driveUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='drive.google.com'?u.href:'';}catch{return'';}}
  function render(data){
    listEl.innerHTML=(data.pendentes||[]).map(item=>{
      const proof=driveUrl(item.link);
      return '<article class="card"><h2>'+escapeHtml(item.nome)+'</h2><div class="meta">Matrícula: '+escapeHtml(item.matricula)+' · '+escapeHtml(item.unidade)+' · '+escapeHtml(item.serie)+' · Turma '+escapeHtml(item.turma)+'<br>Competição: '+escapeHtml((item.competicoes||[]).join(', '))+'<br>Pedido: '+escapeHtml(item.pedidoId)+' · Pagamento: '+escapeHtml(item.pagamentoId)+'<br>Valor: <b>'+money(item.valor)+'</b> · Enviado: '+escapeHtml(item.enviadoEm)+'<br>Arquivo: '+escapeHtml(item.arquivo)+'</div><div class="actions">'+(proof?'<a class="action open" href="'+escapeHtml(proof)+'" target="_blank" rel="noopener noreferrer">Abrir comprovante no Drive</a>':'')+'<button class="action approve" data-id="'+escapeHtml(item.pagamentoId)+'">Aprovar pagamento + inscrição oficial</button><button class="action reject" data-id="'+escapeHtml(item.pagamentoId)+'">Rejeitar comprovante</button></div></article>';
    }).join('')||'<div class="empty">Nenhum comprovante aguarda conferência.</div>';
    listEl.querySelectorAll('.approve').forEach(button=>button.addEventListener('click',()=>aprovar(button.dataset.id)));
    listEl.querySelectorAll('.reject').forEach(button=>button.addEventListener('click',()=>rejeitar(button.dataset.id)));
    const select=document.getElementById('competition'),old=select.value;
    const literature=(data.competicoes||[]).filter(item=>String(item.nome||'').trim().toLocaleUpperCase('pt-BR').startsWith('LITERATURA'));
    select.innerHTML='<option value="">Selecione uma competição</option>'+(literature.length?'<option value="'+LITERATURE_ALL_ID+'">LITERATURA — Todas as obras</option>':'')+(data.competicoes||[]).map(item=>'<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.nome)+'</option>').join('');
    if(old)select.value=old;
    document.getElementById('prices').innerHTML=priceGroups(data.competicoes).map(group=>{
      const ids=group.matches.map(item=>item.id),values=group.matches.map(item=>Number(item.valor||0)),same=values.every(value=>value===values[0]),value=same?values[0]:'';
      const note=group.individual?'':'Aplica o mesmo valor a '+group.matches.length+' competição(ões) deste grupo.'+(same?'':' Os valores atuais do grupo estão diferentes.');
      return '<article class="price-card"><label>'+escapeHtml(group.label)+'<span>Valor (R$)</span><input class="price-value" type="number" min="0.01" max="99999.99" step="0.01" inputmode="decimal" data-ids="'+escapeHtml(JSON.stringify(ids))+'" value="'+escapeHtml(same?Number(value||0).toFixed(2):'')+'" placeholder="Informe o valor"></label>'+(note?'<p class="price-note">'+escapeHtml(note)+'</p>':'')+'<button class="button save-price" data-ids="'+escapeHtml(JSON.stringify(ids))+'">Salvar valor</button></article>';
    }).join('')||'<div class="empty">Nenhuma competição encontrada.</div>';
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
    try{const result=await call('coordenadorAprovarPagamentoEInscricao',id);showMessage('Pagamento e '+result.inscricoes+' inscrição(ões) oficial(is) confirmados.'+(result.emailAvisoEnviado?' Aviso enviado ao e-mail pessoal cadastrado.':' Não foi possível enviar o aviso por e-mail; o aluno pode consultar Meus Pedidos.'));render(await call('coordenadorDados'));}
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  async function rejeitar(id){
    const reason=prompt('Informe o motivo da rejeição. O aluno poderá enviar outro comprovante.');
    if(reason===null)return;if(reason.trim().length<3){showMessage('Informe um motivo com pelo menos 3 caracteres.','error');return;}
    if(!confirm('Rejeitar este comprovante? O arquivo ficará preservado para auditoria e o aluno poderá enviar outro.'))return;
    setBusy(true);showMessage('');
    try{const result=await call('coordenadorRejeitarComprovante',id,reason);showMessage('Comprovante rejeitado. O pedido voltou a aguardar novo envio.'+(result.emailAvisoEnviado?' O aluno foi avisado por e-mail.':' Não foi possível enviar o aviso por e-mail; o aluno pode consultar Meus Pedidos.'));render(await call('coordenadorDados'));}
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  async function baixar(){
    const id=document.getElementById('competition').value;
    if(!id){showMessage('Selecione uma competição.','error');return;}
    setBusy(true);showMessage('');
    try{
      let csv='',quantity=0,filename='';
      if(id===LITERATURE_ALL_ID){
        const competitions=[...document.getElementById('competition').options].filter(option=>option.value&&option.textContent.trim().toLocaleUpperCase('pt-BR').startsWith('LITERATURA')).map(option=>option.value);
        if(!competitions.length)throw new Error('Nenhuma obra de Literatura está disponível para exportação.');
        const results=new Array(competitions.length);let next=0;
        const batches=await Promise.allSettled(Array.from({length:Math.min(4,competitions.length)},async()=>{while(next<competitions.length){const index=next++;results[index]=await call('coordenadorCsvInscritos',competitions[index]);}}));
        const failure=batches.find(result=>result.status==='rejected');if(failure)throw failure.reason;
        const records=results.map(result=>csvRecords(result.csv)),header=records.find(rows=>rows.length)?.[0];
        if(!header)throw new Error('O backend não retornou o cabeçalho do CSV de Literatura.');
        if(records.some(rows=>rows.length&&rows[0]!==header))throw new Error('As obras retornaram formatos de CSV diferentes. Baixe cada obra separadamente.');
        csv=[header,...records.flatMap(rows=>rows.slice(1))].join('\r\n');
        quantity=results.reduce((sum,result)=>sum+Number(result.quantidade||0),0);
        filename='inscritos-literatura-todas-as-obras.csv';
      }else{
        const result=await call('coordenadorCsvInscritos',id);csv=String(result.csv||'').replace(/^\ufeff/, '');quantity=result.quantidade;filename=result.nomeArquivo;
      }
      const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);showMessage('CSV gerado com '+quantity+' inscrição(ões).');
    }
    catch(error){showMessage(error.message,'error');}
    finally{setBusy(false);}
  }
  function csvRecords(value){
    const text=String(value||'').replace(/^\ufeff/,''),rows=[];let start=0,quoted=false;
    for(let index=0;index<text.length;index++){
      const char=text[index];
      if(char==='"'){if(quoted&&text[index+1]==='"'){index++;continue;}quoted=!quoted;}
      else if(!quoted&&(char==='\n'||char==='\r')){const row=text.slice(start,index);if(row.trim())rows.push(row);if(char==='\r'&&text[index+1]==='\n')index++;start=index+1;}
    }
    const tail=text.slice(start);if(tail.trim())rows.push(tail);return rows;
  }
  async function salvarValor(button){
    const ids=JSON.parse(button.dataset.ids||'[]'),input=button.closest('.price-card').querySelector('.price-value'),valor=Number(input&&input.value);
    if(!Number.isFinite(valor)||valor<=0||valor>99999.99||Math.abs(valor*100-Math.round(valor*100))>1e-7){showMessage('Informe um valor entre R$ 0,01 e R$ 99.999,99, com até duas casas decimais.','error');return;}
    if(!ids.length){showMessage('Não foi possível identificar as competições deste grupo. Atualize o painel e tente novamente.','error');return;}
    setBusy(true);showMessage('');
    let salvos=0;
    try{for(const id of ids){await call('coordenadorSalvarValorCompeticao',id,valor);salvos++;}showMessage('Valor '+money(valor)+' aplicado a '+salvos+' competição(ões).');render(await call('coordenadorDados'));}
    catch(error){const detalhe=salvos?' O valor foi atualizado em '+salvos+' de '+ids.length+' competições; atualize o painel e tente novamente para concluir. ':'';showMessage((error.message||'A operação falhou.')+detalhe,'error');try{render(await call('coordenadorDados'));}catch{}}
    finally{setBusy(false);}
  }
  document.getElementById('refresh').addEventListener('click',carregar);
  document.getElementById('download').addEventListener('click',baixar);
  document.getElementById('prices').addEventListener('click',event=>{const button=event.target.closest('.save-price');if(button)salvarValor(button);});
  enterButton.addEventListener('click',()=>{
    if(!window.COORD_CONFIG.bridgeUrl){gateEl.classList.add('hidden');setStatus('A conexão privada ainda não foi configurada.');statusEl.classList.remove('hidden');return;}
    gateEl.classList.add('hidden');statusEl.classList.remove('hidden');setStatus('Conectando à área segura…');
    document.getElementById('fallbackLink').href=window.COORD_CONFIG.standaloneUrl||window.COORD_CONFIG.bridgeUrl;
    bridgeFrame.src=window.COORD_CONFIG.bridgeUrl;
    setTimeout(()=>{if(!connected){setStatus('Não foi possível concluir a conexão. Entre com a conta Google autorizada e tente novamente.');document.getElementById('fallback').classList.remove('hidden');}},10000);
  });
})();
