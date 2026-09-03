// noVNC Client —— 启动器 / 服务器管理页
const STORAGE_KEY = 'servers';
let editingId = null; // 正在编辑的服务器 id

const $ = (id) => document.getElementById(id);

function buildVncUrl({ host, port, path, autoconnect }) {
  const url = new URL(chrome.runtime.getURL('novnc/vnc.html'));
  if (host) url.searchParams.set('host', host);
  if (port) url.searchParams.set('port', port);
  if (path) url.searchParams.set('path', path);
  if (autoconnect) url.searchParams.set('autoconnect', '1');
  url.searchParams.set('resize', 'scale');
  return url.toString();
}

function openConnection(params) {
  chrome.tabs.create({ url: buildVncUrl(params) });
}

async function loadServers() {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveServers(list) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: list });
}

function renderList(list) {
  const ul = $('s-list');
  ul.textContent = '';
  $('s-empty').classList.toggle('hidden', list.length > 0);

  for (const server of list) {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'server-name';
    name.textContent = server.name || '(未命名)';

    const addr = document.createElement('span');
    addr.className = 'server-addr';
    addr.textContent = `${server.host}:${server.port}`;

    const meta = document.createElement('span');
    meta.className = 'server-meta';
    meta.textContent = server.path ? `路径 ${server.path}` : '默认路径';

    const btns = document.createElement('div');
    btns.className = 'row-btns';

    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'btn small primary';
    connect.textContent = '连接';
    connect.addEventListener('click', () => openConnection(server));

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn small';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => startEdit(server));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small danger';
    remove.textContent = '删除';
    remove.addEventListener('click', async () => {
      const next = list.filter((s) => s.id !== server.id);
      await saveServers(next);
      renderList(next);
      if (editingId === server.id) resetForm();
    });

    btns.append(connect, edit, remove);
    li.append(name, addr, meta, btns);
    ul.appendChild(li);
  }
}

function collectForm() {
  return {
    name: $('s-name').value.trim(),
    host: $('s-host').value.trim(),
    port: $('s-port').value.trim() || '6080',
    path: $('s-path').value.trim(),
  };
}

function validate(server) {
  return Boolean(server.host) && /^\d{1,5}$/.test(server.port);
}

function resetForm() {
  editingId = null;
  $('s-name').value = '';
  $('s-host').value = '';
  $('s-port').value = '';
  $('s-path').value = '';
  $('s-save').textContent = '保存服务器';
  $('s-cancel').classList.add('hidden');
}

function startEdit(server) {
  editingId = server.id;
  $('s-name').value = server.name || '';
  $('s-host').value = server.host || '';
  $('s-port').value = server.port || '';
  $('s-path').value = server.path || '';
  $('s-save').textContent = '更新服务器';
  $('s-cancel').classList.remove('hidden');
  $('s-host').focus();
}

async function init() {
  let list = await loadServers();

  $('q-connect').addEventListener('click', () => {
    openConnection({
      host: $('q-host').value.trim(),
      port: $('q-port').value.trim() || '6080',
      path: $('q-path').value.trim(),
      autoconnect: $('q-auto').checked,
    });
  });

  $('s-save').addEventListener('click', async () => {
    const server = collectForm();
    if (!validate(server)) {
      alert('请填写主机名 / IP，且端口需为数字（1-5 位）。');
      return;
    }
    if (editingId) {
      server.id = editingId;
      list = list.map((s) => (s.id === editingId ? server : s));
    } else {
      server.id = Date.now().toString();
      list = [...list, server];
    }
    await saveServers(list);
    renderList(list);
    resetForm();
  });

  $('s-cancel').addEventListener('click', resetForm);

  renderList(list);
}

init();
