(() => {
  const css = document.createElement('style');
  css.textContent = `
    .cs-support-launch{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:85;border:0;border-radius:999px;
      display:flex;align-items:center;gap:8px;padding:7px 16px 7px 7px;background:var(--accent);color:var(--accent-ink);font-family:inherit;font-size:14px;font-weight:700;
      box-shadow:0 5px 20px #0003;cursor:pointer}
    .cs-support-launch[hidden]{display:none}
    .cs-support-launch img{width:36px;height:36px;object-fit:contain;background:#eff2e7;border-radius:50%}
    .cs-support-launch:focus-visible,.cs-support-panel button:focus-visible,.cs-support-panel textarea:focus-visible,.cs-support-panel a:focus-visible
      {outline:3px solid var(--ink);outline-offset:2px}
    .cs-support-panel{position:fixed;right:18px;bottom:calc(86px + env(safe-area-inset-bottom,0px));z-index:86;width:min(370px,calc(100vw - 36px));
      max-height:min(670px,calc(100dvh - 100px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)));display:flex;flex-direction:column;background:var(--surface);
      color:var(--ink);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 55px #0004;overflow:hidden}
    .cs-support-panel[hidden]{display:none}
    .cs-support-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 17px;
      border-bottom:1px solid var(--line)}
    .cs-support-head img{width:46px;height:46px;object-fit:contain;background:#eff2e7;border-radius:50%;flex:none}
    .cs-support-head h2{font-size:17px;margin:0}
    .cs-support-head p{font-size:12px;color:var(--muted);margin:0}
    .cs-support-head button{background:transparent;border:0;color:var(--ink);font-size:23px;cursor:pointer}
    .cs-support-messages{display:flex;flex-direction:column;gap:10px;min-height:110px;overflow:auto;padding:16px}
    .cs-support-message{max-width:92%;padding:10px 12px;border-radius:12px;background:var(--surface-2);
      white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.45}
    .cs-support-message.user{align-self:flex-end;background:var(--accent);color:var(--accent-ink)}
    .cs-support-note{font-size:12px;color:var(--muted);line-height:1.4;padding:0 16px 10px;margin:0}
    .cs-support-note a{color:var(--accent);font-weight:700}
    .cs-support-prompts{display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 10px}
    .cs-support-prompts button{border:1px solid var(--line);background:var(--surface-2);color:var(--ink);border-radius:999px;padding:5px 9px;font-size:12px;cursor:pointer}
    .cs-support-form{display:flex;gap:8px;padding:10px 14px 14px;border-top:1px solid var(--line)}
    .cs-support-form textarea{flex:1;min-width:0;resize:vertical;max-height:120px;border:1px solid var(--line);
      border-radius:9px;padding:9px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
    .cs-support-form button{align-self:end;background:var(--accent);color:var(--accent-ink);
      border:0;border-radius:9px;padding:11px;cursor:pointer;font-weight:700}
    @media (max-width:860px){
      .cs-support-launch{right:12px;bottom:calc(88px + env(safe-area-inset-bottom,0px))}
      .cs-support-panel{right:12px;bottom:calc(156px + env(safe-area-inset-bottom,0px));width:min(370px,calc(100vw - 24px));
        max-height:min(670px,calc(100dvh - 170px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)))}
    }
  `;
  document.head.appendChild(css);

  function mount() {
    const launch = document.createElement('button');
    launch.type = 'button';
    launch.className = 'cs-support-launch';
    launch.innerHTML = '<img src="/einstein-help.svg" alt="">Help';
    launch.setAttribute('aria-label', 'Open ClassScribe Help chatbot');
    launch.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('section');
    panel.className = 'cs-support-panel';
    panel.id = 'cs-support-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ClassScribe Help chatbot');
    panel.hidden = true;
    panel.innerHTML = `<div class="cs-support-head"><img src="/einstein-help.svg" alt="Cartoon portrait inspired by Albert Einstein"><div style="flex:1"><h2>ClassScribe Help</h2><p>Illustrated tribute to Albert Einstein.</p><p>Answers by ClassScribe AI, not Einstein.</p></div><button type="button" aria-label="Close Help">×</button></div>
      <div class="cs-support-messages" role="log" aria-live="polite"></div>
      <div class="cs-support-prompts"><button type="button">Compare the plans</button><button type="button" data-question="Is ClassScribe EDU available?">ClassScribe EDU</button><button type="button" data-question="Is ClassScribe Law available?">ClassScribe Law</button><button type="button" data-question="Is ClassScribe Medicine available?">ClassScribe Medicine</button></div>
      <p class="cs-support-note">ClassScribe EDU, ClassScribe Law, and ClassScribe Medicine are planned, not available yet. If Help cannot answer, it will try urgent support. You can also <a href="mailto:edmitainvestmentllc@edmitainvest.com?subject=URGENT%3A%20ClassScribe%20support">email urgent support directly</a>. On smaller screens, Urgent contact is at the top of each page.</p>
      <form class="cs-support-form"><textarea aria-label="Support question" maxlength="1500" rows="2" required placeholder="How can we help?"></textarea><button type="submit">Send</button></form>`;
    document.body.append(launch, panel);
    const log = panel.querySelector('.cs-support-messages');
    const form = panel.querySelector('form');
    const input = form.querySelector('textarea');
    const submit = form.querySelector('button');
    const history = [];
    const message = (text, role = 'assistant') => {
      const el = document.createElement('div');
      el.className = `cs-support-message ${role}`;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    };
    message('Hi! Ask me about features, plans, limits, or how to use ClassScribe.');
    panel.querySelectorAll('.cs-support-prompts button').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.question || button.textContent;
        form.requestSubmit();
      });
    });
    function close() {
      panel.hidden = true;
      launch.setAttribute('aria-expanded', 'false');
      launch.focus();
    }
    const app = document.querySelector('.app');
    if (app) {
      const syncHelpVisibility = () => {
        const hiddenOnPage = ['contact', 'capture', 'notes', 'ask', 'exam'].includes(app.dataset.view);
        launch.hidden = hiddenOnPage;
        if (hiddenOnPage) {
          panel.hidden = true;
          launch.setAttribute('aria-expanded', 'false');
        }
      };
      new MutationObserver(syncHelpVisibility).observe(app, { attributes: true, attributeFilter: ['data-view'] });
      syncHelpVisibility();
    }
    launch.onclick = () => {
      panel.hidden = !panel.hidden;
      launch.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) input.focus();
    };
    panel.querySelector('.cs-support-head button').onclick = close;
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question || submit.disabled) return;
      input.value = '';
      submit.disabled = true;
      message(question, 'user');
      try {
        const uid = typeof S === 'object' ? S.uid : null;
        if (!uid) throw new Error('Create or open your library before using support.');
        const response = await fetch('/api/support', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CS-User': uid },
          body: JSON.stringify({ question, history: history.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 800) })) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Support is unavailable right now.');
        const answer = String(result.answer || 'I could not answer that question.');
        message(answer);
        history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
        if (result.escalation === 'sent') message('Your unanswered question was submitted for urgent review.');
        if (result.escalation === 'failed') {
          message('Automatic urgent delivery failed. Use the email urgent support link below to start a draft in your mail app, then press Send yourself.');
        }
      } catch (error) {
        message((error.message || 'Support is unavailable.') + ' Use the email urgent support link below to start a draft in your mail app, then press Send yourself.');
      } finally {
        submit.disabled = false;
        input.focus();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();