/* Minhas conquistas (18/11/2026): medalhas do aluno em todas as competições, por ano.
   Os dados vêm do Apps Script (minhasConquistas), que lê as planilhas de resultados de cada ano.
   Um ano: vitrine com as medalhas grandes + "ainda por conquistar". Todos os anos: tabela.
   A CSP do portal proíbe style="" no HTML: cores de área são classes (ar-mat, ar-fis...). */
let conquistas=null,anoConquistas=null;
const CQ_TIPOS=['ouro','prata','bronze','mencao'];
const CQ_ORDEM={ouro:0,prata:1,bronze:2,mencao:3};
const CQ_NOME={ouro:'Ouro',prata:'Prata',bronze:'Bronze',mencao:'Menção honrosa'};
const CQ_AREA={'Matemática':'ar-mat','Física':'ar-fis','Química':'ar-qui','Ciências e Tecnologia':'ar-cie','Saúde e Meio Ambiente':'ar-sau','Humanas':'ar-hum','Linguagens':'ar-lin','Finanças':'ar-fin'};
const CQ_METAL={
  ouro:{c:['#fffbe0','#ffe27a','#f2bd2c','#c98d0c','#8a5b02','#5c3b00'],f:['#7e1424','#a3233a','#f2c94c']},
  prata:{c:['#ffffff','#f1f4f8','#c9d1da','#98a3b0','#66717e','#3e4651'],f:['#163e6b','#225a96','#f4f6f9']},
  bronze:{c:['#fff0e0','#f3be8c','#d98a4c','#a85c25','#73380f','#4a2006'],f:['#14563c','#1f7a55','#e7b88c']}
};
let cqUid=0;

