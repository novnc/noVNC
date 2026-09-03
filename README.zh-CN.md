# noVNC Chrome 扩展

**中文** | [English](README.md)

将 [noVNC](https://github.com/novnc/noVNC) v1.7.0 封装为 **Chrome 扩展**
（Manifest V3），在浏览器标签页中一键访问远程桌面。

## 功能

- 点击工具栏图标打开启动器，或右键 `ws://` / `wss://` 链接、选中的
  `host:port` 文本一键连接。
- 支持在启动器中保存 / 编辑 / 删除常用服务器。
- 完整 noVNC 能力：远程桌面渲染、键鼠输入、剪贴板双向传输。

## 安装

打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**，
指向本仓库目录即可。

## 上游项目

本仓库是 [noVNC](https://github.com/novnc/noVNC)（MPL 2.0）的分支。noVNC 是
基于 HTML5/WebSocket 的 VNC 客户端，可在任何现代浏览器中运行。
