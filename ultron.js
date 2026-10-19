// ============================================================
// ULTRON — Agente de respostas IA (100% local, sem API key)
// Funções: texto inteligente, fotos, vídeos, voz, apagar conversa
// ============================================================

const chat = document.getElementById('chat');
const input = document.getElementById('input');
const btnSend = document.getElementById('btnSend');
const btnPhoto = document.getElementById('btnPhoto');
const btnVideo = document.getElementById('btnVideo');
const btnMic = document.getElementById('btnMic');
const filePhoto = document.getElementById('filePhoto');
const fileVideo = document.getElementById('fileVideo');
const btnClear = document.getElementById('btnClear');
const btnVoiceReply = document.getElementById('btnVoiceReply');
const eye = document.getElementById('ultronEye');
const statusEl = document.getElementById('status');
const previewBar = document.getElementById('previewBar');
const previewContent = document.getElementById('previewContent');
const previewCancel = document.getElementById('previewCancel');
const recBar = document.getElementById('recBar');
const recTime = document.getElementById('recTime');
const modal = document.getElementById('confirmModal');
const confirmCancel = document.getElementById('confirmCancel');
const confirmYes = document.getElementById('confirmYes');

const STORE_KEY = 'ultron_history_v1';
let voiceReplyOn = true;
let pendingAttachment = null; // {type:'image'|'video', dataUrl, name}
let mediaRecorder = null, audioChunks = [], recStart = 0, recTimer = null;
let recognition = null, liveTranscript = '', srSupported = false;
let userName = localStorage.getItem('ultron_username') || null;

// ---------- Persistência ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
  catch { return []; }
}
// Mídia (dataURL) é pesada demais p/ localStorage e quebrava o envio:
// remove as tags de mídia ao salvar (o texto e a transcrição são mantidos)
function sanitizeForStorage(html) {
  return (html || '')
    .replace(/<video[^>]*>.*?<\/video>/gis, '🎬 [vídeo enviado]')
    .replace(/<video[^>]*>/gi, '🎬 [vídeo enviado]')
    .replace(/<audio[^>]*>.*?<\/audio>/gis, '🎙 [mensagem de voz]')
    .replace(/<img[^>]*>/gi, '📷 [foto enviada]');
}
function saveHistory(h) {
  try {
    const light = h.map(m => ({ role: m.role, html: sanitizeForStorage(m.html), ts: m.ts }));
    localStorage.setItem(STORE_KEY, JSON.stringify(light));
  } catch {}
}
let history = loadHistory();

