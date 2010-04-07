VNC HTML5 Client
================


Description
-----------

An VNC client implemented using HTML5, specifically Canvas and Web Sockets.



Requirements
------------

* A browser that supports Web Sockets (mostly Chrome as of Apr 6, 2010) 
  and Canvas (most browsers)

* Until VNC server support web sockets, you need to use a Web Sockets to
  normal socket proxy. There are a couple reasons for this:

  1. Web Sockets is not a pure socket protocol. There is an initial HTTP
     like handshake to allow easy hand-off by web servers and allow some
     origin policy exchange. Also, each Web Sockets frame begins with
     0 ('\x00') and ends with 255 ('\xff').

  2. Javascript itself does not have the ability to handle pure byte
     strings (Unicode encoding messes with it) even though you can read
     them with Web Sockets. The python proxy base64 encodes the data so
     that the Javascript client can base64 decode the data into an array.


Usage
-----

* run a VNC server.
 
    `Xvnc :1`

* run the python proxy:

    `./wsproxy.py [listen_port] [vnc_host] [vnc_port]`

    `./wsproxy.py 8787 localhost 5901`


* run the mini python web server to serve the directory:

    `./web.py PORT`

    `./web.py 8080`

* Point your web browser at http://localhost:8080/vnc.html
 (or whatever port you used above to run the web server).

* Provide the host and port where the proxy is running and the password
  that the vnc server is using (if any).


