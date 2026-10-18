
const LOGOS = {"IDEAL":"./assets/ideal.jpg","SELETA":"./assets/seleta.png","LITERATURA":"./assets/literatura.png","LIGMAT":"./assets/ligmat.jpg","MANDACARU":"./assets/mandacaru.png","OBF":"./assets/obf.png"};
document.getElementById('brandLogo').src = LOGOS.IDEAL;
let grupos={},grupoAtual=null,catalogoAtual=[],carrinho={},alunoAtual=null,pedidoPendenteIds=[],pixAtualCodigo='',pedidoPixAtualId='',pagamentosNovos=[];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

document.addEventListener('DOMContentLoaded',()=>{
  const mat=document.getElementById('matriculaInput');
  const nasc=document.getElementById('nascimentoInput');
  mat.addEventListener('input',()=>{mat.value=mat.value.replace(/\D/g,'').slice(0,5);limparMensagemLogin();});
  nasc.addEventListener('change',limparMensagemLogin);
  [mat,nasc].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter')entrarPortal();}));
  ['cadWhatsappAluno','cadRespWhatsapp'].forEach(id=>{
    const el=document.getElementById(id);
    el.addEventListener('input',()=>{el.value=mascaraWhatsapp(el.value);limparMensagemCadastro();});
  });
  mat.focus();
});

function entrarPortal(){
  const matricula=document.getElementById('matriculaInput').value.replace(/\D/g,'').slice(0,5);
  const nascimento=document.getElementById('nascimentoInput').value;
  const msg=document.getElementById('matriculaMsg');

  if(!/^\d{5}$/.test(matricula)){msg.innerHTML=`<div class="message bad">Digite exatamente os 5 algarismos da matrícula.</div>`;return;}
  if(!nascimento){msg.innerHTML=`<div class="message bad">Informe a data de nascimento.</div>`;return;}

  bloquearLogin(true);
  msg.innerHTML=`<div class="message warn">Validando seus dados com segurança...</div>`;
  google.script.run.withSuccessHandler(r=>{
    bloquearLogin(false);
    processarAutenticacao(r);
  }).withFailureHandler(e=>{
    bloquearLogin(false);
    msg.innerHTML=`<div class="message bad">${esc(e&&e.message?e.message:e)}</div>`;
  }).autenticarAluno(matricula,nascimento);
}

function processarAutenticacao(r){
  const msg=document.getElementById('matriculaMsg');
  if(!r){msg.innerHTML=`<div class="message bad">Não foi possível validar o acesso.</div>`;return;}
  if(r.status==='OK'){entrarComSessao(r);return;}
  if(r.status==='NASCIMENTO_DIVERGENTE'){
    msg.innerHTML=`<div class="message bad"><b>Data de nascimento divergente</b><br>${esc(r.mensagem||'Confira a data informada.')}</div>`;
    return;
  }
  if(r.status==='CADASTRO_PENDENTE'){
    msg.innerHTML=`<div class="message warn"><b>Cadastro aguardando revisão</b><br>${esc(r.mensagem||'Aguarde a conferência da equipe.')}</div>`;
    return;
  }
  msg.innerHTML=`<div class="message bad">Não foi possível validar os dados informados.</div>`;
}

function entrarComSessao(r){
  const a=r.aluno||{};
  alunoAtual={sessao:r.sessao,matricula:a.matricula,nome:a.nome,email:a.email,emailPessoal:a.emailPessoal||'',dataNascimento:a.dataNascimento,unidade:a.unidade,serie:a.serie,segmento:a.segmento,cpfMascarado:a.cpfMascarado,whatsappAluno:a.whatsappAluno||'',responsavelNome:a.responsavelNome||'',responsavelVinculo:a.responsavelVinculo||'',responsavelWhatsapp:a.responsavelWhatsapp||'',contatosConfirmadosAno:a.contatosConfirmadosAno||0,contatosConfirmadosNesteAno:!!a.contatosConfirmadosNesteAno,anoAtual:a.anoAtual||''};
  grupos={};grupoAtual=null;catalogoAtual=[];carrinho={};pedidoPendenteIds=[];atualizarCarrinho();
  document.getElementById('badgeNome').textContent=a.nome||'Aluno';
  document.getElementById('badgeEmail').textContent=a.email||'';
  document.getElementById('alunoBadge').classList.remove('hidden');
  document.getElementById('meusPedidosBtn').classList.add('hidden');
  document.getElementById('meusPedidosCount').textContent='0';
  document.getElementById('matriculaSec').classList.add('hidden');
  document.getElementById('home').classList.add('hidden');
  document.getElementById('grupoSec').classList.add('hidden');
  document.getElementById('cadastroSec').classList.remove('hidden');
  document.getElementById('matriculaMsg').innerHTML='';
  renderCadastroAluno();
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderCadastroAluno(){
  const a=alunoAtual||{};
  document.getElementById('cadNome').textContent=a.nome||'—';
  document.getElementById('cadMatricula').textContent=a.matricula||'—';
  document.getElementById('cadCpf').textContent=a.cpfMascarado||'Não informado';
  document.getElementById('cadUnidade').textContent=a.unidade||'—';
  document.getElementById('cadSerie').textContent=a.serie||'—';
  document.getElementById('cadNascimento').textContent=a.dataNascimento||'—';
  document.getElementById('cadEmail').textContent=a.email||'—';
  document.getElementById('cadWhatsappAluno').value=a.whatsappAluno||'';
  document.getElementById('cadEmailPessoal').value=a.emailPessoal||'';
  document.getElementById('cadRespNome').value=a.responsavelNome||'';
  document.getElementById('cadRespVinculo').value=a.responsavelVinculo||'';
  document.getElementById('cadRespWhatsapp').value=a.responsavelWhatsapp||'';

  const annual=document.getElementById('annualOk');
  if(a.contatosConfirmadosNesteAno){annual.textContent=`Contatos já confirmados em ${a.anoAtual}. Você pode apenas revisar e continuar.`;annual.classList.remove('hidden');}
  else annual.classList.add('hidden');

  configurarContatosPorSegmento(a.segmento);
  limparMensagemCadastro();
}

function configurarContatosPorSegmento(segmento){
  const seg=String(segmento||'').toUpperCase();
  const alunoBox=document.getElementById('alunoWhatsappBox');
  const respBox=document.getElementById('responsavelBox');
  const orient=document.getElementById('contatoOrientacao');
  const waReq=document.getElementById('waAlunoObrigatorio');
  const r1=document.getElementById('respObrigatorio'),r2=document.getElementById('vinculoObrigatorio'),r3=document.getElementById('respWaObrigatorio');
  [waReq,r1,r2,r3].forEach(x=>x.textContent='');

  if(seg==='EF1'){
    alunoBox.classList.add('hidden');respBox.classList.remove('hidden');
    r1.textContent='*';r2.textContent='*';r3.textContent='*';
    orient.textContent='Para alunos do 1º ao 5º ano, os contatos do responsável são obrigatórios.';
  }else if(seg==='EF2'){
    alunoBox.classList.remove('hidden');respBox.classList.remove('hidden');
    r1.textContent='*';r2.textContent='*';r3.textContent='*';
    orient.textContent='O WhatsApp do aluno é opcional. Os dados do responsável são obrigatórios.';
  }else{
    alunoBox.classList.remove('hidden');respBox.classList.remove('hidden');
    waReq.textContent='*';
    orient.textContent='Para alunos do Ensino Médio, o WhatsApp do aluno é obrigatório. Os dados do responsável são opcionais.';
  }
}

function confirmarCadastro(){
  if(!alunoAtual||!alunoAtual.sessao)return;
  const seg=String(alunoAtual.segmento||'').toUpperCase();
  const waAluno=document.getElementById('cadWhatsappAluno').value;
  const emailPessoal=document.getElementById('cadEmailPessoal').value.trim();
  const msg=document.getElementById('cadastroMsg');
  if(!emailPessoal||emailPessoal.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPessoal)){msg.innerHTML='<div class="message bad">Informe um e-mail pessoal válido. Ele pode ser do aluno ou do responsável.</div>';return;}
  const respNome=document.getElementById('cadRespNome').value.trim();
  const respVinculo=document.getElementById('cadRespVinculo').value;
  const respWa=document.getElementById('cadRespWhatsapp').value;

  if(seg==='EF1'){
    if(!respNome||!respVinculo||!whatsappValidoLocal(respWa)){msg.innerHTML='<div class="message bad">Preencha corretamente nome, vínculo e WhatsApp do responsável.</div>';return;}
  }else if(seg==='EF2'){
    if(waAluno&&!whatsappValidoLocal(waAluno)){msg.innerHTML='<div class="message bad">Confira o WhatsApp do aluno.</div>';return;}
    if(!respNome||!respVinculo||!whatsappValidoLocal(respWa)){msg.innerHTML='<div class="message bad">Preencha corretamente nome, vínculo e WhatsApp do responsável.</div>';return;}
  }else{
    if(!whatsappValidoLocal(waAluno)){msg.innerHTML='<div class="message bad">Informe um WhatsApp válido do aluno.</div>';return;}
    const algumResp=!!(respNome||respVinculo||respWa.replace(/\D/g,''));
    if(algumResp&&(!respNome||!respVinculo||!whatsappValidoLocal(respWa))){msg.innerHTML='<div class="message bad">Se informar um responsável, preencha nome, vínculo e WhatsApp.</div>';return;}
  }

  const btn=document.getElementById('confirmarCadastroBtn');btn.disabled=true;
  msg.innerHTML='<div class="message warn">Salvando a confirmação...</div>';
  google.script.run.withSuccessHandler(r=>{
    btn.disabled=false;
    document.getElementById('cadastroSec').classList.add('hidden');
    document.getElementById('home').classList.remove('hidden');
    renderHome((r&&r.home)||[]);
    atualizarResumoPedidos();
    window.scrollTo({top:0,behavior:'smooth'});
  }).withFailureHandler(e=>{
    btn.disabled=false;msg.innerHTML=`<div class="message bad">${esc(e&&e.message?e.message:e)}</div>`;
  }).confirmarCadastroAluno(alunoAtual.sessao,{whatsappAluno:waAluno,responsavelNome:respNome,responsavelVinculo:respVinculo,responsavelWhatsapp:respWa,emailPessoal});
}