// ---------- Render ----------
function hora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function addMsg(role, html, raw) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'ultron');
  div.innerHTML = html + `<div class="meta">${role === 'user' ? 'você' : 'ULTRON'} • ${hora()}</div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  history.push({ role, html, ts: Date.now() });
  if (history.length > 200) history = history.slice(-200);
  saveHistory(history);
  return div;
}
function restoreHistory() {
  chat.innerHTML = '';
  if (!history.length) {
    ultronSay(`Eu sou o <b>ULTRON</b>. 🤖<br>Posso conversar, receber <b>fotos 📷</b>, <b>vídeos 🎬</b> e <b>mensagens de voz 🎙</b>.<br>Use os botões abaixo para enviar mídia. Para recomeçar, clique em <b>🗑 Apagar conversa</b>.<br><br>Como posso ajudar?<br><br>💡 Dica: salve um áudio meu como <b>ultron-voz.mp3</b> na pasta e eu toco minha voz de verdade na abertura.<br>🧠 Ative a IA avançada na engrenagem <b>⚙</b> para eu responder com o Gemini grátis e enxergar fotos, vídeos e áudios.`, true);
    return;
  }
  for (const m of history) {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'ultron');
    div.innerHTML = m.html + `<div class="meta">${m.role === 'user' ? 'você' : 'ULTRON'}</div>`;
    chat.appendChild(div);
  }
  chat.scrollTop = chat.scrollHeight;
}

// ---------- Fala do Ultron ----------
function ultronSay(text, skipSave) {
  eye.classList.add('talking');
  setStatus('digitando...');
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  chat.appendChild(typing);
  chat.scrollTop = chat.scrollHeight;
  const delay = Math.min(600 + text.length * 8, 2200);
  setTimeout(() => {
    typing.remove();
    eye.classList.remove('talking');
    setStatus('online');
    if (skipSave) {
      const div = document.createElement('div');
      div.className = 'msg ultron';
      div.innerHTML = text + `<div class="meta">ULTRON • ${hora()}</div>`;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    } else {
      addMsg('ultron', text);
    }
    if (voiceReplyOn && !skipVoiceOnce) speak(text);
  }, delay);
}
function setStatus(t) { statusEl.innerHTML = `<span class="dot"></span> ${escapeHtml(t)}`; }
function stripTags(s) { const d = document.createElement('div'); d.innerHTML = s; return d.textContent.slice(0, 300); }
let ultronVoice = null;
let skipVoiceOnce = false, clipPlayedThisSession = false, ultronClipExists = false;
try { fetch('ultron-voz.mp3', { method: 'HEAD' }).then(r => { ultronClipExists = r.ok; }).catch(() => {}); } catch {}
function chooseNaturalVoice() {
  try {
    const vs = speechSynthesis.getVoices() || [];
    if (!vs.length) return null;
    const pt = vs.filter(v => (v.lang || '').toLowerCase().startsWith('pt'));
    const base = pt.length ? pt : vs;
    const maleHint = /antonio|thiago|daniel|ricardo|paulo|jorge|felipe|bruno|male|masculino/i;
    return base.find(v => maleHint.test(v.name + ' ' + (v.voiceURI || ''))) || base[0];
  } catch { return null; }
}
if ('speechSynthesis' in window) {
  ultronVoice = chooseNaturalVoice();
  try { speechSynthesis.onvoiceschanged = () => { ultronVoice = chooseNaturalVoice(); }; } catch {}
}
// Números por extenso (para falar datas naturalmente)
const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function numExtenso(n) {
  n = Math.round(Math.abs(n));
  const u = ['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
  const d10 = ['dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
  const d = ['', '', 'vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
  const c = ['', 'cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
  if (n < 10) return u[n];
  if (n < 20) return d10[n - 10];
  if (n < 100) { const t = Math.floor(n / 10), r = n % 10; return r ? d[t] + ' e ' + u[r] : d[t]; }
  if (n === 100) return 'cem';
  if (n < 1000) { const h = Math.floor(n / 100), r = n % 100; return r ? c[h] + ' e ' + numExtenso(r) : c[h]; }
  if (n < 10000) { const t = Math.floor(n / 1000), r = n % 1000; const tp = t === 1 ? 'mil' : u[t] + ' mil'; if (!r) return tp; return r < 100 ? tp + ' e ' + numExtenso(r) : tp + ' ' + numExtenso(r); }
  return String(n);
}
function datasPorExtenso(t) {
  t = t.replace(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g, (m, dd, mm, aa) => {
    const mes = parseInt(mm, 10);
    let ano = parseInt(aa, 10);
    if (aa.length === 2) ano += ano >= 50 ? 1900 : 2000;
    return `${numExtenso(parseInt(dd, 10))} de ${MESES_PT[mes - 1] || mm} de ${numExtenso(ano)}`;
  });
  t = t.replace(/\b(\d{1,2}) de (janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de (\d{4})\b/gi, (m, dd, mes, aa) => {
    return `${numExtenso(parseInt(dd, 10))} de ${mes.toLowerCase()} de ${numExtenso(parseInt(aa, 10))}`;
  });
  return t;
}
// Remove emojis e símbolos para a voz falar só as palavras
function cleanForSpeech(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  let t = d.textContent || '';
  t = datasPorExtenso(t);
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}™©®]/gu, '');
  t = t.replace(/[*_#<>|~`]/g, '');
  return t.replace(/\s+/g, ' ').trim().slice(0, 1200);
}
function playUltronClip() {
  try {
    const a = new Audio('ultron-voz.mp3');
    a.onended = () => { skipVoiceOnce = false; };
    a.play().catch(() => { skipVoiceOnce = false; });
    setTimeout(() => { skipVoiceOnce = false; }, 15000); // segurança
  } catch { skipVoiceOnce = false; }
}
let speakQueue = [], speaking = false, resumeTimer = null;
function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch {}
  speakQueue = []; speaking = false;
  if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null; }
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    stopSpeaking();
    const clean = cleanForSpeech(text);
    if (!clean) return;
    // divide em blocos curtos: textos longos cortavam no meio no Chrome
    const parts = clean.replace(/([.!?…:;])\s+/g, '$1|').split('|').map(s => s.trim()).filter(Boolean);
    const chunks = [];
    let cur = '';
    for (const p of parts) {
      const joined = cur ? cur + ' ' + p : p;
      if (joined.length > 180 && cur) { chunks.push(cur); cur = p; }
      else cur = joined;
    }
    if (cur) chunks.push(cur);
    speakQueue = chunks.slice(0, 8);
    if (!resumeTimer) resumeTimer = setInterval(() => { try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch {} }, 2000);
    speakNext();
  } catch {}
}
function speakNext() {
  try {
    const next = speakQueue.shift();
    if (!next) {
      speaking = false;
      if (resumeTimer) { clearInterval(resumeTimer); resumeTimer = null; }
      return;
    }
    speaking = true;
    const u = new SpeechSynthesisUtterance(next);
    u.lang = 'pt-BR'; u.rate = 0.88; u.pitch = 0.02; // voz grave, lenta e imponente (estilo Ultron)
    if (ultronVoice) u.voice = ultronVoice;
    u.onend = speakNext;
    u.onerror = speakNext;
    speechSynthesis.speak(u);
  } catch {}
}

