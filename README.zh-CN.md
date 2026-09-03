## noVNC：HTML VNC 客户端库与应用

[English](README.md) | **中文**

### 简介

noVNC 既是一个 HTML VNC 客户端 JavaScript 库，也是基于该库构建的应用程序。
noVNC 能在任何现代浏览器中良好运行，包括移动端浏览器（iOS 和 Android）。

许多公司、项目和产品都集成了 noVNC，包括
[OpenStack](http://www.openstack.org)、
[OpenNebula](http://opennebula.org/)、
[LibVNCServer](http://libvncserver.sourceforge.net) 和
[ThinLinc](https://cendio.com/thinlinc) 等。更完整的列表（含更多信息与链接）
请参见[使用 noVNC 的项目与公司 wiki 页](https://github.com/novnc/noVNC/wiki/Projects-and-companies-using-noVNC)。

### Chrome 扩展

本分支在 noVNC v1.7.0 基础上封装为 **Chrome 扩展**（Manifest V3），
无需任何浏览器插件即可在标签页中直接访问远程桌面。

- **连接方式**：点击工具栏图标打开启动器页，或右键 `ws://` / `wss://` 链接、
  选中的 `host:port` 文本一键连接。
- **常用服务器**：启动器页支持保存 / 编辑 / 删除常用服务器列表。
- **功能完整**：复用 noVNC 全部能力，包括远程桌面渲染、键鼠输入、剪贴板双向传输等。

**加载方式**：打开 `chrome://extensions`，开启"开发者模式"，
选择"加载已解压的扩展程序"，指向本仓库目录即可。

> 为兼容 Manifest V3 的 CSP 限制，`vnc.html` / `vnc_lite.html` 中原本内联的
> 启动脚本已外置为 `app/main.js` / `app/vnc_lite.js`，对浏览器直接访问 noVNC
> 无任何影响。

### 目录

- [新闻/帮助/联系](#新闻帮助联系)
- [特性](#特性)
- [浏览器要求](#浏览器要求)
- [服务器要求](#服务器要求)
- [快速开始](#快速开始)
- [从 snap 包安装](#从-snap-包安装)
- [集成与部署](#集成与部署)
- [作者/贡献者](#作者贡献者)

### 新闻/帮助/联系

项目官网见 [novnc.com](http://novnc.com)。

如果你是 noVNC 的开发者/集成者/用户（或想成为其中一员），请加入
[noVNC 讨论组](https://groups.google.com/forum/?fromgroups#!forum/novnc)。

Bug 与功能请求可通过 [github issues](https://github.com/novnc/noVNC/issues) 提交。
如果你有关于使用 noVNC 的问题，请先使用
[讨论组](https://groups.google.com/forum/?fromgroups#!forum/novnc)。
我们还有一个 [wiki](https://github.com/novnc/noVNC/wiki/)，里面有很多有用的信息。

如果你想找地方开始为 noVNC 做贡献，可以从标记为
["patchwelcome"](https://github.com/novnc/noVNC/issues?labels=patchwelcome)
的 issue 开始。不过请先阅读我们的
[贡献指南](https://github.com/novnc/noVNC/wiki/Contributing)。

如果你想表达对 noVNC 的感谢，可以捐赠给一些优秀的非营利组织，例如：
[Compassion International](http://www.compassion.com/)、
[SIL](http://www.sil.org)、
[Habitat for Humanity](http://www.habitat.org)、
[Electronic Frontier Foundation](https://www.eff.org/)、
[Against Malaria Foundation](http://www.againstmalaria.com/)、
[Nothing But Nets](http://www.nothingbutnets.net/) 等。

### 特性

* 支持所有现代浏览器，包括移动端（iOS、Android）
* 支持的认证方式：无、经典 VNC、RealVNC 的 RSA-AES、Tight、VeNCrypt Plain、
  XVP、Apple 的 Diffie-Hellman、UltraVNC 的 MSLogonII
* 支持的 VNC 编码：raw、copyrect、rre、hextile、tight、tightPNG、ZRLE、JPEG、
  Zlib、H.264
* 支持桌面缩放、裁剪与尺寸调整
* 支持前进/后退鼠标按键
* 本地光标渲染
* 剪贴板复制/粘贴，完整支持 Unicode
* 多语言翻译
* 用于模拟常见鼠标操作的触摸手势
* 主要采用 [MPL 2.0](http://www.mozilla.org/MPL/2.0/) 许可，详见
  [许可文件](LICENSE.txt)

### 浏览器要求

noVNC 使用了大量现代 Web 技术，因此没有正式的硬件要求清单。
不过以下是我们目前已知的最低版本：

* Chrome 89、Firefox 89、Safari 15、Opera 75、Edge 89

### 服务器要求

noVNC 遵循标准 VNC 协议，但与其它 VNC 客户端不同，它需要 WebSockets 支持。
许多服务器都内置了支持（例如
[x11vnc/libvncserver](http://libvncserver.sourceforge.net/)、
[QEMU](http://www.qemu.org/) 和
[MobileVNC](http://www.smartlab.at/mobilevnc/)），
其余的则需要使用 WebSockets 到 TCP 的代理。noVNC 有一个姊妹项目
[websockify](https://github.com/novnc/websockify) 提供了这样一个简单的代理。

### 快速开始

* 使用 `novnc_proxy` 脚本自动下载并启动 websockify，它内置了迷你 Web 服务器
  和 WebSockets 代理。`--vnc` 选项用于指定正在运行的 VNC 服务器位置：

    `./utils/novnc_proxy --vnc localhost:5901`

* 如果不需要将 Web 服务器暴露到公网，可以只绑定到 localhost：

    `./utils/novnc_proxy --vnc localhost:5901 --listen localhost:6081`

* 在浏览器中打开 `novnc_proxy` 脚本输出的 URL，点击 Connect 按钮，
  如果 VNC 服务器配置了密码则输入密码，尽情享受吧！

### 从 snap 包安装

运行下面的命令将从 snap 安装 noVNC 的最新发布版：

`sudo snap install novnc`

#### 直接从 snap 运行 noVNC

可以直接运行 snap 包安装的 novnc，例如：

`novnc --listen 6081 --vnc localhost:5901 # 如果 /snap/bin 不在 PATH 中则使用 /snap/bin/novnc`

如果要使用证书文件，由于 snap 标准沙箱限制，你需要把它们放在
/home/\<用户\>/snap/novnc/current/ 目录下。如果你的用户名是 jsmith，示例命令如下：

  `novnc --listen 8443 --cert ~jsmith/snap/novnc/current/self.crt --key ~jsmith/snap/novnc/current/self.key --vnc ubuntu.example.com:5901`

#### 将 noVNC 作为服务（守护进程）从 snap 运行

snap 包还支持运行一个 "novnc" 服务，可配置为监听多个端口并连接多个 VNC 服务器
（实际上是运行多个 novnc 实例的服务）。
说明（含示例值）：

列出当前服务（开箱即为空）：

```
sudo snap get novnc services
Key             Value
services.n6080  {...}
services.n6081  {...}
```

创建一个新服务，监听 6082 端口并连接 localhost 上运行在 5902 端口的 VNC 服务器：

`sudo snap set novnc services.n6082.listen=6082 services.n6082.vnc=localhost:5902`

（用 'snap set' 定义的任何服务都会自动启动）
注意服务的名称，本例中的 'n6082'，可以是任何不以数字开头、不含空格或特殊字符的名称。

查看刚创建的服务的配置：

```
sudo snap get novnc services.n6082
Key                    Value
services.n6082.listen  6082
services.n6082.vnc     localhost:5902
```

禁用服务（注意：由于 snap 的限制，目前无法取消设置配置变量，
将它们设置为空值就是禁用服务的方式）：

`sudo snap set novnc services.n6082.listen='' services.n6082.vnc=''`

（像这样用 'snap set' 设置为空的服务会自动停止）

验证服务已禁用（空值）：

```
sudo snap get novnc services.n6082
Key                    Value
services.n6082.listen
services.n6082.vnc
```

### 集成与部署

请参阅我们的其它文档，了解如何将 noVNC 集成到自己的软件中，
或如何在生产环境中部署 noVNC 应用：

* [Embedding](docs/EMBEDDING.md) - 针对 noVNC 应用
* [Library](docs/LIBRARY.md) - 针对 noVNC JavaScript 库

### 作者/贡献者

完整的作者列表见 [AUTHORS](AUTHORS)。如果你不在该列表中但认为自己应该在，
欢迎发送 PR 来修正。

* 核心团队：
    * [Samuel Mannehed](https://github.com/samhed) (Cendio)
    * [Pierre Ossman](https://github.com/CendioOssman) (Cendio)

* 曾经的核心里贡献者：
    * [Joel Martin](https://github.com/kanaka)（项目创始人）
    * [Solly Ross](https://github.com/DirectXMan12) (Red Hat / OpenStack)

* 重要贡献：
    * UI 与图标：Pierre Ossman、Chris Gordon
    * 原始 Logo：Michael Sersen
    * tight 编码：Michael Tinglof (Mercuri.ca)
    * RealVNC RSA AES 认证：USTC Vlab Team

* 包含的库：
    * base64：Martijn Pieters (Digital Creations 2)、Samuel Sieb (sieb.net)
    * DES：Dave Zimmerman (Widget Workshop)、Jef Poskanzer (ACME Labs)
    * Pako：Vitaly Puzrin (https://github.com/nodeca/pako)

想出现在这个列表中吗？查看我们的[贡献指南](https://github.com/novnc/noVNC/wiki/Contributing)
开始吧！