function abrirConquistas(){
  if(!alunoAtual||!alunoAtual.sessao){trocarAluno();return;}
  ['home','grupoSec','pedidosSec','cadastroSec','desempenhoSec'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('conquistasSec').classList.remove('hidden');marcarAba('abaConquistas');
  document.getElementById('conquistasTurma').textContent=[alunoAtual.serie,alunoAtual.unidade].filter(Boolean).join(' · ');
  window.scrollTo({top:0,behavior:'smooth'});
  if(conquistas){renderConquistas();return;}
  ['conquistasAnos','conquistasConteudo','conquistasMsg','conquistasNota'].forEach(id=>{document.getElementById(id).innerHTML='';});
  document.getElementById('conquistasLoading').classList.remove('hidden');
  google.script.run.withSuccessHandler(r=>{
    document.getElementById('conquistasLoading').classList.add('hidden');
    conquistas=normalizarConquistas(r);
    const comMedalha=conquistas.lista.map(x=>x.ano);
    anoConquistas=comMedalha.length?Math.max(...comMedalha):(conquistas.anos[0]||null);
    renderConquistas();
  }).withFailureHandler(e=>{
    document.getElementById('conquistasLoading').classList.add('hidden');
    const msg=String(e&&e.message?e.message:e);
    if(/sessão expirou|sessao expirou|identifique-se novamente/i.test(msg)){trocarAluno();return;}
    // Servidor ainda sem a função nova (publicação em andamento): mostra o aviso de "em breve".
    if(/não permitida|não configurada/i.test(msg)){conquistas=normalizarConquistas({});renderConquistas();return;}
    document.getElementById('conquistasMsg').innerHTML=`<div class="message bad">${esc(msg)}</div>`;
  }).minhasConquistas(alunoAtual.sessao);
}

/** Confere o que veio do servidor: só tipos conhecidos, anos inteiros e competições do catálogo. */
function normalizarConquistas(r){
  r=r&&typeof r==='object'?r:{};
  const cat=r.catalogo&&typeof r.catalogo==='object'?r.catalogo:{};
  const comp=id=>{const c=cat[id]||{};return{s:String(c.s||id).slice(0,14),n:String(c.n||id),a:String(c.a||'Outras')};};
  const lista=(Array.isArray(r.conquistas)?r.conquistas:[])
    .filter(x=>Array.isArray(x)&&Number.isInteger(Number(x[0]))&&CQ_TIPOS.includes(x[2]))
    .map(x=>({ano:Number(x[0]),id:String(x[1]),tipo:x[2],rotulo:String(x[3]||''),fase:String(x[4]||''),c:comp(String(x[1]))}));
  const anos=(Array.isArray(r.anos)?r.anos:[]).map(Number).filter(Number.isInteger).sort((a,b)=>b-a);
  const participou={};
  for(const a of anos)participou[a]=(r.participou&&Array.isArray(r.participou[a])?r.participou[a]:[]).map(String);
  return{lista,anos,participou,comp,atualizadoEm:String(r.atualizadoEm||'')};
}

function escolherAnoConquistas(arg){
  if(!conquistas)return;
  anoConquistas=arg==='todos'?'todos':Number(arg);
  renderConquistas();
}

function renderConquistas(){
  const d=conquistas;
  const anos=document.getElementById('conquistasAnos'),cont=document.getElementById('conquistasConteudo');
  document.getElementById('conquistasMsg').innerHTML='';
  document.getElementById('conquistasNota').textContent=(d.atualizadoEm?'Resultados atualizados em '+d.atualizadoEm+'. ':'')+'🔒 Só você vê as suas conquistas.';
  if(!d.anos.length){
    anos.innerHTML='';
    cont.innerHTML=`<div class="cq-vazio">${medalhaSvg('apagada','?',90)}<div><h3>Suas medalhas vão aparecer aqui</h3><p>Assim que a equipe do Ideal Olímpico lançar os resultados das competições, cada conquista sua acende nesta aba.</p></div></div>`;
    return;
  }
  anos.innerHTML=`<button class="${anoConquistas==='todos'?'ativo':''}" data-acao="escolherAnoConquistas" data-arg="todos" aria-pressed="${anoConquistas==='todos'}">Todos os anos</button>`+
    d.anos.map(a=>`<button class="${anoConquistas===a?'ativo':''}" data-acao="escolherAnoConquistas" data-arg="${a}" aria-pressed="${anoConquistas===a}">${a}</button>`).join('');
  cont.innerHTML=anoConquistas==='todos'?tabelaConquistas():vitrineConquistas(anoConquistas);
}

function contarConquistas(lista){const t={ouro:0,prata:0,bronze:0,mencao:0};for(const x of lista)t[x.tipo]++;return t;}
function placarConquistas(t){
  return `<div class="cq-placar">${CQ_TIPOS.map(k=>`<div class="cq-cont ${k}">${medalhaSvg(k,'',40)}<b>${t[k]}</b><span>${k==='mencao'?(t[k]===1?'Menção':'Menções'):CQ_NOME[k]+(t[k]===1?'':'s')}</span></div>`).join('')}</div>`;
}
const cqTag=x=>x.rotulo||CQ_NOME[x.tipo];

function vitrineConquistas(ano){
  const d=conquistas;
  const doAno=d.lista.filter(x=>x.ano===ano).sort((a,b)=>CQ_ORDEM[a.tipo]-CQ_ORDEM[b.tipo]||a.c.n.localeCompare(b.c.n,'pt-BR'));
  const t=contarConquistas(doAno),n=doAno.length,comps=new Set(doAno.map(x=>x.id)).size;
  const ganhas=new Set(doAno.map(x=>x.id));
  const falta=(d.participou[ano]||[]).filter(id=>!ganhas.has(id)).map(id=>({id,c:d.comp(id)})).sort((a,b)=>a.c.n.localeCompare(b.c.n,'pt-BR'));
  const pecas=n?`<div class="cq-prateleira">${doAno.map(x=>`<div class="cq-peca ${x.tipo}">${medalhaSvg(x.tipo,x.c.s,132)}<div class="cq-nome">${esc(x.c.n)}${x.fase?`<small>${esc(x.fase)}</small>`:''}</div><div class="cq-tipo ${x.tipo}">${esc(cqTag(x))}</div></div>`).join('')}</div>`
    :`<div class="cq-sem">Em ${ano}, ainda não há medalhas registradas para você. A próxima pode ser a sua!</div>`;
  return `<div class="cq-vitrine"><div class="cq-vitrine-cab"><div class="cq-vit-tit"><span class="cq-ano-grande">${ano}</span><div><b>${n} ${n===1?'conquista':'conquistas'}</b><small>${comps?`em ${comps} ${comps===1?'competição':'competições'}`:'neste ano'}</small></div></div>${placarConquistas(t)}</div>${pecas}</div>`+
    (falta.length?`<div class="cq-proximas"><h3>Ainda por conquistar em ${ano} <small>${falta.length} ${falta.length===1?'medalha esperando':'medalhas esperando'} por você</small></h3><div class="cq-mini">${falta.map(f=>`<div class="cq-mini-item">${medalhaSvg('apagada',f.c.s,46)}<span>${esc(f.c.n)}</span></div>`).join('')}</div></div>`:'');
}

function tabelaConquistas(){
  const d=conquistas,t=contarConquistas(d.lista),n=d.lista.length;
  if(!n)return `<div class="cq-vazio">${medalhaSvg('apagada','?',90)}<div><h3>Nenhuma medalha ainda</h3><p>Participe das competições do Ideal Olímpico: cada conquista sua acende aqui.</p></div></div>`;
  const porId={};
  for(const x of d.lista){const r=porId[x.id]=porId[x.id]||{c:x.c,por:{ouro:[],prata:[],bronze:[],mencao:[]}};r.por[x.tipo].push(x);}
  const linhas=Object.values(porId).map(r=>{for(const k of CQ_TIPOS)r.por[k].sort((a,b)=>b.ano-a.ano);r.peso=CQ_TIPOS.map(k=>r.por[k].length);r.tot=r.peso.reduce((a,b)=>a+b,0);return r;})
    .sort((a,b)=>{for(let i=0;i<4;i++)if(b.peso[i]!==a.peso[i])return b.peso[i]-a.peso[i];return a.c.n.localeCompare(b.c.n,'pt-BR');});
  const anosCom=[...new Set(d.lista.map(x=>x.ano))].sort((a,b)=>a-b);
  const cel=(k,l)=>l.length?`<td class="cq-td ${k}"><div class="cq-cel"><b>${l.length}</b><span>${l.map(x=>x.ano+(x.rotulo?' '+esc(x.rotulo):'')).join(' · ')}</span></div></td>`:'<td class="cq-td vazio"><span>–</span></td>';
  return `<div class="cq-resumo"><div class="cq-res-txt"><span class="cq-trofeu" aria-hidden="true">🏆</span><div><b>${n} ${n===1?'conquista':'conquistas'}</b><small>em ${linhas.length} ${linhas.length===1?'competição':'competições'} · ${anosCom[0]===anosCom[anosCom.length-1]?anosCom[0]:anosCom[0]+' a '+anosCom[anosCom.length-1]}</small></div></div>${placarConquistas(t)}</div>`+
    `<div class="cq-tabela-wrap"><table class="cq-tabela"><thead><tr><th class="cq-th-comp">Competição</th>${CQ_TIPOS.map(k=>`<th class="cq-th ${k}">${medalhaSvg(k,'',30)}<span>${k==='mencao'?'Menção':CQ_NOME[k]}</span></th>`).join('')}<th class="cq-th tot">Total</th></tr></thead>`+
    `<tbody>${linhas.map(r=>`<tr><td class="cq-comp">${medalhaSvg(CQ_TIPOS[r.peso.findIndex(x=>x>0)],r.c.s,40)}<div><b>${esc(r.c.n)}</b><span class="cq-area-chip ${CQ_AREA[r.c.a]||'ar-out'}">${esc(r.c.a)}</span></div></td>${CQ_TIPOS.map(k=>cel(k,r.por[k])).join('')}<td class="cq-td tot"><b>${r.tot}</b></td></tr>`).join('')}</tbody>`+
    `<tfoot><tr><td>Total</td>${CQ_TIPOS.map(k=>`<td class="cq-td ${k}"><b>${t[k]}</b></td>`).join('')}<td class="cq-td tot"><b>${n}</b></td></tr></tfoot></table></div>`;
}

// ---------------------------------------------------------------------------
// Medalhas em SVG: fita listrada com dobras, passador, borda serrilhada, campo rebaixado,
// louros em relevo, estrela, sigla gravada e brilho. Menção honrosa: roseta com medalhão.
// ---------------------------------------------------------------------------
function medalhaSvg(tipo,sigla,tam){
  if(tipo==='mencao')return seloSvg(sigla,tam);
  const ap=tipo==='apagada',m=CQ_METAL[ap?'prata':tipo]||CQ_METAL.prata,c=m.c,f=m.f,id='cq'+(cqUid++);
  const s=String(sigla||'');
  const fs=s.length>7?11:s.length>5?12.5:s.length>3?15:19;
  const tl=s.length>6?'textLength="54" lengthAdjust="spacingAndGlyphs"':'';
  let serr='';for(let i=0;i<90;i++){const a=i*4*Math.PI/180;serr+=`M${(60+47.5*Math.cos(a)).toFixed(2)} ${(112+47.5*Math.sin(a)).toFixed(2)}L${(60+44*Math.cos(a)).toFixed(2)} ${(112+44*Math.sin(a)).toFixed(2)}`;}
  let louro='';
  for(let i=0;i<8;i++)for(const lado of[-1,1]){const a=(90+lado*(38+i*15.5))*Math.PI/180,x=60+30*Math.cos(a),y=112+30*Math.sin(a);louro+=`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.6" ry="6.2" transform="rotate(${((a*180/Math.PI)+(lado>0?-60:60)).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;}
  const ty=s.length>5?124:126;
  return `<svg class="medalha ${tipo}" viewBox="0 0 120 166" width="${tam}" height="${Math.round(tam*166/120)}" aria-hidden="true" focusable="false"><defs>`+
    `<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[1]}"/><stop offset=".22" stop-color="${c[0]}"/><stop offset=".45" stop-color="${c[2]}"/><stop offset=".7" stop-color="${c[4]}"/><stop offset=".85" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[5]}"/></linearGradient>`+
    `<radialGradient id="${id}c" cx="42%" cy="36%" r="72%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".35" stop-color="${c[1]}"/><stop offset=".75" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></radialGradient>`+
    `<linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[5]}"/><stop offset=".5" stop-color="${c[3]}" stop-opacity=".2"/><stop offset="1" stop-color="${c[0]}"/></linearGradient>`+
    `<linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`+
    `<linearGradient id="${id}f1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${f[0]}"/><stop offset=".8" stop-color="${f[1]}"/><stop offset="1" stop-color="${f[0]}"/></linearGradient>`+
    `<linearGradient id="${id}f2" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${f[0]}"/><stop offset=".8" stop-color="${f[1]}"/><stop offset="1" stop-color="${f[0]}"/></linearGradient>`+
    `<linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".5" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[4]}"/></linearGradient>`+
    `<clipPath id="${id}k"><circle cx="60" cy="112" r="44"/></clipPath></defs>`+
    `<path d="M26 0H54L70 60H48Z" fill="url(#${id}f1)"/><path d="M34 0h6l16 60h-6Z M44 0h4l16 60h-4Z" fill="${f[2]}" opacity=".9"/>`+
    `<path d="M94 0H66L50 60H72Z" fill="url(#${id}f2)"/><path d="M86 0h-6L64 60h6Z M76 0h-4L56 60h4Z" fill="${f[2]}" opacity=".9"/>`+
    `<path d="M48 60H72L60 70Z" fill="#000" opacity=".25"/>`+
    `<rect x="44" y="58" width="32" height="12" rx="4" fill="url(#${id}p)" stroke="${c[4]}" stroke-width=".8"/><rect x="47" y="60.5" width="26" height="2.2" rx="1" fill="#fff" opacity=".55"/>`+
    `<circle cx="60" cy="72" r="5" fill="none" stroke="url(#${id}p)" stroke-width="3"/>`+
    `<circle cx="60" cy="112" r="48" fill="url(#${id}a)"/><path d="${serr}" stroke="${c[4]}" stroke-width="1.1" opacity=".55"/>`+
    `<circle cx="60" cy="112" r="40.5" fill="url(#${id}b)"/><circle cx="60" cy="112" r="38.5" fill="url(#${id}c)"/>`+
    `<g fill="${c[3]}" opacity=".9">${louro}</g><g fill="${c[0]}" opacity=".55" transform="translate(-.6 -.7)">${louro}</g>`+
    `<path d="M60 84.5l3.3 6.9 7.5.9-5.5 5.2 1.4 7.4L60 101.2l-6.7 3.7 1.4-7.4-5.5-5.2 7.5-.9z" fill="${c[3]}"/><path d="M60 84.5l3.3 6.9 7.5.9-5.5 5.2 1.4 7.4L60 101.2z" fill="${c[1]}" opacity=".7"/>`+
    (s?`<text x="60" y="${ty}" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${fs}" ${tl} fill="${c[0]}" opacity=".9" transform="translate(.7 .9)">${esc(s)}</text><text x="60" y="${ty}" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${fs}" ${tl} fill="${c[4]}">${esc(s)}</text>`:'')+
    `<path d="M44 133q16 7 32 0" fill="none" stroke="${c[3]}" stroke-width="1.4" opacity=".6"/>`+
    `<g clip-path="url(#${id}k)"><rect x="0" y="64" width="120" height="96" fill="url(#${id}g)"/></g>`+
    (tipo==='ouro'?'<g fill="#fff6c8"><path d="M104 82l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z"/><path d="M15 128l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z"/><path d="M98 146l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z"/></g>':'')+
    `</svg>`;
}

function seloSvg(sigla,tam){
  const id='cq'+(cqUid++),s=String(sigla||'');
  const fs=s.length>7?9:s.length>5?10:s.length>3?12:15;
  const tl=s.length>6?'textLength="36" lengthAdjust="spacingAndGlyphs"':'';
  const plis=(r1,r2,n)=>{let d='';for(let i=0;i<n;i++){const a0=2*Math.PI*i/n,a1=2*Math.PI*(i+.5)/n,a2=2*Math.PI*(i+1)/n;d+=`M60 74L${(60+r1*Math.cos(a0)).toFixed(1)} ${(74+r1*Math.sin(a0)).toFixed(1)}L${(60+r2*Math.cos(a1)).toFixed(1)} ${(74+r2*Math.sin(a1)).toFixed(1)}L${(60+r1*Math.cos(a2)).toFixed(1)} ${(74+r1*Math.sin(a2)).toFixed(1)}Z`;}return d;};
  const somb=(r,n)=>{let d='';for(let i=0;i<n;i++){const a0=2*Math.PI*(i+.5)/n,a1=2*Math.PI*(i+1)/n;d+=`M60 74L${(60+r*Math.cos(a0)).toFixed(1)} ${(74+r*Math.sin(a0)).toFixed(1)}L${(60+(r-3)*Math.cos(a1)).toFixed(1)} ${(74+(r-3)*Math.sin(a1)).toFixed(1)}Z`;}return d;};
  let louro='';for(let i=0;i<6;i++)for(const lado of[-1,1]){const a=(90+lado*(45+i*19))*Math.PI/180,x=60+20*Math.cos(a),y=74+20*Math.sin(a);louro+=`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="1.9" ry="4.4" transform="rotate(${((a*180/Math.PI)+(lado>0?-60:60)).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;}
  return `<svg class="medalha mencao" viewBox="0 0 120 166" width="${tam}" height="${Math.round(tam*166/120)}" aria-hidden="true" focusable="false"><defs>`+
    `<radialGradient id="${id}v" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#d0465b"/><stop offset=".55" stop-color="#9b2033"/><stop offset="1" stop-color="#5a0d19"/></radialGradient>`+
    `<radialGradient id="${id}d" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#fff2bf"/><stop offset=".5" stop-color="#e8b84a"/><stop offset="1" stop-color="#9a6a0a"/></radialGradient>`+
    `<linearGradient id="${id}o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbe0"/><stop offset=".35" stop-color="#ffd970"/><stop offset=".7" stop-color="#c98d0c"/><stop offset="1" stop-color="#6b4600"/></linearGradient>`+
    `<radialGradient id="${id}c" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".45" stop-color="#f7d466"/><stop offset="1" stop-color="#b47c08"/></radialGradient>`+
    `<linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a0d19"/><stop offset=".5" stop-color="#a3233a"/><stop offset="1" stop-color="#5a0d19"/></linearGradient></defs>`+
    `<path d="M40 100 L22 160 L36 150 L44 164 L58 106Z" fill="url(#${id}f)"/><path d="M80 100 L98 160 L84 150 L76 164 L62 106Z" fill="url(#${id}f)"/>`+
    `<path d="M44 104 L30 152 M76 104 L90 152" stroke="#f2c94c" stroke-width="2" opacity=".85"/>`+
    `<path d="${plis(54,50,36)}" fill="url(#${id}v)"/><path d="${somb(54,36)}" fill="#3d0710" opacity=".35"/>`+
    `<path d="${plis(42,39,30)}" fill="url(#${id}d)"/><path d="${somb(42,30)}" fill="#6b4600" opacity=".35"/>`+
    `<circle cx="60" cy="74" r="31" fill="url(#${id}o)"/><circle cx="60" cy="74" r="27" fill="url(#${id}c)"/><circle cx="60" cy="74" r="27" fill="none" stroke="#8a5b02" stroke-opacity=".5"/>`+
    `<g fill="#a8740a">${louro}</g><g fill="#fffbe0" opacity=".6" transform="translate(-.5 -.5)">${louro}</g>`+
    `<path d="M60 55l2.6 5.3 5.8.7-4.3 4 1.1 5.8L60 68l-5.2 2.8 1.1-5.8-4.3-4 5.8-.7z" fill="#a8740a"/>`+
    (s?`<text x="60" y="84" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${fs}" ${tl} fill="#fffbe0" transform="translate(.6 .7)">${esc(s)}</text><text x="60" y="84" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="${fs}" ${tl} fill="#7a4f00">${esc(s)}</text>`:'')+
    `<path d="M44 62 a22 22 0 0 1 22 -9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/></svg>`;
}