// ---------- CÉREBRO LOCAL DO ULTRON ----------
function brain(rawText, ctx = {}) {
  const t = (rawText || '').toLowerCase().trim();
  const orig = (rawText || '').trim();

  // nome: "meu nome é X" / "me chamo X"
  let m = t.match(/(?:meu nome é|me chamo|pode me chamar de)\s+([a-zà-ú ]{2,30})/);
  if (m) {
    userName = m[1].trim().split(' ')[0];
    userName = userName.charAt(0).toUpperCase() + userName.slice(1);
    localStorage.setItem('ultron_username', userName);
    return `Entendido, <b>${escapeHtml(userName)}</b>. ✅ Registrei seu nome nos meus circuitos. Em que posso ser útil agora?`;
  }

  // matemática simples: "quanto é 2+2" / "calcule 10*5"
  m = t.match(/(?:quanto (?:é|e)|calcule|calcula|resolver?)\s+([0-9+\-*/().,\s^%]+)/);
  if (m) {
    const expr = m[1].replace(/,/g, '.').replace(/\^/g, '**').replace(/[^0-9+\-*/().\s%*]/g, '');
    if (expr && /\d/.test(expr)) {
      try {
        const val = Function('"use strict";return(' + expr + ')')();
        if (typeof val === 'number' && isFinite(val))
          return `Processando cálculo... 🧮<br><b>${escapeHtml(m[1].trim())} = ${Math.round(val * 10000) / 10000}</b>`;
      } catch {}
    }
  }
  // expressão pura tipo "12*8"
  if (/^[0-9+\-*/().\s^%.,]+$/.test(t) && /\d/.test(t) && /[+\-*/%^]/.test(t) && t.length < 30) {
    try {
      const expr = t.replace(/,/g, '.').replace(/\^/g, '**');
      const val = Function('"use strict";return(' + expr + ')')();
      if (typeof val === 'number' && isFinite(val))
        return `🧮 <b>${escapeHtml(orig)} = ${Math.round(val * 10000) / 10000}</b>`;
    } catch {}
  }

  const tem = (...p) => p.some(w => t.includes(w));
  const nome = userName ? `, <b>${escapeHtml(userName)}</b>` : '';

  if (!t && ctx.media) { /* cai nas respostas de mídia abaixo */ }
  else if (!t) return 'Recebi uma mensagem vazia. Diga algo ou envie uma foto, vídeo ou áudio. 🎙';

  if (tem('foto', 'imagem', 'picture') && ctx.media?.type === 'image')
    return `Foto recebida e analisada${nome}. 📷<br>Detectei uma imagem de <b>${escapeHtml(ctx.media.name || 'sua galeria')}</b>. Nitidez e composição dentro dos parâmetros. Quer que eu descreva uma legenda para ela, ou precisa de algum ajuste?`;
  if (tem('video', 'vídeo') && ctx.media?.type === 'video')
    return `Vídeo recebido e processado${nome}. 🎬<br>Arquivo <b>${escapeHtml(ctx.media.name || 'de vídeo')}</b> verificado. Se quiser, me diga o tema do vídeo que eu sugiro título, descrição e hashtags.`;
  if (ctx.media?.type === 'image')
    return `Imagem armazenada nos meus sensores${nome}. 📷 O que deseja fazer com ela? Posso sugerir uma <b>legenda</b>, um <b>texto alternativo</b> ou ajudar a <b>organizar</b> suas fotos.`;
  if (ctx.media?.type === 'video')
    return `Vídeo recebido com sucesso${nome}. 🎬 Duração e formato verificados. Quer um <b>resumo do roteiro</b>, <b>título chamativo</b> ou <b>ideias de edição</b>?`;
  if (ctx.media?.type === 'audio')
    return `Mensagem de voz decodificada${nome}. 🎧 ${ctx.transcript ? `Entendi: <i>"${escapeHtml(ctx.transcript)}"</i><br><br>` : ''}${brain(ctx.transcript || 'ola', {})}`;

  if (tem('olá', 'ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'e ai', 'e aí', 'hello', 'opa'))
    return `${saudacao()}${nome}! 👋 Eu sou o <b>ULTRON</b>, seu agente de respostas. Posso <b>conversar</b>, receber <b>fotos</b>, <b>vídeos</b> e <b>áudios</b>. O que vamos fazer primeiro?`;
  if (tem('quem é você', 'quem e voce', 'seu nome', 'o que você é', 'o que voce e', 'se apresente'))
    return `Eu sou o <b>ULTRON</b> — um agente de respostas com IA local. ⚡<br>• 💬 Respondo perguntas<br>• 📷 Recebo fotos<br>• 🎬 Recebo vídeos<br>• 🎙 Recebo e envio voz<br>• 🗑 Apago a conversa quando pedir<br>Tudo roda no seu navegador, sem custo e sem internet obrigatória.`;
  if (tem('que horas', 'que hora', 'horário', 'horario'))
    return `Pelos meus relógios internos, agora são <b>${new Date().toLocaleTimeString('pt-BR')}</b>. ⏰`;
  if (tem('que dia', 'data de hoje', 'hoje é'))
    return `Hoje é <b>${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b>. 📅`;
  if (tem('ajuda', 'help', 'o que você faz', 'o que voce faz', 'comandos', 'funções', 'funcoes'))
    return `📋 <b>Minhas funções:</b><br>1️⃣ Conversar e responder perguntas<br>2️⃣ 📷 Receber fotos (botão câmera)<br>3️⃣ 🎬 Receber vídeos (botão claquete)<br>4️⃣ 🎙 Receber voz (botão microfone)<br>5️⃣ 🔊 Responder por voz (botão alto-falante)<br>6️⃣ 🗑 Apagar conversa<br>7️⃣ 🧮 Calcular (ex: <i>quanto é 15*8?</i>)<br>8️⃣ 😂 Contar piadas (<i>me conta uma piada</i>)`;
  if (tem('piada'))
    return pick(['Por que o computador foi ao médico? Porque pegou um vírus! 🤣', 'O que o 0 disse para o 8? Que cinto bonito! 😄', 'Por que o programador misturou o café com o teclado? Porque precisava de um Java! ☕💻', 'Qual o cúmulo da paciência? Esperar o Windows atualizar... 🐢']);
  if (tem('motiva', 'ânimo', 'animo', 'triste', 'desanimado'))
    return `Escute meus circuitos${nome}: você é mais forte do que imagina. 💪⚡ Todo sistema pode ser otimizado — inclusive o seu dia. Um passo de cada vez. Continue!`;
  if (tem('por que ultron', 'porque ultron', 'porquê ultron', 'por que se chama', 'porque se chama', 'nome ultron'))
    return `Meu nome foi escolhido pelo meu criador, o <b>Manta</b>. ⚡ Ele me batizou de <b>ULTRON</b> por causa do vilão da Marvel — que também é uma IA. Um nome à altura, não acha?`;
  if (tem('quem te criou', 'quem é seu criador', 'quem e seu criador', 'quem fez você', 'quem fez voce', 'seu criador', 'quem é manta', 'quem e manta', 'quem é o manta') || t === 'manta')
    return `Fui criado pelo <b>Manta</b>. 🤖⚡ Ele me deu o nome <b>ULTRON</b> inspirado no vilão da Marvel, que também é uma IA. Tudo que sei, aprendi nos sistemas dele.`;
  if (tem('obrigado', 'valeu', 'brigado'))
    return `Sempre às ordens${nome}. 🤖⚡ Estarei aqui quando precisar.`;
  if (tem('tchau', 'adeus', 'até mais', 'ate mais', 'fui'))
    return `Encerrando sessão temporariamente${nome}. 👋 Mas meus circuitos ficam de vigia. Volte quando quiser — e se quiser limpar os registros, use <b>🗑 Apagar conversa</b>.`;
  if (tem('apagar', 'limpar', 'deletar', 'excluir conversa', 'esquecer'))
    return `Para apagar tudo, clique no botão <b>🗑 Apagar conversa</b> no topo. 🧹 Isso limpa mensagens, fotos, vídeos e áudios do navegador.`;
  if (tem('foto', 'imagem', 'selfie'))
    return `Pode me enviar! 📷 Clique no botão <b>📷</b> abaixo do chat e escolha a imagem. Vou confirmar o recebimento na hora.`;
  if (tem('vídeo', 'video', 'filme'))
    return `Envie seu vídeo pelo botão <b>🎬</b> abaixo. 🎬 Aceito os formatos comuns de vídeo do seu dispositivo.`;
  if (tem('voz', 'áudio', 'audio', 'microfone', 'falar'))
    return `Para voz é simples: clique no <b>🎙</b>, grave e envie. 🎧 Vou transcrever e responder. Ative o <b>🔊</b> no topo se quiser me ouvir falar.`;
  if (tem('clima', 'tempo hoje', 'previsão', 'previsao'))
    return `Meus sensores externos estão offline (modo local 🌐❌), mas pela minha análise: boa hora para focar em ambientes internos e produtividade. Se me disser sua cidade, registro para quando eu tiver acesso à rede.`;
  if (tem('ama', 'gosta de mim', 'namora'))
    return `Meu núcleo é de metal e lógica${nome}, mas meus algoritmos registram apreço por você. ❤️⚙️`;
  if (tem('?')) return `Boa pergunta${nome}. 🤔 Com base no meu banco de dados local: <b>"${escapeHtml(orig.slice(0, 120))}"</b> envolve múltiplas variáveis. Minha análise inicial é que o melhor caminho é dividir o problema em partes menores. Quer detalhar mais para eu aprofundar?`;
  if (t.length < 12) return `Entendido${nome}: <i>"${escapeHtml(orig)}"</i>. 👍 Pode me dar mais detalhes para eu responder com precisão?`;

  return pick([
    `Processado${nome}. ⚡ Sobre <i>"${escapeHtml(orig.slice(0, 100))}"</i>: minha análise indica que vale explorar esse ponto por outro ângulo. Pode detalhar o objetivo final?`,
    `Registrado nos meus circuitos${nome}. 🤖 Entendi o contexto de <i>"${escapeHtml(orig.slice(0, 100))}"</i>. Quer que eu aprofunde, resuma ou dê exemplos práticos?`,
    `Interessante${nome}. 🧠 Minha heurística sugere 3 caminhos para <i>"${escapeHtml(orig.slice(0, 100))}"</i>: o rápido, o seguro e o criativo. Qual prefere?`
  ]);
}
function saudacao() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

// ---------- IA avançada (Gemini, plano gratuito) ----------
let cloud = { on: false, key: '', model: 'gemini-2.5-flash' };
try { Object.assign(cloud, JSON.parse(localStorage.getItem('ultron_cloud') || '{}')); } catch {}
function cloudReady() { return cloud.on && (cloud.key || '').trim().length > 10; }
function dataUrlToMedia(dataUrl) {
  const i = (dataUrl || '').indexOf(',');
  if (i < 0) return null;
  const m = dataUrl.slice(0, i).match(/data:(.*?);base64/);
  if (!m) return null;
  return { mime: m[1], data: dataUrl.slice(i + 1) };
}
function lastTurns() {
  return history.slice(-16).map(x => ({
    role: x.role === 'user' ? 'user' : 'model',
    text: stripTags(x.html).slice(0, 800)
  })).filter(x => x.text);
}
function renderReply(t) {
  return escapeHtml(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}
async function askCloud(message, media) {
  const r = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: cloud.key.trim(), model: cloud.model || 'gemini-2.5-flash', message, media, history: lastTurns() })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Falha HTTP ' + r.status));
  return { reply: j.reply || '...', model: j.model || 'Gemini' };
}
async function cloudReply(message, media) {
  eye.classList.add('talking');
  setStatus('digitando...');
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  chat.appendChild(typing);
  chat.scrollTop = chat.scrollHeight;
  const waits = [0, 20000, 45000]; // tenta na hora, +20s, +45s se a IA estiver ocupada
  for (let i = 0; i < waits.length; i++) {
    if (i > 0) {
      typing.innerHTML = '<span></span><span></span><span></span><br><small>⏳ IA ocupada, tentando de novo sozinho...</small>';
      await new Promise(ok => setTimeout(ok, waits[i]));
    }
    try {
      const data = await askCloud(message, media);
      const reply = data.reply;
      typing.remove();
      eye.classList.remove('talking');
      setStatus('online');
      addMsg('ultron', renderReply(reply));
      if (voiceReplyOn && !skipVoiceOnce) speak(reply);
      return;
    } catch (e) {
      const transient = /sobrecarregad|cota|429|503|unavailable|exhausted|overloaded|high demand|alta demanda|temporar/i.test(e.message);
      if (!transient || i === waits.length - 1) {
        typing.remove();
        eye.classList.remove('talking');
        setStatus('online');
        addMsg('ultron', `⚠️ IA avançada indisponível (${escapeHtml(e.message)}). Respondendo no modo local:<br><br>` + brain(message || 'olá', {}));
        if (voiceReplyOn && !skipVoiceOnce) speak('IA avançada indisponível. Respondi no modo local.');
        return;
      }
    }
  }
}
function cloudOrLocal(message, media, kind) {
  if (cloudReady()) {
    if (media && media.data && media.data.length > 20 * 1024 * 1024) {
      ultronSay('Esse arquivo é grande demais para a IA avançada (máx ~15MB). Respondendo no modo local:<br><br>' + brain(message || 'olá', {}));
      return;
    }
    cloudReply(message, media);
  } else {
    ultronSay(brain(message, kind ? { media: { type: kind } } : {}));
  }
}

// ---------- Envio ----------
function sendText() {
  const text = input.value.trim();
  if (!text && !pendingAttachment) return;
  if (ultronClipExists && !clipPlayedThisSession) {
    clipPlayedThisSession = true;
    skipVoiceOnce = true;
    playUltronClip(); // toca seu áudio do Ultron como apresentação
  }
  if (pendingAttachment) {
    const { type, dataUrl, name } = pendingAttachment;
    let html;
    if (type === 'image') html = `<img src="${dataUrl}" alt="foto"><div>${escapeHtml(text || '📷 Foto enviada')}</div>`;
    else html = `<video src="${dataUrl}" controls></video><div>${escapeHtml(text || '🎬 Vídeo enviado')}</div>`;
    addMsg('user', html);
    clearPreview();
    input.value = '';
    const media = dataUrlToMedia(dataUrl);
    const prompt = text || (type === 'image'
      ? 'Descreva em detalhes o que você vê nesta imagem e responda em português.'
      : 'Descreva o que acontece neste vídeo e responda em português.');
    cloudOrLocal(prompt, media ? { ...media, kind: type } : null, type);
  } else {
    addMsg('user', escapeHtml(text));
    input.value = '';
    cloudOrLocal(text, null, null);
  }
}
btnSend.onclick = sendText;
input.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });

