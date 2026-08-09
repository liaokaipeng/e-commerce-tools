// 目录选择对话框（浏览本地文件夹）
// 用法：openDirPicker((dir) => { ... })  选中后回调绝对路径
(function (global) {
  'use strict';
  let onSelect = null;
  let currentPath = null; // null 表示盘符列表（Windows）

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function injectCss() {
    if (document.getElementById('dp-style')) return;
    const style = document.createElement('style');
    style.id = 'dp-style';
    style.textContent = `
      #dp-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,.45); display: none;
        align-items: center; justify-content: center;
        font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      }
      #dp-overlay.dp-open { display: flex; }
      #dp-box {
        width: 560px; max-width: 92vw; max-height: 82vh;
        background: #fff; border-radius: 12px; overflow: hidden;
        box-shadow: 0 12px 40px rgba(0,0,0,.25);
        display: flex; flex-direction: column;
      }
      #dp-head { padding: 14px 18px; border-bottom: 1px solid #eee; font-size: 15px; font-weight: 600; }
      #dp-current {
        padding: 8px 18px; font-size: 12px; color: #888;
        border-bottom: 1px solid #f0f0f0; word-break: break-all;
      }
      #dp-list { flex: 1; overflow-y: auto; padding: 6px 8px; min-height: 200px; }
      #dp-list .dp-empty { color: #999; font-size: 13px; padding: 20px; text-align: center; }
      .dp-row {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px;
      }
      .dp-row:hover { background: #f5f6fa; }
      .dp-row .dp-ico { color: #f0a500; flex-shrink: 0; }
      #dp-actions { display: flex; gap: 10px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #eee; }
      #dp-actions button {
        border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer;
        font-family: inherit; border: 1px solid #ddd; background: #fff; color: #333;
      }
      #dp-actions button:hover { background: #f0f2f7; }
      #dp-ok { border: none !important; background: #ee4d2d !important; color: #fff !important; font-weight: 600; }
      #dp-ok:hover { background: #d7441f !important; }
    `;
    document.head.appendChild(style);
  }

  function open() {
    injectCss();
    const overlay = document.getElementById('dp-overlay') || build();
    overlay.classList.add('dp-open');
    currentPath = null;
    load(null);
  }

  function close() {
    const overlay = document.getElementById('dp-overlay');
    if (overlay) overlay.classList.remove('dp-open');
  }

  function build() {
    const overlay = el('div', '', '');
    overlay.id = 'dp-overlay';
    const box = el('div', '', '');
    box.id = 'dp-box';
    const head = el('div', '', '选择保存目录');
    head.id = 'dp-head';
    const cur = el('div', '', '');
    cur.id = 'dp-current';
    const list = el('div', '', '');
    list.id = 'dp-list';
    const actions = el('div', '', '');
    actions.id = 'dp-actions';
    const upBtn = el('button', '', '上级目录');
    const cancelBtn = el('button', '', '取消');
    const okBtn = el('button', '', '选择此目录');
    okBtn.id = 'dp-ok';
    actions.append(upBtn, cancelBtn, okBtn);
    box.append(head, cur, list, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    upBtn.addEventListener('click', () => {
      if (currentPath) load(currentPath);
      else load(null);
    });
    cancelBtn.addEventListener('click', close);
    okBtn.addEventListener('click', () => {
      const dir = currentPath;
      if (!dir) { alert('请先进入一个目录'); return; }
      close();
      if (onSelect) onSelect(dir);
    });
    return overlay;
  }

  async function load(p) {
    const list = document.getElementById('dp-list');
    const curBox = document.getElementById('dp-current');
    const q = p ? '?path=' + encodeURIComponent(p) : '';
    list.innerHTML = '';
    curBox.textContent = '加载中…';
    try {
      const r = await fetch('/api/browse' + q);
      const d = await r.json();
      if (!d.ok) { curBox.textContent = '无法访问：' + d.message; return; }
      currentPath = d.current;
      curBox.textContent = d.current ? ('当前目录：' + d.current) : '请选择磁盘';
      if (!d.dirs.length) {
        list.appendChild(el('div', 'dp-empty', '（该目录下没有子文件夹）'));
      }
      const upRow = el('div', 'dp-row', '');
      upRow.innerHTML = '<span class="dp-ico">↰</span><span>上级目录…</span>';
      upRow.addEventListener('click', () => { if (d.parent) load(d.parent); });
      if (d.parent) list.appendChild(upRow);
      d.dirs.forEach((it) => {
        const row = el('div', 'dp-row', '');
        row.innerHTML = '<span class="dp-ico">📁</span><span>' + escapeHtml(it.name) + '</span>';
        row.title = it.path;
        row.addEventListener('click', () => load(it.path));
        list.appendChild(row);
      });
    } catch {
      curBox.textContent = '无法连接服务';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  global.openDirPicker = function (cb) {
    onSelect = cb;
    open();
  };
})(window);