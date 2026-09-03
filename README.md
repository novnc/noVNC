# noVNC Chrome Extension

[中文](README.zh-CN.md) | **English**

Packages [noVNC](https://github.com/novnc/noVNC) v1.7.0 into a **Chrome
extension** (Manifest V3) for one-click remote desktop access in a browser tab.

## Features

- Click the toolbar icon to open the launcher, or right-click a `ws://` / `wss://`
  link or a selected `host:port` text to connect instantly.
- Save / edit / delete frequently used servers in the launcher.
- Full noVNC feature set: remote desktop rendering, keyboard/mouse input, and
  bidirectional clipboard transfer.

## Install

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
and select this repository directory.

## Upstream

A fork of [noVNC](https://github.com/novnc/noVNC) (MPL 2.0), an HTML5 VNC client
that runs in any modern browser over WebSockets.