function abrirSolicitacaoAlteracao(){
  document.getElementById('alteracaoTexto').value='';
  document.getElementById('alteracaoMsg').innerHTML='';
  document.getElementById('alteracaoModal').showModal();
  setTimeout(()=>document.getElementById('alteracaoTexto').focus(),50);
}
function fecharAlteracaoModal(){document.getElementById('alteracaoModal').close();}
function enviarSolicitacaoAlteracao(){
  if(!alunoAtual||!alunoAtual.sessao)return;
  const texto=document.getElementById('alteracaoTexto').value.trim();
  const msg=document.getElementById('alteracaoMsg');
  if(texto.length<5){msg.innerHTML='<div class="message bad">Descreva qual dado precisa ser corrigido.</div>';return;}
  const btn=document.getElementById('enviarAlteracaoBtn');btn.disabled=true;
  msg.innerHTML='<div class="message warn">Registrando solicitação...</div>';
  google.script.run.withSuccessHandler(r=>{
    btn.disabled=false;
    const link=r&&r.whatsappUrl?`<a class="whatsapp-link" target="_blank" rel="noopener" href="${esc(r.whatsappUrl)}">ABRIR WHATSAPP</a>`:'';
    const sem=r&&!r.whatsappConfigurado?'<div class="message warn">O número de WhatsApp da equipe ainda não está configurado no portal. A solicitação já ficou registrada para revisão.</div>':'';
    fecharAlteracaoModal();
    alunoAtual.sessao='';
    document.getElementById('confirmarCadastroBtn').disabled=true;
    document.getElementById('solicitarAlteracaoBtn').disabled=true;
    document.getElementById('cadastroMsg').innerHTML=`<div class="message ok"><b>Solicitação registrada.</b><br>${esc(r&&r.mensagem?r.mensagem:'')}</div>${sem}${link}`;
  }).withFailureHandler(e=>{btn.disabled=false;msg.innerHTML=`<div class="message bad">${esc(e&&e.message?e.message:e)}</div>`;}).solicitarAlteracaoCadastral(alunoAtual.sessao,texto);
}

function mascaraWhatsapp(valor){const d=String(valor||'').replace(/\D/g,'').slice(0,11);if(d.length<=2)return d;if(d.length<=7)return `(${d.slice(0,2)}) ${d.slice(2)}`;return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;}
function whatsappValidoLocal(valor){const d=String(valor||'').replace(/\D/g,'');return /^\d{2}9\d{8}$/.test(d);}
function bloquearLogin(on){const b=document.getElementById('loginBtn');if(b)b.disabled=!!on;}
function limparMensagemLogin(){document.getElementById('matriculaMsg').innerHTML='';}
function limparMensagemCadastro(){document.getElementById('cadastroMsg').innerHTML='';}