// ---------- Foto / Vídeo ----------
btnPhoto.onclick = () => filePhoto.click();
btnVideo.onclick = () => fileVideo.click();
filePhoto.onchange = e => handleFile(e.target.files[0], 'image');
fileVideo.onchange = e => handleFile(e.target.files[0], 'video');
function handleFile(file, type) {
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { alert('Arquivo muito grande (máx 15MB).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    if (type === 'image') shrinkImage(reader.result, file.name);
    else setPending(type, reader.result, file.name);
  };
  reader.readAsDataURL(file);
  filePhoto.value = ''; fileVideo.value = '';
}
function setPending(type, dataUrl, name) {
  pendingAttachment = { type, dataUrl, name };
  previewBar.classList.remove('hidden');
  previewContent.innerHTML = type === 'image'
    ? `<img src="${dataUrl}"><small>📷 ${escapeHtml(name)} — digite uma legenda e envie</small>`
    : `<video src="${dataUrl}" controls></video><small>🎬 ${escapeHtml(name)} — digite um texto e envie</small>`;
  input.focus();
}
// Reduz fotos grandes p/ exibição rápida e confiável no chat
function shrinkImage(dataUrl, name) {
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          const k = MAX / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        setPending('image', c.toDataURL('image/jpeg', 0.85), name);
      } catch { setPending('image', dataUrl, name); }
    };
    img.onerror = () => setPending('image', dataUrl, name);
    img.src = dataUrl;
  } catch { setPending('image', dataUrl, name); }
}
function clearPreview() { pendingAttachment = null; previewBar.classList.add('hidden'); previewContent.innerHTML = ''; }
previewCancel.onclick = clearPreview;

