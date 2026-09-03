// noVNC Client —— Service Worker（Manifest V3）
// 职责：1) 点击工具栏图标 → 打开启动器页
//       2) 右键菜单：对 ws:// / wss:// 链接、或选中的 "host:port" 一键连接

const LAUNCHER_URL = 'options.html';

// 安装 / 更新时注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'open-novnc-link',
      title: '用 noVNC 连接此 WebSocket 地址',
      contexts: ['link'],
      targetUrlPatterns: ['ws://*/*', 'wss://*/*'],
    });
    chrome.contextMenus.create({
      id: 'open-novnc-selection',
      title: '用 noVNC 连接所选主机',
      contexts: ['selection'],
    });
  });
});

// 点击工具栏图标 → 打开启动器页
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL(LAUNCHER_URL) });
});

// 解析选中的 "host:port" 文本
function parseHostPort(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  // 显式端口
  const withPort = value.match(/^([^:\s/]+):(\d{1,5})$/);
  if (withPort) {
    return { host: withPort[1], port: withPort[2], path: '' };
  }
  // 只有主机名 / IP：默认 websockify 端口 6080
  if (!value.includes(':') && !value.includes('/')) {
    return { host: value, port: '6080', path: '' };
  }
  return null;
}

// 从 ws:// / wss:// 链接解析 host / port / path
function parseWsUrl(wsUrl) {
  try {
    const u = new URL(wsUrl);
    return {
      host: u.hostname,
      port: u.port || (u.protocol === 'wss:' ? '443' : '80'),
      path: u.pathname === '/' ? '' : u.pathname.replace(/^\//, ''),
    };
  } catch {
    return null;
  }
}

// 打开 noVNC 页面并自动连接
function openNoVNC({ host, port, path }) {
  const url = new URL(chrome.runtime.getURL('novnc/vnc.html'));
  if (host) url.searchParams.set('host', host);
  if (port) url.searchParams.set('port', port);
  if (path) url.searchParams.set('path', path);
  url.searchParams.set('autoconnect', '1');
  url.searchParams.set('resize', 'scale');
  chrome.tabs.create({ url: url.toString() });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-novnc-link') {
    const params = parseWsUrl(info.linkUrl);
    if (params) openNoVNC(params);
  } else if (info.menuItemId === 'open-novnc-selection') {
    const params = parseHostPort(info.selectionText);
    if (params) openNoVNC(params);
  }
});