function trocarAluno(){
  const token=alunoAtual&&alunoAtual.sessao;
  if(token){try{google.script.run.encerrarSessaoAluno(token);}catch(e){}}
  alunoAtual=null;grupos={};grupoAtual=null;catalogoAtual=[];carrinho={};pedidoPendenteIds=[];atualizarCarrinho();
  document.getElementById('alunoBadge').classList.add('hidden');
  document.getElementById('meusPedidosBtn').classList.add('hidden');
  document.getElementById('meusPedidosCount').textContent='0';
  document.getElementById('home').classList.add('hidden');
  document.getElementById('cadastroSec').classList.add('hidden');
  document.getElementById('grupoSec').classList.add('hidden');
  document.getElementById('pedidosSec').classList.add('hidden');
  document.getElementById('pedidosLista').innerHTML='';
  document.getElementById('catalogo').innerHTML='';
  document.getElementById('matriculaSec').classList.remove('hidden');
  document.getElementById('matriculaInput').value='';
  document.getElementById('nascimentoInput').value='';
  document.getElementById('matriculaMsg').innerHTML='';
  document.getElementById('matriculaInput').focus();
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderHome(lista){
  const grid=document.getElementById('homeGrid');
  grid.innerHTML='';
  (lista||[]).forEach(g=>{
    grupos[g.id]=g;
    const card=document.createElement('article');
    card.className='org-card';
    let status='';
    if(g.abertas>0){
      status=`<span class="status-chip open">● ${g.abertas} ${g.abertas===1?'aberta':'abertas'}</span>`;
    }else if(g.emBreve>0){
      status=`<span class="status-chip soon">● ${g.emBreve} em breve</span>`;
    }else{
      status=`<span class="status-chip closed">● ${g.encerradas} ${g.encerradas===1?'encerrada':'encerradas'}</span>`;
    }
    card.innerHTML=`<div class="org-logo-box"><img class="org-logo" src="${LOGOS[g.id]||''}" alt="${esc(g.nome)}"></div><div class="org-body"><h3>${esc(g.nome)}</h3><p>${esc(g.subtitulo)}</p>${status}<button class="org-button">VER COMPETIÇÕES</button></div>`;
    card.querySelector('button').onclick=()=>abrirGrupo(g.id);
    grid.appendChild(card);
  });
}

function abrirGrupo(id){
  grupoAtual=grupos[id];if(!grupoAtual)return;
  document.getElementById('home').classList.add('hidden');
  document.getElementById('grupoSec').classList.remove('hidden');
  document.getElementById('grupoLogo').src=LOGOS[id]||'';
  document.getElementById('grupoTitulo').textContent=grupoAtual.nome;
  document.getElementById('grupoSub').textContent=grupoAtual.subtitulo;
  document.getElementById('catalogo').innerHTML='';
  document.getElementById('literaturaPerfil').classList.add('hidden');
  if(id==='LITERATURA'){buscarLiteratura();return;}
  carregarCatalogo(id);
}

function carregarCatalogo(id){loading(true);google.script.run.withSuccessHandler(lista=>{loading(false);catalogoAtual=lista||[];renderCatalogo(catalogoAtual);}).withFailureHandler(falha).getCatalogoGrupo(id);}
function renderCatalogo(lista){
  const area=document.getElementById('catalogo');
  area.innerHTML='';

  if(!lista.length){
    area.innerHTML=`<div class="empty">Nenhuma competição cadastrada para este grupo.</div>`;
    return;
  }

  if((grupoAtual.id==='LIGMAT'||grupoAtual.id==='MANDACARU')&&lista.length===1){
    const c=lista[0];
    const sec=document.createElement('section');
    sec.className='catalog-section';
    sec.innerHTML=`<div class="section-title"><div><h3>${esc(c.nomeCompleto||c.olimpiada||c.competicao)}</h3><p>Consulte a situação desta competição.</p></div></div>`;
    sec.appendChild(criarPainelUnico(c));
    area.appendChild(sec);
    return;
  }

  const gruposOlimpiada={};
  lista.forEach(c=>{
    const k=c.olimpiadaId||c.olimpiada||c.competicao;
    (gruposOlimpiada[k]||=[]).push(c);
  });

  Object.values(gruposOlimpiada).forEach(itens=>{
    const primeiro=itens[0];
    const nome=(grupoAtual.id==='SELETA')
      ? (primeiro.nomeCompleto||primeiro.olimpiada||primeiro.competicao)
      : (primeiro.nomeCompleto||primeiro.olimpiada||primeiro.competicao);

    const sec=document.createElement('section');
    sec.className='catalog-section';
    sec.innerHTML=`<div class="section-title"><div><h3>${esc(nome)}</h3><p>${itens.length>1?'Escolha a edição desejada.':'Consulte a situação desta competição.'}</p></div></div><div class="edition-list"></div>`;

    const list=sec.querySelector('.edition-list');
    itens.forEach(c=>list.appendChild(criarLinhaEdicao(c)));
    area.appendChild(sec);
  });
}

function criarPainelUnico(c){
  const painel=document.createElement('div');
  painel.className='single-panel';

  const edicao=c.edicao||c.ano||'';
  const detalhes=[];
  if(edicao)detalhes.push(`<div><b>Edição</b>${esc(edicao)}</div>`);
  if(c.fase)detalhes.push(`<div><b>Fase</b>${esc(c.fase)}</div>`);
  if(c.dataReferencia)detalhes.push(`<div><b>Data</b>${esc(c.dataReferencia)}</div>`);
  if(c.fechamentoInterno)detalhes.push(`<div><b>Inscrição pelo Ideal até</b>${esc(c.fechamentoInterno)}</div>`);
  if(c.prazoOficial)detalhes.push(`<div><b>Prazo oficial</b>${esc(c.prazoOficial)}</div>`);
  detalhes.push(`<div><b>Valor</b>${c.valor>0?money(c.valor):'A definir'}</div>`);

  painel.innerHTML=`
    <div class="single-head">
      <strong>${edicao?`Edição ${esc(edicao)}`:'Situação atual'}</strong>
      ${statusChip(c.status)}
    </div>
    <div class="single-details">${detalhes.join('')}</div>
    ${c.observacoes?`<div class="single-note">${esc(c.observacoes)}</div>`:''}
    ${c.status==='ENCERRADA'?`<div class="message bad">As inscrições desta edição já foram encerradas.</div>`:''}
    ${c.status==='EM BREVE'?`<div class="message warn">Esta edição ainda não está aberta para inscrição.</div>`:''}
    <div class="single-actions">
      ${c.status==='ABERTA'&&c.permiteInscricao?`<button class="primary go" ${c.valor<=0?'disabled':''}>${c.valor>0?'CONTINUAR':'AGUARDANDO VALOR'}</button>`:''}
    </div>`;

  const go=painel.querySelector('.go');
  if(go&&!go.disabled)go.onclick=()=>abrirPerfilSerie(c);
  return painel;
}
function criarLinhaEdicao(c){
  const row=document.createElement('div');
  row.className='edition-row';
  const status=statusChip(c.status);

  const titulo=(grupoAtual.id==='SELETA')
    ? (c.competicao||`${c.sigla||c.olimpiada} ${c.edicao||''}`.trim())
    : (c.competicao||c.olimpiada);

  const meta=[];
  if(c.fase&&c.fase!=='ÚNICA')meta.push(c.fase);
  if(c.dataReferencia)meta.push(`Data: ${c.dataReferencia}`);
  if(c.fechamentoInterno)meta.push(`Portal até: ${c.fechamentoInterno}`);
  if(c.valor>0)meta.push(`Valor: ${money(c.valor)}`);
  else meta.push('Valor ainda não definido');

  row.innerHTML=`<div><h4>${esc(titulo)}</h4><div class="meta">${meta.map(x=>`<span>${esc(x)}</span>`).join('')}</div></div><div class="row-actions">${status}<button class="smallbtn view">VER DETALHES</button>${c.status==='ABERTA'&&c.permiteInscricao?`<button class="smallbtn go" ${c.valor<=0?'disabled':''}>${c.valor>0?'CONTINUAR':'AGUARDANDO VALOR'}</button>`:''}</div>`;
  row.querySelector('.view').onclick=()=>abrirDetalhes(c);
  const go=row.querySelector('.go');
  if(go&&!go.disabled)go.onclick=()=>abrirPerfilSerie(c);
  return row;
}

function statusChip(status){if(status==='ABERTA')return`<span class="status-chip open">● ABERTA</span>`;if(status==='EM BREVE')return`<span class="status-chip soon">● EM BREVE</span>`;return`<span class="status-chip closed">● ENCERRADA</span>`;}
function abrirDetalhes(c){document.getElementById('modalTitle').textContent=c.competicao;const body=document.getElementById('modalBody');body.innerHTML=`${statusChip(c.status)}<div class="details">${c.edicao?`<div><b>Edição</b>${esc(c.edicao)}</div>`:''}${c.fase?`<div><b>Fase</b>${esc(c.fase)}</div>`:''}${c.dataReferencia?`<div><b>Data</b>${esc(c.dataReferencia)}</div>`:''}${c.fechamentoInterno?`<div><b>Inscrição pela escola até</b>${esc(c.fechamentoInterno)}</div>`:''}${c.prazoOficial?`<div><b>Prazo oficial</b>${esc(c.prazoOficial)}</div>`:''}<div><b>Valor</b>${c.valor>0?money(c.valor):'A definir'}</div></div>${c.observacoes?`<p>${esc(c.observacoes)}</p>`:''}${c.status==='ENCERRADA'?`<div class="message bad">As inscrições desta edição já foram encerradas.</div>`:''}${c.status==='EM BREVE'?`<div class="message warn">Esta edição ainda não está aberta para inscrição.</div>`:''}`;const actions=document.getElementById('modalActions');actions.innerHTML=`<button class="secondary" onclick="fecharModal()">FECHAR</button>`;if(c.status==='ABERTA'&&c.permiteInscricao&&c.valor>0){const b=document.createElement('button');b.className='primary';b.textContent='CONTINUAR';b.onclick=()=>{fecharModal();abrirPerfilSerie(c);};actions.appendChild(b);}document.getElementById('modal').showModal();}
function abrirPerfilSerie(c){
  verificarAntesDeProsseguir(c,()=>abrirPerfilSerieDireto(c));
}
function verificarAntesDeProsseguir(c,continuar){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  loading(true);
  google.script.run.withSuccessHandler(r=>{
    loading(false);
    if(r.existe){mostrarDuplicidade(c,r);return;}
    continuar();
  }).withFailureHandler(falha).verificarInscricaoExistente(alunoAtual.sessao,c.id);
}

function mostrarDuplicidade(c,r){
  document.getElementById('modalTitle').textContent='Inscrição já localizada';
  document.getElementById('modalBody').innerHTML=`<div class="message warn"><b>${esc(r.status||'SOLICITAÇÃO REGISTRADA')}</b><br>${esc(r.mensagem||'Já existe uma inscrição para esta competição.')}</div><div class="details"><div><b>Aluno</b>${esc(alunoAtual&&alunoAtual.nome||'')}</div><div><b>Competição</b>${esc((c&&c.competicao)||r.competicao||'')}</div></div><p>Não faça um novo pagamento para a mesma competição.</p>`;
  document.getElementById('modalActions').innerHTML=`<button class="secondary" onclick="fecharModal()">ENTENDI</button><button class="primary" onclick="fecharModal();abrirMeusPedidos()">🛒 VER MEUS PEDIDOS</button>`;
  document.getElementById('modal').showModal();
}

function abrirPerfilSerieDireto(c){
  document.getElementById('modalTitle').textContent=c.competicao;
  document.getElementById('modalBody').innerHTML=`<div id="serieMsg" class="message warn">Verificando sua série e seu nível...</div>`;
  document.getElementById('modalActions').innerHTML=`<button class="secondary" onclick="fecharModal()">CANCELAR</button>`;
  document.getElementById('modal').showModal();
  validarSerie(c.id);
}

function validarSerie(id){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  google.script.run.withSuccessHandler(r=>{
    const box=document.getElementById('serieMsg');
    if(!r.ok){box.className='message bad';box.innerHTML=esc(r.mensagem);return;}
    const c=r.competicao;
    box.className='message ok';
    box.innerHTML=`<b>Disponível para você.</b><br>${r.nivel?`Nível: ${esc(r.nivel)}<br>`:''}${r.aviso?esc(r.aviso):''}`;
    document.getElementById('modalActions').innerHTML=`<button class="secondary" onclick="fecharModal()">CANCELAR</button><button class="primary" ${r.selecionavel?'':'disabled'} onclick="adicionarCarrinhoSerie('${esc(c.id)}')">${r.valorPendente?'AGUARDANDO VALOR':'ADICIONAR À INSCRIÇÃO'}</button>`;
  }).withFailureHandler(e=>{const box=document.getElementById('serieMsg');if(box){box.className='message bad';box.innerHTML=esc(e.message||e);}else falha(e);}).validarCompeticaoSerie(id,alunoAtual.sessao);
}

function adicionarCarrinhoSerie(id){const c=catalogoAtual.find(x=>x.id===id);if(!c)return;carrinho[id]={...c};fecharModal();atualizarCarrinho();}

function buscarLiteratura(){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  loading(true);
  google.script.run.withSuccessHandler(r=>{loading(false);renderLiteratura(r);}).withFailureHandler(falha).getOpcoesLiteratura(alunoAtual.sessao);
}

function renderLiteratura(r){const area=document.getElementById('catalogo');area.innerHTML='';const opcoes=r.opcoes||[];if(!opcoes.length){area.innerHTML=`<div class="empty">Nenhuma competição disponível para a data de nascimento informada.</div>`;return;}const gruposLit=[['compativel','✅','Mais indicadas para você','Categorias correspondentes à faixa etária do aluno.'],['superior','⬆️','Você também pode participar','Categorias superiores permitidas para alunos mais jovens.'],['aberta','🌐','Categorias abertas','Competições sem restrição de idade.']];const wrapper=document.createElement('div');wrapper.className='lit-groups';gruposLit.forEach(([tipo,icone,titulo,sub])=>{const itens=opcoes.filter(c=>c.tipoDisponibilidade===tipo);if(!itens.length)return;const sec=document.createElement('section');sec.innerHTML=`<div class="group-head"><div class="group-icon">${icone}</div><div><h3>${titulo}</h3><p>${sub}</p></div></div><div class="cards"></div>`;const cards=sec.querySelector('.cards');itens.forEach(c=>cards.appendChild(criarCardLiteratura(c,r)));wrapper.appendChild(sec);});area.appendChild(wrapper);}
function criarCardLiteratura(c,r){const card=document.createElement('article');card.className='comp-card';const price=c.valor>0?`<div class="price">${money(c.valor)}</div>`:`<div class="price pending">Valor ainda não definido pela escola</div>`;card.innerHTML=`<div class="headc"><div class="cat">${esc(c.categoria||'Olimpíada de Literatura')}</div><h4>${esc(c.competicao)}</h4></div><div class="bodyc">${c.obraTema?`<div class="work">${esc(c.obraTema)}</div>`:''}${c.autoria?`<div class="author">${esc(c.autoria)}</div>`:''}${statusChip(c.status)}<div class="line"><b>Data:</b> ${esc(c.dataReferencia||'A definir')}</div><div class="line"><b>Portal até:</b> ${esc(c.fechamentoInterno||'A definir')}</div><div class="selected-info">${esc(c.destaque)}</div>${price}</div><label class="select-row"><input type="checkbox" ${c.selecionavel?'':'disabled'} ${carrinho[c.id]?'checked':''}>${c.status!=='ABERTA'?'Inscrições encerradas':c.valorPendente?'Aguardando valor':'Selecionar'}</label>`;const cb=card.querySelector('input');cb.onchange=()=>selecionarLiteratura(cb,c,r);return card;}
function selecionarLiteratura(cb,c,r){
  if(!cb.checked){delete carrinho[c.id];atualizarCarrinho();return;}
  if(!alunoAtual||!alunoAtual.sessao){cb.checked=false;trocarAluno();return;}
  cb.disabled=true;
  google.script.run.withSuccessHandler(x=>{
    cb.disabled=!c.selecionavel;
    if(x.existe){cb.checked=false;delete carrinho[c.id];atualizarCarrinho();mostrarDuplicidade(c,x);return;}
    carrinho[c.id]={...c};atualizarCarrinho();
  }).withFailureHandler(e=>{cb.disabled=!c.selecionavel;cb.checked=false;falha(e);}).verificarInscricaoExistente(alunoAtual.sessao,c.id);
}

function atualizarCarrinho(){const itens=Object.values(carrinho);document.getElementById('cart').classList.toggle('hidden',itens.length===0);document.getElementById('cartQtd').textContent=`${itens.length} inscrição(ões) selecionada(s)`;document.getElementById('cartTotal').textContent=money(itens.reduce((s,c)=>s+Number(c.valor||0),0));}
function continuarCarrinho(){
  const itens=Object.values(carrinho);if(!itens.length||!alunoAtual||!alunoAtual.sessao)return;
  loading(true);
  google.script.run.withSuccessHandler(r=>{
    loading(false);
    if(!r.ok){
      (r.conflitos||[]).forEach(x=>delete carrinho[x.id]);atualizarCarrinho();
      const lista=(r.conflitos||[]).map(x=>`<div class="message warn"><b>${esc(x.competicao)}</b><br>${esc(x.status)}<br>${esc(x.mensagem)}</div>`).join('');
      document.getElementById('modalTitle').textContent='Inscrição já localizada';
      document.getElementById('modalBody').innerHTML=`${lista}<p>As competições acima foram retiradas da sua seleção para evitar cobrança duplicada.</p>`;
      document.getElementById('modalActions').innerHTML=`<button class="secondary" onclick="fecharModal()">ENTENDI</button><button class="primary" onclick="fecharModal();abrirMeusPedidos()">🛒 VER MEUS PEDIDOS</button>`;
      document.getElementById('modal').showModal();return;
    }

    pedidoPendenteIds=itens.map(c=>c.id);
    const linhas=itens.map(c=>`<div class="details"><div><b>Competição</b>${esc(c.competicao)}</div><div><b>Valor</b>${money(c.valor)}</div></div>`).join('');
    const total=itens.reduce((s,c)=>s+Number(c.valor||0),0);
    document.getElementById('modalTitle').textContent='Confira suas inscrições';
    document.getElementById('modalBody').innerHTML=`<div class="message ok"><b>Identidade e duplicidade conferidas.</b><br>Confira as inscrições antes de continuar.</div><div class="details"><div><b>Aluno</b>${esc(alunoAtual.nome)}</div><div><b>E-mail</b>${esc(alunoAtual.email)}</div></div>${linhas}<p><b>Total das inscrições: ${money(total)}</b></p><div class="message warn"><b>Os pagamentos serão separados.</b><br>Cada competição gera seu próprio pedido e cobrança pelo valor exibido. Os valores nunca serão somados em um único Pix.</div>`;
    document.getElementById('modalActions').innerHTML=`<button class="secondary" onclick="fecharModal()">VOLTAR</button><button id="confirmarPedidoBtn" class="primary" onclick="confirmarPedidoCarrinho()">CONFIRMAR INSCRIÇÕES</button>`;
    document.getElementById('modal').showModal();
  }).withFailureHandler(falha).verificarCarrinhoAluno(alunoAtual.sessao,itens.map(c=>c.id));
}

function confirmarPedidoCarrinho(){
  if(!alunoAtual||!alunoAtual.sessao||!pedidoPendenteIds.length)return;
  const btn=document.getElementById('confirmarPedidoBtn');
  if(btn){btn.disabled=true;btn.textContent='REGISTRANDO...';}
  google.script.run.withSuccessHandler(r=>{
    pedidoPendenteIds=[];
    carrinho={};
    atualizarCarrinho();
    atualizarResumoPedidos();
    const pedidos=Array.isArray(r.pedidos)?r.pedidos:[];
    pagamentosNovos=pedidos.map(p=>({
      pedidoId:String(p.pedidoId||''),
      valorTotal:Number(p.total||0),
      statusPagamento:String(p.statusPagamento||'AGUARDANDO COMPROVANTE'),
      itens:[{competicao:p.item&&p.item.competicao||'Competição',valor:Number(p.total||0),nivel:p.item&&p.item.nivel||''}]
    }));
    abrirFilaPagamentosNovos(r.totalGeral!=null?r.totalGeral:r.total);
  }).withFailureHandler(e=>{
    const b=document.getElementById('confirmarPedidoBtn');if(b){b.disabled=false;b.textContent='CONFIRMAR INSCRIÇÕES';}
    falha(e);
  }).criarPedido(alunoAtual.sessao,pedidoPendenteIds);
}


function abrirFilaPagamentosNovos(totalGeral){
  const pedidos=Array.isArray(pagamentosNovos)?pagamentosNovos:[];
  if(!pedidos.length){abrirMeusPedidos();return;}
  const pendentes=pedidos.filter(p=>/AGUARDANDO[ _]COMPROVANTE/i.test(p.statusPagamento||'')).length;
  const total=Number(totalGeral!=null?totalGeral:pedidos.reduce((s,p)=>s+Number(p.valorTotal||0),0));
  const cards=pedidos.map((p,i)=>{
    const item=(p.itens&&p.itens[0])||{};
    const concluido=!/AGUARDANDO[ _]COMPROVANTE/i.test(p.statusPagamento||'');
    return `<div class="payment-queue-card ${concluido?'done':''}">
      <div><h4>${esc(item.competicao||'Competição')}</h4><p>Pedido ${esc(p.pedidoId)}${item.nivel?` • ${esc(item.nivel)}`:''}</p></div>
      <div class="payment-queue-value">${money(p.valorTotal)}</div>
      <div class="payment-queue-actions">${concluido?'<span class="payment-queue-done">✓ COMPROVANTE ENVIADO</span>':`<button class="primary" onclick="abrirPagamentoNovo(${i})">PAGAR ${money(p.valorTotal)} / ENVIAR COMPROVANTE</button>`}</div>
    </div>`;
  }).join('');
  const dlg=document.getElementById('modal');
  dlg.classList.add('wide');
  document.getElementById('modalTitle').textContent=pedidos.length>1?'Pagamentos das suas inscrições':'Pagamento da sua inscrição';
  document.getElementById('modalBody').innerHTML=`<div class="message ok"><b>Inscrições registradas com sucesso.</b><br>${pedidos.length>1?`Foram criados ${pedidos.length} pagamentos separados.`:'Foi criado 1 pagamento.'}</div><div class="payment-queue">${cards}</div><div class="payment-queue-note"><b>Total das inscrições: ${money(total)}</b><br>${pendentes?`Ainda falta${pendentes>1?'m':''} ${pendentes} pagamento${pendentes>1?'s':''}. Pague um de cada vez e anexe o comprovante correspondente.`:'Todos os comprovantes deste conjunto já foram enviados.'}</div>`;
  document.getElementById('modalActions').innerHTML=`<button class="secondary" onclick="fecharModal()">FECHAR</button><button class="secondary" onclick="fecharModal();abrirMeusPedidos()">🛒 MEUS PEDIDOS</button>`;
  if(!dlg.open)dlg.showModal();
}

function abrirPagamentoNovo(indice){
  const p=pagamentosNovos[indice];
  if(!p)return;
  const dlg=document.getElementById('modal');
  if(dlg.open)dlg.close();
  abrirPagamentoPix(p);
}

function voltarPagamentosNovos(){
  const dlg=document.getElementById('modal');
  if(dlg.open)dlg.close();
  abrirFilaPagamentosNovos();
}

function atualizarResumoPedidos(){
  if(!alunoAtual||!alunoAtual.sessao)return;
  google.script.run.withSuccessHandler(r=>{
    const qtd=Number(r&&r.quantidade||0);
    document.getElementById('meusPedidosCount').textContent=String(qtd);
    document.getElementById('meusPedidosBtn').classList.remove('hidden');
  }).withFailureHandler(e=>{
    const msg=e&&e.message?e.message:String(e||'');
    if(/sessão expirou|sessao expirou|identifique-se novamente/i.test(msg))trocarAluno();
  }).listarPedidosAluno(alunoAtual.sessao);
}

function abrirMeusPedidos(){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  document.getElementById('home').classList.add('hidden');
  document.getElementById('cadastroSec').classList.add('hidden');
  document.getElementById('grupoSec').classList.add('hidden');
  document.getElementById('pedidosSec').classList.remove('hidden');
  document.getElementById('pedidosLista').innerHTML='';
  document.getElementById('pedidosResumo').textContent='';
  document.getElementById('pedidosLoading').classList.remove('hidden');
  window.scrollTo({top:0,behavior:'smooth'});
  google.script.run.withSuccessHandler(r=>{
    document.getElementById('pedidosLoading').classList.add('hidden');
    renderMeusPedidos(r||{pedidos:[]});
  }).withFailureHandler(e=>{
    document.getElementById('pedidosLoading').classList.add('hidden');
    falha(e);
  }).listarPedidosAluno(alunoAtual.sessao);
}

function fecharMeusPedidos(){
  document.getElementById('pedidosSec').classList.add('hidden');
  if(alunoAtual){document.getElementById('home').classList.remove('hidden');}
  else trocarAluno();
  window.scrollTo({top:0,behavior:'smooth'});
}

function renderMeusPedidos(r){
  const pedidos=Array.isArray(r&&r.pedidos)?r.pedidos:[];
  const qtd=Number(r&&r.quantidade||pedidos.length||0);
  document.getElementById('meusPedidosCount').textContent=String(qtd);
  document.getElementById('meusPedidosBtn').classList.remove('hidden');
  document.getElementById('pedidosResumo').textContent=qtd===1?'1 pedido localizado.':`${qtd} pedidos localizados.`;
  const area=document.getElementById('pedidosLista');
  area.innerHTML='';
  if(!pedidos.length){
    area.innerHTML='<div class="empty">Você ainda não possui pedidos registrados neste Portal.</div>';
    return;
  }
  pedidos.forEach(p=>area.appendChild(criarCardPedido(p)));
}

function criarCardPedido(p){
  const card=document.createElement('article');
  card.className='pedido-card';

  const statusPag=p.statusPagamento||'PENDENTE';
  const statusPed=p.statusPedido||'';
  const statusBase=String(statusPag||statusPed||'').toUpperCase();
  const aguardando=/AGUARDANDO[ _]COMPROVANTE/i.test(statusPag)||/AGUARDANDO[ _]COMPROVANTE/i.test(statusPed);
  const conferencia=/AGUARDANDO[ _]CONFER[ÊE]NCIA/i.test(statusBase);
  const confirmado=/CONFIRMADO/i.test(statusBase);
  const rejeitado=/REJEITADO|RECUSADO/i.test(statusBase);
  const listaItens=Array.isArray(p.itens)?p.itens:[];
  const legadoAgrupado=listaItens.length>1;

  const itens=listaItens.map(item=>{
    const detalhes=[
      item.nivel?`Nível: ${esc(item.nivel)}`:'',
      item.statusInscricaoOficial?`Inscrição oficial: ${esc(statusLegivel(item.statusInscricaoOficial))}`:''
    ].filter(Boolean).join(' • ');
    const valorItem=Number(item.valor||p.valorTotal||0);

    const statusOficial=String(item.statusInscricaoOficial||'').toUpperCase();
    const oficialConcluida=/INSCRIT|REALIZAD|CONCLU[IÍ]D/.test(statusOficial);
    const statusPagamentoItem=String(item.statusPagamento||statusPag||'').toUpperCase();
    const pagamentoConfirmado=/CONFIRMADO/.test(statusPagamentoItem)||confirmado;

    let acao='';
    if(oficialConcluida){
      acao='<div class="pedido-item-action"><span class="pedido-item-action-status ok">✓ INSCRIÇÃO OFICIAL CONCLUÍDA</span></div>';
    }else if(aguardando&&!legadoAgrupado){
      const motivo=p.ultimoMotivoRejeicao?`<div class="message bad" style="margin:0 0 10px"><b>Último comprovante não aprovado:</b> ${esc(p.ultimoMotivoRejeicao)}<br>Envie um novo comprovante.</div>`:'';
      acao=`${motivo}<div class="pedido-item-action"><button class="remove-order-btn">REMOVER INSCRIÇÃO</button><button class="primary pix-item-btn">PAGAR ${money(valorItem)} / ENVIAR COMPROVANTE</button></div>`;
    }else if(aguardando&&legadoAgrupado){
      acao='<div class="pedido-item-action"><span class="pedido-item-action-status bad">PEDIDO ANTIGO AGRUPADO — NÃO REALIZE O PAGAMENTO. PROCURE A EQUIPE DO IDEAL OLÍMPICO.</span></div>';
    }else if(conferencia){
      acao='<div class="pedido-item-action"><span class="pedido-item-action-status warn">✓ COMPROVANTE ENVIADO — AGUARDANDO CONFERÊNCIA</span></div>';
    }else if(pagamentoConfirmado){
      acao='<div class="pedido-item-action"><span class="pedido-item-action-status ok">✓ PAGAMENTO CONFIRMADO — AGUARDANDO INSCRIÇÃO OFICIAL</span></div>';
    }else if(rejeitado){
      acao=`<div class="pedido-item-action"><span class="pedido-item-action-status bad">COMPROVANTE NÃO APROVADO — ${esc(statusLegivel(statusBase))}</span></div>`;
    }else{
      acao=`<div class="pedido-item-action"><span class="pedido-item-action-status neutral">PAGAMENTO: ${esc(statusLegivel(statusBase))}</span></div>`;
    }

    return `<div class="pedido-item"><div><b>${esc(item.competicao||item.olimpiada||'Competição')}</b><small>${detalhes||'Inscrição vinculada ao pedido'}</small></div><div class="pedido-item-valor">${money(valorItem)}</div>${acao}</div>`;
  }).join('');

  card.innerHTML=`<div class="pedido-card-head"><div><h3>${esc(p.pedidoId)}</h3><p>${p.criadoEm?`Criado em ${esc(p.criadoEm)}`:'Pedido registrado'}</p></div><div class="pedido-card-total">${money(p.valorTotal)}</div></div><div class="pedido-card-body"><div class="pedido-status-row"><span class="pedido-status ${classeStatusPedido(statusPag)}">Pagamento: ${esc(statusLegivel(statusPag))}</span>${statusPed&&statusPed!==statusPag?`<span class="pedido-status ${classeStatusPedido(statusPed)}">Pedido: ${esc(statusLegivel(statusPed))}</span>`:''}</div><div class="pedido-itens">${itens||'<div class="empty">Nenhuma inscrição vinculada foi localizada.</div>'}</div></div>`;

  card.querySelectorAll('.pix-item-btn').forEach(btn=>btn.onclick=()=>abrirPagamentoPix(p));
  card.querySelectorAll('.remove-order-btn').forEach(btn=>btn.onclick=()=>removerPedidoPendente(p,btn));
  return card;
}

function removerPedidoPendente(p,btn){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  const item=Array.isArray(p&&p.itens)&&p.itens.length?p.itens[0]:null;
  const nome=item&&(item.competicao||item.olimpiada)?(item.competicao||item.olimpiada):'esta inscrição';
  const aviso=`Remover ${nome}?\n\nUse esta opção SOMENTE se você ainda NÃO realizou o Pix.\n\nSe já efetuou o pagamento, clique em Cancelar e envie o comprovante.`;
  if(!window.confirm(aviso))return;
  const textoOriginal=btn.textContent;
  btn.disabled=true;btn.textContent='REMOVENDO...';
  google.script.run.withSuccessHandler(r=>{
    window.alert((r&&r.mensagem)||'Inscrição removida com sucesso.');
    abrirMeusPedidos();
  }).withFailureHandler(e=>{
    btn.disabled=false;btn.textContent=textoOriginal;
    falha(e);
  }).cancelarPedidoAluno(alunoAtual.sessao,p.pedidoId);
}

function abrirPagamentoPix(p){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  pixAtualCodigo='';
  pedidoPixAtualId=String(p&&p.pedidoId||'');
  const dlg=document.getElementById('modal');
  dlg.classList.add('wide');
  document.getElementById('modalTitle').textContent='Pagamento via Pix';
  document.getElementById('modalBody').innerHTML='<div class="pix-loading">Gerando o Pix do pedido...</div>';
  document.getElementById('modalActions').innerHTML='<button class="secondary" onclick="fecharModal()">FECHAR</button>';
  dlg.showModal();

  google.script.run.withSuccessHandler(r=>{
    pixAtualCodigo=String(r.pixCopiaCola||'');
    document.getElementById('modalBody').innerHTML=`<div class="message warn"><b>Pague exatamente ${money(r.total)}.</b><br>Este é o Pix individual do pedido ${esc(r.pedidoId)}. O Portal não soma pagamentos de competições diferentes.</div><div class="pix-grid"><div class="pix-qr"><div id="pixQr"></div></div><div class="pix-info"><p class="pix-value">${money(r.total)}</p><div class="details"><div><b>Recebedor</b>${esc(r.recebedor)}</div><div><b>Instituição</b>${esc(r.instituicao||'')}</div><div><b>Chave Pix</b>${esc(r.chave)}</div><div><b>Pedido</b>${esc(r.pedidoId)}</div></div><div class="pix-note">Você pode ler o QR Code com o aplicativo do seu banco ou usar o código Pix Copia e Cola abaixo. Antes de confirmar o pagamento, confira o recebedor e o valor no aplicativo.</div></div></div><div class="pix-code"><label>PIX COPIA E COLA</label><textarea id="pixCodigo" readonly>${esc(pixAtualCodigo)}</textarea><div id="pixCopyMsg" class="pix-copy-ok"></div></div><div class="proof-box"><h4>Enviar comprovante</h4><p>Depois de realizar o Pix, envie o comprovante deste pedido. Aceitamos PDF, JPG ou PNG com até 5 MB.</p><input id="comprovanteArquivo" class="proof-input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"><div id="comprovanteArquivoInfo" class="proof-meta">Nenhum arquivo selecionado.</div><div id="comprovanteStatus" class="proof-status"></div><div class="proof-actions"><button id="enviarComprovanteBtn" class="primary" onclick="enviarComprovanteAtual()">ENVIAR COMPROVANTE</button></div></div>`;
    const qr=document.getElementById('pixQr');
    if(window.QRCode&&pixAtualCodigo){
      try{new QRCode(qr,{text:pixAtualCodigo,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});}
      catch(e){qr.innerHTML='<div class="pix-note">Não foi possível desenhar o QR Code. Use o Pix Copia e Cola.</div>';}
    }else{
      qr.innerHTML='<div class="pix-note">QR Code indisponível. Use o Pix Copia e Cola.</div>';
    }
    const arq=document.getElementById('comprovanteArquivo');
    if(arq)arq.addEventListener('change',()=>{
      const info=document.getElementById('comprovanteArquivoInfo');
      const f=arq.files&&arq.files[0];
      if(!info)return;
      info.textContent=f?`${f.name} • ${formatarBytes(f.size)}`:'Nenhum arquivo selecionado.';
    });
    document.getElementById('modalActions').innerHTML='<button class="secondary" onclick="fecharModal()">FECHAR</button><button class="primary" onclick="copiarPixAtual()">COPIAR PIX</button>';
  }).withFailureHandler(e=>{
    document.getElementById('modalBody').innerHTML=`<div class="message bad">${esc(e&&e.message?e.message:String(e||'Não foi possível gerar o Pix.'))}</div>`;
  }).obterPixPedido(alunoAtual.sessao,p.pedidoId);
}

function copiarPixAtual(){
  if(!pixAtualCodigo)return;
  const msg=document.getElementById('pixCopyMsg');
  const area=document.getElementById('pixCodigo');
  const ok=()=>{if(msg)msg.textContent='Pix copiado. Agora cole no aplicativo do seu banco.';};
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(pixAtualCodigo).then(ok).catch(()=>copiarPixFallback_(area,ok));
  }else copiarPixFallback_(area,ok);
}