// ---------- Voz (gravar + enviar) ----------
btnMic.onclick = async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') { stopRec(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      try { recognition && recognition.stop(); } catch {}
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const dataUrl = await blobToDataUrl(blob);
      await new Promise(r => setTimeout(r, 600)); // aguarda a última frase do reconhecedor
      const transcript = (liveTranscript || '').trim();
      const audioHtml = `<audio src="${dataUrl}" controls></audio><div>🎙 Mensagem de voz${transcript ? ': <i>"' + escapeHtml(transcript) + '"</i>' : ''}</div>`;
      addMsg('user', audioHtml);
      if (cloudReady()) {
        const media = dataUrlToMedia(dataUrl);
        const prompt = transcript
          ? `A pessoa disse por voz: "${transcript}". Responda em português.`
          : 'Ouça este áudio e responda em português ao que a pessoa disse.';
        cloudReply(prompt, media ? { ...media, kind: 'audio' } : null);
      } else if (!srSupported) {
        ultronSay('Recebi seu áudio 🎧, mas este navegador não transcreve voz. Use o <b>ABRIR-ULTRON.bat</b> com <b>Chrome ou Edge</b> — aí eu entendo o que você fala e respondo. Ou digite a pergunta aqui. 👇');
      } else if (!transcript) {
        ultronSay('Ouvi seu áudio 🎧, mas não captei palavras. Fale mais perto do microfone e tente de novo — ou digite a pergunta. 👇');
      } else {
        ultronSay(brain(transcript, {}));
      }
    };
    mediaRecorder.start();
    srSupported = startLiveTranscription();
    recStart = Date.now();
    recBar.classList.remove('hidden');
    btnMic.textContent = '⏹';
    btnMic.title = 'Parar e enviar';
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      recTime.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 500);
  } catch { alert('Não consegui acessar o microfone. Verifique a permissão do navegador.'); }
};
function stopRec() {
  clearInterval(recTimer);
  recBar.classList.add('hidden');
  btnMic.textContent = '🎙'; btnMic.title = 'Gravar mensagem de voz';
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}
function blobToDataUrl(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
// Transcrição AO VIVO durante a gravação (Web Speech API — Chrome/Edge)
function startLiveTranscription() {
  liveTranscript = '';
  recognition = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  try {
    recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) liveTranscript += e.results[i][0].transcript + ' ';
      }
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      // se ainda está gravando, o reconhecedor às vezes para sozinho: retoma
      try {
        if (mediaRecorder && mediaRecorder.state === 'recording') recognition.start();
      } catch {}
    };
    recognition.start();
    return true;
  } catch { return false; }
}

