/* global window, document */
// Static design mockups only. Expands <i data-icon> into lucide SVGs and wraps the page in the
// real app shell markup (sidebar + floating tab bar) captured from the running web app.
(function () {
  const svg = (name, size = 18, cls = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-${name} ${cls}" aria-hidden="true">${window.ICONS[name] ?? ''}</svg>`;

  function expandIcons(root) {
    root.querySelectorAll('i[data-icon]').forEach((el) => {
      el.outerHTML = svg(el.dataset.icon, Number(el.dataset.size || 16), el.className);
    });
  }

  const nav = [
    ['zap', 'Today', 'today'],
    ['calendar-days', 'Plan', 'plan'],
    ['messages-square', 'Coach', 'chat'],
    ['library', 'All plans', 'plans'],
    ['gauge', 'Performance', 'performance'],
  ];

  function shell(active, main) {
    const links = nav
      .map(
        ([icon, label, key]) =>
          `<a class="${key === active ? 'active' : ''}" href="#">${svg(icon)}<span>${label}</span></a>`,
      )
      .join('');
    const tabs = [
      ['zap', 'Today', 'today'],
      ['calendar-days', 'Plan', 'plan'],
      ['messages-square', 'Coach', 'chat'],
      ['circle-user-round', 'You', 'settings'],
    ]
      .map(
        ([icon, label, key]) =>
          `<a class="tab${key === active ? ' active' : ''}" href="#">${svg(icon, 22)}<span>${label}</span></a>`,
      )
      .join('');
    return `<div class="app-shell">
      <aside class="sidebar" aria-label="Sidebar">
        <div class="sidebar-brand"><a class="brand" href="#"><span class="brand-mark">A</span><strong>Askesis</strong></a>
          <button type="button" class="icon-btn icon-btn-plain">${svg('panel-left-close')}</button></div>
        <a class="sidebar-new-chat" href="#">${svg('message-square-plus', 17)}<span>New chat</span></a>
        <nav class="sidebar-nav">${links}</nav>
        <div class="sidebar-section"><span class="label">Recent chats</span><div class="sidebar-chats">
          <a class="sidebar-chat" href="#">Tuesday’s threshold run</a></div></div>
        <a class="sidebar-account" href="#"><span class="avatar">AR</span><span class="account-copy"><strong>Alex Rider</strong><small>alex@example.com</small></span></a>
      </aside>
      <div class="workspace">${main}</div>
      <nav class="tab-bar">${tabs}</nav>
    </div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('template[data-shell]');
    if (page) {
      const root = document.getElementById('root');
      root.innerHTML = shell(page.dataset.shell, page.innerHTML);
    }
    expandIcons(document);
  });
})();