function copiarPixFallback_(area,ok){
  try{
    if(!area)return;
    area.focus();area.select();area.setSelectionRange(0,area.value.length);
    document.execCommand('copy');ok();
  }catch(e){alert('Não foi possível copiar automaticamente. Selecione o código Pix e copie manualmente.');}
}


function enviarComprovanteAtual(){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  if(!pedidoPixAtualId){alert('Pedido não identificado. Feche esta janela e tente novamente.');return;}

  const input=document.getElementById('comprovanteArquivo');
  const status=document.getElementById('comprovanteStatus');
  const btn=document.getElementById('enviarComprovanteBtn');
  const file=input&&input.files&&input.files[0];

  if(!file){
    if(status)status.innerHTML='<div class="message bad">Selecione o comprovante antes de enviar.</div>';
    return;
  }

  const limite=5*1024*1024;
  if(file.size<=0){
    if(status)status.innerHTML='<div class="message bad">O arquivo selecionado está vazio.</div>';
    return;
  }
  if(file.size>limite){
    if(status)status.innerHTML='<div class="message bad">O arquivo excede o limite de 5 MB.</div>';
    return;
  }

  const permitidos=['application/pdf','image/jpeg','image/png'];
  const nome=String(file.name||'').toLowerCase();
  const extensaoOk=/\.(pdf|jpe?g|png)$/.test(nome);
  if(file.type&&!permitidos.includes(file.type)&&!extensaoOk){
    if(status)status.innerHTML='<div class="message bad">Formato inválido. Envie somente PDF, JPG ou PNG.</div>';
    return;
  }

  if(btn){btn.disabled=true;btn.textContent='ENVIANDO...';}
  if(status)status.innerHTML='<div class="message warn">Enviando o comprovante com segurança...</div>';

  const reader=new FileReader();
  reader.onerror=()=>{
    if(btn){btn.disabled=false;btn.textContent='ENVIAR COMPROVANTE';}
    if(status)status.innerHTML='<div class="message bad">Não foi possível ler o arquivo selecionado.</div>';
  };
  reader.onload=()=>{
    const resultado=String(reader.result||'');
    const pos=resultado.indexOf(',');
    const base64=pos>=0?resultado.slice(pos+1):resultado;

    google.script.run.withSuccessHandler(r=>{
      const novo=pagamentosNovos.find(x=>String(x.pedidoId)===String(r.pedidoId));
      if(novo)novo.statusPagamento=String(r.status||'AGUARDANDO CONFERÊNCIA');
      const haOutros=pagamentosNovos.some(x=>/AGUARDANDO[ _]COMPROVANTE/i.test(x.statusPagamento||''));
      document.getElementById('modalBody').innerHTML=`<div class="message ok"><b>Comprovante enviado com sucesso.</b><br>O pagamento ficou com status <b>${esc(statusLegivel(r.status||'AGUARDANDO CONFERÊNCIA'))}</b>.</div><div class="details"><div><b>Pedido</b>${esc(r.pedidoId)}</div><div><b>Pagamento</b>${esc(r.pagamentoId)}</div><div><b>Arquivo</b>${esc(r.arquivoNome||file.name)}</div><div><b>Enviado em</b>${esc(r.enviadoEm||'Agora')}</div></div><p>Não é necessário enviar este comprovante novamente. A equipe do IDEAL OLÍMPICO fará a conferência do pagamento.</p>`;
      document.getElementById('modalActions').innerHTML=haOutros?'<button class="secondary" onclick="fecharModal()">FECHAR</button><button class="primary" onclick="voltarPagamentosNovos()">PAGAR PRÓXIMA INSCRIÇÃO</button>':'<button class="primary" onclick="fecharModal()">CONCLUIR</button>';
      recarregarPedidosSilencioso();
    }).withFailureHandler(e=>{
      if(btn){btn.disabled=false;btn.textContent='ENVIAR COMPROVANTE';}
      if(status)status.innerHTML=`<div class="message bad">${esc(e&&e.message?e.message:String(e||'Não foi possível enviar o comprovante.'))}</div>`;
    }).enviarComprovantePedido(
      alunoAtual.sessao,
      pedidoPixAtualId,
      {nome:file.name,mimeType:file.type||'',base64}
    );
  };
  reader.readAsDataURL(file);
}

