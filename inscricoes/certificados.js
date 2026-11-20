/* Certificados (20/11/2026): os PDFs de cada competição que o aluno participou, por ano, vindos do SharePoint
   da escola por meio do Apps Script (meusCertificados). Cada item tem um link temporário (cerca de 1 hora) para
   baixar; passada a validade, a aba busca os links de novo sozinha. */
let certificados=null,certificadosEm=0;
const CERT_VALIDADE_MS=50*60*1000;

function abrirCertificados(){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  ['home','grupoSec','pedidosSec','cadastroSec','desempenhoSec','conquistasSec'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('certificadosSec').classList.remove('hidden');marcarAba('abaCertificados');
  document.getElementById('certificadosTurma').textContent=[alunoAtual.serie,alunoAtual.unidade].filter(Boolean).join(' · ');
  window.scrollTo({top:0,behavior:'smooth'});
  if(certificados&&Date.now()-certificadosEm<CERT_VALIDADE_MS){renderCertificados();return;}
  ['certificadosConteudo','certificadosMsg'].forEach(id=>{document.getElementById(id).innerHTML='';});
  document.getElementById('certificadosLoading').classList.remove('hidden');
  google.script.run.withSuccessHandler(r=>{
    document.getElementById('certificadosLoading').classList.add('hidden');
    certificados=normalizarCertificados(r);certificadosEm=Date.now();
    renderCertificados();
  }).withFailureHandler(e=>{
    document.getElementById('certificadosLoading').classList.add('hidden');
    const msg=String(e&&e.message?e.message:e);
    if(/sessão expirou|sessao expirou|identifique-se novamente/i.test(msg)){trocarAluno();return;}
    // Servidor ainda sem a função (publicação em andamento): mostra o aviso de "em breve".
    if(/não permitida|não configurada/i.test(msg)){certificados=normalizarCertificados({});certificadosEm=Date.now();renderCertificados();return;}
    document.getElementById('certificadosMsg').innerHTML=`<div class="message bad">${esc(msg)}</div>`;
  }).meusCertificados(alunoAtual.sessao);
}

/** Confere o que veio do servidor: ano inteiro, nome sem HTML, link só do SharePoint do grupo. */
function normalizarCertificados(r){
  r=r&&typeof r==='object'?r:{};
  const lista=(Array.isArray(r.certificados)?r.certificados:[])
    .filter(x=>x&&Number.isInteger(Number(x.ano))&&typeof x.nome==='string')
    .map(x=>({ano:Number(x.ano),nome:String(x.nome).slice(0,120),tamanho:Number(x.tamanho)||0,url:/^https:\/\/[a-z0-9.-]+\.sharepoint\.com\//i.test(String(x.url||''))?String(x.url):''}));
  lista.sort((a,b)=>b.ano-a.ano||a.nome.localeCompare(b.nome,'pt-BR'));
  return{lista};
}

function tamanhoCert(b){return b>=1048576?(b/1048576).toFixed(1).replace('.',',')+' MB':b>=1024?Math.round(b/1024)+' KB':b+' B';}

function renderCertificados(){
  const cont=document.getElementById('certificadosConteudo'),d=certificados;
  document.getElementById('certificadosMsg').innerHTML='';
  if(!d.lista.length){
    cont.innerHTML=`<div class="cq-vazio">${medalhaSvg('apagada','?',90)}<div><h3>Seus certificados vão aparecer aqui</h3><p>Assim que a coordenação receber os certificados das competições, cada um aparece nesta aba para você baixar.</p></div></div>`;
    return;
  }
  const anos=[...new Set(d.lista.map(x=>x.ano))].sort((a,b)=>b-a);
  cont.innerHTML=anos.map(ano=>{
    const itens=d.lista.filter(x=>x.ano===ano);
    return `<section class="cert-ano"><h3><span class="cert-ano-num">${ano}</span><small>${itens.length} ${itens.length===1?'certificado':'certificados'}</small></h3><ul class="cert-lista">`+
      itens.map(x=>`<li class="cert-item"><span class="cert-icone" aria-hidden="true">📜</span><span class="cert-nome">${esc(x.nome)}${x.tamanho?`<small>${tamanhoCert(x.tamanho)}</small>`:''}</span>`+
        (x.url?`<a class="cert-baixar" href="${esc(x.url)}" download="${esc(x.nome)}.pdf" rel="noopener">Baixar PDF</a>`:'<span class="cert-indisponivel">Indisponível agora</span>')+'</li>').join('')+
      '</ul></section>';
  }).join('');
}
