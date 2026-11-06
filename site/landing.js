// Página inicial de versões do GS Evolução. Lê versions.json (gerado no build a partir de versions/versions.json) e monta a página.
// Sem dependências; todo texto vindo do JSON entra por textContent (nada de HTML do JSON).
(function () {
  'use strict';
  var CH = { stable: 'estável', experimental: 'experimental', dev: 'desenvolvimento' };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function list(items) { var ul = el('ul'); items.forEach(function (t) { ul.appendChild(el('li', null, t)); }); return ul; }
  function chip(ch) { return el('i', 'ch ' + ch, CH[ch] || ch); }
  function fmtDate(d) { try { return new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }); } catch (e) { return d; } }
  function section(title, items) { if (!items || !items.length) return null; var d = el('div'); d.appendChild(el('h4', null, title)); d.appendChild(list(items)); return d; }

  function render(reg) {
    var cur = reg.versions.filter(function (v) { return v.id === reg.current; })[0] || reg.versions[0];
    document.getElementById('cur-name').textContent = reg.produto;
    document.getElementById('cur-ver').textContent = 'v' + cur.id;
    var c = document.getElementById('cur-ch'); c.className = 'ch ' + cur.channel; c.textContent = CH[cur.channel] || cur.channel;
    document.getElementById('cur-title').textContent = cur.title;
    var warn = document.getElementById('cur-warn');
    if (cur.channel !== 'stable') { warn.hidden = false; warn.textContent = (cur.channel === 'dev' ? 'Versão de desenvolvimento: pode quebrar. ' : 'Versão experimental: funciona e foi testada, mas ainda tem ressalvas (veja "Problemas conhecidos"). ') + 'Ela não é apresentada como estável.'; }
    var meta = document.getElementById('cur-meta');
    [['Versão', 'v' + cur.id], ['Canal', CH[cur.channel] || cur.channel], ['Etapa', String(cur.stage)], ['Publicada em', fmtDate(reg.site && reg.site.builtAt ? reg.site.builtAt.slice(0, 10) : cur.date)], ['Commit publicado', (reg.site && reg.site.commit) || '—']].forEach(function (kv) {
      var d = el('div'); d.appendChild(el('dt', null, kv[0])); d.appendChild(el('dd', null, kv[1])); meta.appendChild(d);
    });
    var news = document.getElementById('cur-news');
    [['Novidades', cur.novelties], ['Alterações visuais', cur.visual], ['Mecanismos evolutivos', cur.evolutionary], ['Melhorias ecológicas', cur.ecological], ['Correções', cur.fixes], ['Testes realizados', cur.tests]].forEach(function (p) {
      if (!p[1] || !p[1].length) return; var card = el('div', 'card'); card.appendChild(el('h3', null, p[0])); card.appendChild(list(p[1])); news.appendChild(card);
    });
    var st = document.getElementById('stages');
    reg.etapas.forEach(function (e) {
      var li = el('li'); var n = el('span', 'n' + (e.estado === 'concluida' ? '' : ' pend'), String(e.n));
      var mid = el('div'); mid.appendChild(el('b', null, e.titulo)); mid.appendChild(el('small', null, (e.estado === 'concluida' ? 'Concluída' : 'Em andamento') + ' · v' + e.versao + (e.nota ? ' · ' + e.nota : '')));
      li.appendChild(n); li.appendChild(mid);
      var v = reg.versions.filter(function (x) { return x.id === e.versao; })[0]; if (v) li.appendChild(chip(v.channel));
      st.appendChild(li);
    });
    var box = document.getElementById('versions');
    reg.versions.forEach(function (v) {
      var d = el('details', 'v' + (v.id === reg.current ? ' current' : '')); if (v.id === reg.current) d.open = false;
      var s = el('summary'); var b = el('b', null, 'v' + v.id); s.appendChild(b); s.appendChild(chip(v.channel));
      s.appendChild(el('small', null, v.title + ' · ' + fmtDate(v.date) + ' · etapa ' + v.stage + (v.commit ? ' · commit ' + v.commit : '') + (v.id === reg.current ? ' · versão atual' : '')));
      d.appendChild(s);
      var det = el('div', 'detail');
      [section('Novidades', v.novelties), section('Visual', v.visual), section('Mecanismos evolutivos', v.evolutionary), section('Melhorias ecológicas', v.ecological), section('Correções', v.fixes), section('Problemas conhecidos', v.knownIssues), section('Testes realizados', v.tests)].forEach(function (x) { if (x) det.appendChild(x); });
      d.appendChild(det);
      var act = el('div', 'actions');
      var url = v.id === reg.current ? 'jogo/' : (v.available ? v.url : null);
      if (url) { var a = el('a', 'btn' + (v.id === reg.current ? ' primary' : ''), v.id === reg.current ? '▶ Abrir o jogo (atual)' : '▶ Abrir v' + v.id); a.href = url; act.appendChild(a); }
      else act.appendChild(el('span', 'muted', 'Esta versão não está hospedada.'));
      if (v.id !== reg.current && v.available) { var a2 = el('a', 'btn', 'Comparar com a atual'); a2.href = 'jogo/'; a2.target = '_self'; act.appendChild(a2); }
      d.appendChild(act); box.appendChild(d);
    });
    var iss = document.getElementById('issues'); var any = false;
    reg.versions.forEach(function (v) {
      (v.knownIssues || []).forEach(function (t) { any = true; var i = el('div', 'issue', t); i.appendChild(el('small', null, 'v' + v.id + ' · ' + (CH[v.channel] || v.channel))); iss.appendChild(i); });
    });
    if (!any) iss.appendChild(el('p', 'muted', 'Nenhum problema conhecido registrado.'));
    var fb = document.getElementById('foot-build');
    fb.textContent = reg.produto + ' v' + cur.id + ' (' + (CH[cur.channel] || cur.channel) + ') · publicado do commit ' + ((reg.site && reg.site.commit) || '—') + (reg.site && reg.site.builtAt ? ' em ' + reg.site.builtAt : '');
    document.title = reg.produto + ' v' + cur.id + ' — versões e novidades';
  }

  fetch('versions.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(render).catch(function () {
    document.getElementById('cur-title').textContent = 'Não foi possível carregar a lista de versões agora. O jogo continua disponível pelo botão abaixo.';
  });
})();
