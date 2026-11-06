/* Faixa de identificação injetada em versões ARQUIVADAS (compilações de commits antigos, sem informação de versão própria). */
(function () {
  var I = {"version":"0.1.0","channel":"stable","commit":"2016952","title":"Protótipo evolutivo","home":"../../"};
  var CH = { stable: 'estável', experimental: 'experimental', dev: 'desenvolvimento' };
  try { if (sessionStorage.getItem('gs-badge-off') === '1') return; } catch (e) {}
  var d = document.createElement('div');
  d.setAttribute('role', 'note');
  d.style.cssText = 'position:fixed;top:3px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;gap:8px;align-items:center;max-width:94vw;background:rgba(6,10,20,.88);color:#cfe0f5;border:1px solid #2a4268;border-radius:999px;padding:2px 6px 2px 10px;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;backdrop-filter:blur(4px);white-space:nowrap;overflow:hidden';
  var t = document.createElement('a');
  t.href = I.home; t.textContent = 'GS Evolução v' + I.version + ' · ' + (CH[I.channel] || I.channel) + ' · arquivo (commit ' + I.commit + ') ↩ versões';
  t.style.cssText = 'color:#4dd6c4;text-decoration:none;overflow:hidden;text-overflow:ellipsis';
  t.title = I.title;
  var x = document.createElement('button');
  x.textContent = '×'; x.setAttribute('aria-label', 'Ocultar faixa');
  x.style.cssText = 'background:none;border:0;color:#8aa0bf;font-size:15px;line-height:1;padding:2px 6px;cursor:pointer';
  x.onclick = function () { d.remove(); try { sessionStorage.setItem('gs-badge-off', '1'); } catch (e) {} };
  d.appendChild(t); d.appendChild(x); document.body.appendChild(d);
})();
