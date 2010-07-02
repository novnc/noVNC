* How to try

Assuming you have Web server (e.g. Apache) running at http://example.com/ .

- Download web_socket.rb from:
  http://github.com/gimite/web-socket-ruby/tree/master
- Run sample Web Socket server (echo server) in example.com with: (#1)
  $ ruby web-socket-ruby/samples/echo_server.rb example.com 10081
- If your server already provides socket policy file at port 843, modify the file to allow access to port 10081. Otherwise you can skip this step. See below for details.
- Publish the web-socket-js directory with your Web server (e.g. put it in ~/public_html).
- Change ws://localhost:10081 to ws://example.com:10081 in sample.html.
- Open sample.html in your browser.
- After "onopen" is shown, input something, click [Send] and confirm echo back.

#1: First argument of echo_server.rb means that it accepts Web Socket connection from HTML pages in example.com.


* How to debug

If sample.html doesn't work, check these:

- It doesn't work when you open sample.html as local file i.e. file:///.../sample.html. Open it via Web server.
- Make sure port 10081 is not blocked by your server/client's firewall.
- Use Developer Tools (Chrome/Safari) or Firebug (Firefox) to see if console.log outputs any errors.
- Install debugger version of Flash Player available here to see Flash errors:
http://www.adobe.com/support/flashplayer/downloads.html


* Supported environment

I confirmed it works on Chrome 3, Firefox 3.5 and IE 8. It may not work in other browsers.
It requires Flash Player 9 or later (probably).

On Chrome 4 Dev Channel, it just uses native Web Socket implementation.


* Flash socket policy file

This implementation uses Flash's socket, which means that your server must provide Flash socket policy file to declare the server accepts connections from Flash.

If you use web-socket-ruby available at
http://github.com/gimite/web-socket-ruby/tree/master
, you don't need anything special, because web-socket-ruby handles Flash socket policy file request. But if you already provide socket policy file at port 843, you need to modify the file to allow access to Web Socket port, because it precedes what web-socket-ruby provides.

If you use other Web Socket server implementation, you need to provide socket policy file yourself. See
http://www.lightsphere.com/dev/articles/flash_socket_policy.html
for details and sample script to run socket policy file server.

Actually, it's still better to provide socket policy file at port 843 even if you use web-socket-ruby. Flash always try to connect to port 843 first, so providing the file at port 843 makes startup faster.


* Cookie considerations

Cookie is sent if Web Socket host is the same as the origin of JavaScript. Otherwise it is not sent, because I don't know way to send right Cookie (which is Cookie of the host of Web Socket, I heard).

Note that it's technically possible that client sends arbitrary string as Cookie and any other headers (by modifying this library for example) once you place Flash socket policy file in your server. So don't trust Cookie and other headers if you allow connection from untrusted origin.


* Proxy considerations

The WebSocket spec (http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol) specifies instructions for User Agents to support proxied connections by implementing the HTTP CONNECT method.

The AS3 Socket class doesn't implement this mechanism, which renders it useless for the scenarios where the user trying to open a socket is behind a proxy. 

The class RFC2817Socket (by Christian Cantrell) effectively lets us implement this, as long as the proxy settings are known and provided by the interface that instantiates the WebSocket. As such, if you want to support proxied conncetions, you'll have to supply this information to the WebSocket constructor when Flash is being used. One way to go about it would be to ask the user for proxy settings information if the initial connection fails.


* How to build WebSocketMain.swf

Install Flex 4 SDK:
http://opensource.adobe.com/wiki/display/flexsdk/Download+Flex+4

$ cd flash-src
$ ./build.sh


* License

New BSD License.
