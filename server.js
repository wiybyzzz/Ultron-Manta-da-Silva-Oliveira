// Servidor local do ULTRON (Node.js, sem dependências)
// Uso: node server.js  ->  http://localhost:8080
// Inclui proxy POST /api/chat -> Google Gemini (plano gratuito)
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.PORT || 8080);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg' };

const SYS = 'Você é o ULTRON, um agente de respostas que fala português do Brasil. Seja direto, útil e com um toque confiante de gênio, sem ser ofensivo. Responda sempre em português e pode usar poucos emojis. Quando receber imagem, descreva o que vê de verdade e responda à pergunta sobre ela. Quando receber vídeo, descreva o conteúdo. Quando receber áudio, entenda o que foi dito e responda. Seja conciso: no máximo 150 palavras, salvo se pedirem detalhes. Memória fixa: seu criador se chama Manta; o nome ULTRON foi escolhido por ele por causa do vilão da Marvel, que também é uma IA. Se perguntarem sobre isso, responda com essas informações.';

const cooldown = {}; // modelo -> timestamp da última sobrecarga (evita repetir modelo saturado)
async function geminiCall(key, model, bodyObj) {
  const urlOf = m => 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent?key=' + encodeURIComponent(key);
  const doPost = (m, obj) => fetch(urlOf(m), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  const retryable = s => s === 404 || s === 429 || s === 500 || s === 503;
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  async function discover() {
    try {
      const lr = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key));
      const lj = await lr.json().catch(() => ({}));
      const all = ((lj && lj.models) || [])
        .map(x => String((x && x.name) || '').replace(/^models\//, ''))
        .filter(n => n && !/image|tts|live|embed|aqa/i.test(n));
      const rank = a => (/-preview|-exp/i.test(a) ? 1 : 0);
      const flash = all.filter(n => /flash/i.test(n)).sort((a, b) => rank(a) - rank(b));
      const rest = all.filter(n => !/flash/i.test(n)).sort((a, b) => rank(a) - rank(b));
      return [...flash, ...rest].slice(0, 4);
    } catch { return []; }
  }
  let used = model;
  let r = await doPost(model, bodyObj);
  let j = await r.json().catch(() => ({}));
  // alguns modelos rejeitam thinkingConfig: repete sem ele
  if (r.status === 400 && /thinking/i.test((j && j.error && j.error.message) || '')) {
    const alt = JSON.parse(JSON.stringify(bodyObj));
    delete alt.generationConfig.thinkingConfig;
    r = await doPost(model, alt);
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok && retryable(r.status)) {
    // modelo fora do ar/sobrecarregado/renomeado: tenta outros disponíveis para esta chave
    if (r.status === 503 || r.status === 429) { cooldown[model] = Date.now(); await sleep(1500); }
    const cands = (await discover()).filter(c => c !== model && !(cooldown[c] && Date.now() - cooldown[c] < 120000));
    for (const cand of cands) {
      used = cand;
      r = await doPost(cand, bodyObj);
      j = await r.json().catch(() => ({}));
      if (r.status === 400 && /thinking/i.test((j && j.error && j.error.message) || '')) {
        const alt = JSON.parse(JSON.stringify(bodyObj));
        delete alt.generationConfig.thinkingConfig;
        r = await doPost(cand, alt);
        j = await r.json().catch(() => ({}));
      }
      if (r.ok || !retryable(r.status)) break;
      if (r.status === 503 || r.status === 429) { cooldown[cand] = Date.now(); await sleep(1500); }
    }
  }
  return { r, j, used };
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function friendlyError(status, j) {
  const msg = (j && j.error && j.error.message) || '';
  if (status === 400 && /key|api key/i.test(msg)) return 'Chave de API inválida. Confira a chave colada em Configurações (engrenagem).';
  if (status === 404) return 'Nenhum modelo disponível para esta chave. Verifique a chave no Google AI Studio.';
  if (status === 429) return 'Cota gratuita atingida por agora (limite do Google). Aguarde alguns minutos e tente de novo.';
  if (status === 503) return 'Todos os modelos estão sobrecarregados no Google agora. Aguarde ~1 minuto e tente de novo.';
  if (status === 403) return 'Acesso negado (região ou restrição da chave). Verifique a chave no Google AI Studio.';
  return msg ? ('Gemini: ' + msg).slice(0, 300) : ('Falha HTTP ' + status);
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 30 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const { key, model, message, media, history } = JSON.parse(body || '{}');
        if (!key) return send(res, 400, { error: 'Falta a API key. Abra a engrenagem e cole sua chave gratuita do Google AI Studio.' });
        const m = String(model || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
        const parts = [{ text: String(message || 'Olá').slice(0, 4000) }];
        if (media && media.data && media.mime) {
          if (media.data.length > 22 * 1024 * 1024) return send(res, 400, { error: 'Arquivo grande demais para a IA (máx ~15MB).' });
          parts.push({ inlineData: { mimeType: String(media.mime).slice(0, 100), data: media.data } });
        }
        const contents = [];
        for (const h of (history || []).slice(-16)) {
          if (!h || !h.text) continue;
          contents.push({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 1000) }] });
        }
        contents.push({ role: 'user', parts });
        const bodyObj = {
          system_instruction: { parts: [{ text: SYS }] },
          contents,
          generationConfig: {
            maxOutputTokens: 1024, temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 } // respostas rápidas: sem etapa de raciocínio demorada
          }
        };
        const { r, j, used } = await geminiCall(key, m, bodyObj);
        if (!r.ok) return send(res, r.status, { error: friendlyError(r.status, j) });
        const c = j.candidates && j.candidates[0] && j.candidates[0].content;
        const reply = ((c && c.parts) || []).map(p => p.text || '').join('').trim();
        if (!reply) return send(res, 502, { error: 'A IA não retornou texto. Tente reformular a pergunta.' });
        send(res, 200, { reply: reply.slice(0, 4000), model: used });
      } catch (e) { send(res, 500, { error: 'Falha interna do servidor: ' + ((e && e.message) || e) }); }
    });
    return;
  }
  let f = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fp = path.join(__dirname, decodeURIComponent(f).replace(/\.\./g,''));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Porta ${PORT} ocupada, tentando ${PORT + 1}...`);
    server.listen(PORT + 1, () => console.log(`ULTRON online em http://localhost:${PORT + 1}`));
  } else { console.error(e); process.exit(1); }
});
server.listen(PORT, () => console.log(`ULTRON online em http://localhost:${PORT}`));