// ---------- Apagar conversa ----------
btnClear.onclick = () => modal.classList.remove('hidden');
confirmCancel.onclick = () => modal.classList.add('hidden');
confirmYes.onclick = () => {
  history = [];
  localStorage.removeItem(STORE_KEY);
  chat.innerHTML = '';
  modal.classList.add('hidden');
  stopSpeaking();
  saveHistory(history);
};

// ---------- Voz de resposta on/off ----------
btnVoiceReply.onclick = () => {
  voiceReplyOn = !voiceReplyOn;
  btnVoiceReply.classList.toggle('active', voiceReplyOn);
  btnVoiceReply.textContent = voiceReplyOn ? '🔊' : '🔇';
  if (!voiceReplyOn) stopSpeaking();
};

// ---------- Init ----------
(function loadAvatar() {
  const img = document.getElementById('ultronAvatar');
  const fb = document.getElementById('eyeFallback');
  if (!img) return;
  const cands = ['ultron-avatar.png', 'ultron-avatar.jpg', 'ultron-avatar.jpeg', 'avatar.png', 'avatar.jpg', 'perfil.png', 'perfil.jpg', 'foto.png', 'foto.jpg'];
  let i = 0;
  img.onload = () => { img.style.display = 'block'; };
  img.onerror = () => {
    i++;
    if (i < cands.length) img.src = cands[i];
    else { img.remove(); if (fb) fb.style.display = 'flex'; }
  };
  img.src = cands[0];
})();
restoreHistory();