function recarregarPedidosSilencioso(){
  if(!alunoAtual||!alunoAtual.sessao)return;
  google.script.run.withSuccessHandler(r=>renderMeusPedidos(r||{pedidos:[]})).listarPedidosAluno(alunoAtual.sessao);
}

function formatarBytes(bytes){
  const n=Number(bytes||0);
  if(n<1024)return `${n} B`;
  if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;
  return `${(n/(1024*1024)).toFixed(1)} MB`;
}

function statusLegivel(s){return String(s||'').replace(/_/g,' ').replace(/\s+/g,' ').trim();}
function classeStatusPedido(s){const n=statusLegivel(s).toUpperCase();if(/CONFIRMADO|CONCLUID|PAGO|APROVAD/.test(n))return'ok';if(/REJEIT|CANCEL|RECUS/.test(n))return'bad';if(/AGUARD|PENDENTE|ANALISE|ANÁLISE/.test(n))return'warn';return'neutral';}

function fecharModal(){const d=document.getElementById('modal');d.close();d.classList.remove('wide');pixAtualCodigo='';pedidoPixAtualId='';}function loading(on){document.getElementById('loading').classList.toggle('hidden',!on);}
function irHome(){document.getElementById('grupoSec').classList.add('hidden');document.getElementById('pedidosSec').classList.add('hidden');document.getElementById('catalogo').innerHTML='';grupoAtual=null;if(alunoAtual)document.getElementById('home').classList.remove('hidden');else trocarAluno();}
function falha(e){
  loading(false);
  const msg=e&&e.message?e.message:String(e||'Erro inesperado.');
  alert(msg);
  if(/sessão expirou|sessao expirou|identifique-se novamente/i.test(msg))trocarAluno();
}