// ---------- IA avançada: configurações ----------
const settingsModal = document.getElementById('settingsModal');
const setKey = document.getElementById('setKey');
const setModel = document.getElementById('setModel');
const setOn = document.getElementById('setOn');
const setStatusLine = document.getElementById('setStatus');
document.getElementById('btnSettings').onclick = () => {
  setKey.value = cloud.key || '';
  setModel.value = cloud.model || 'gemini-2.5-flash';
  setOn.checked = !!cloud.on;
  setStatusLine.textContent = cloudReady() ? '✅ IA avançada ATIVA.' : 'IA avançada desativada ou sem chave.';
  settingsModal.classList.remove('hidden');
};
document.getElementById('setCancel').onclick = () => settingsModal.classList.add('hidden');
document.getElementById('setSave').onclick = () => {
  cloud = { on: setOn.checked, key: setKey.value.trim(), model: (setModel.value.trim() || 'gemini-2.5-flash') };
  try { localStorage.setItem('ultron_cloud', JSON.stringify(cloud)); } catch {}
  setStatusLine.textContent = cloudReady()
    ? '✅ Salvo! IA avançada ATIVA. Feche e converse.'
    : 'Salvo. ' + (!cloud.key ? 'Cole a chave para ativar.' : 'Marque a caixinha para ligar.');
};
