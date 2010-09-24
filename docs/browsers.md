## noVNC: Browser Support

### Ubuntu Karmic (9.10)

<table>
    <tr>
        <th>Browser</th>
        <th>Status</th>
        <th>Notes</th>
    </tr> <tr>
        <td>Chrome 7.0.510.0</td>
        <td><strong>Broken</strong></td>
        <td>WebKit render bug (see note 3)</td>
    </tr> <tr>
        <td>Chrome 5.0.375.29</td>
        <td>Excellent</td>
        <td>Very fast. Native WebSockets.</td>
    </tr> <tr>
        <td>Firefox 4.0 Beta 6</td>
        <td>Excellent</td>
        <td>Fast. Native WebSockets. SSL cert hassle (see note 2)</td>
    </tr> <tr>
        <td>Firefox 3.6.1</td>
        <td>Good</td>
        <td>Slowed by web-socket-js overhead. Local cursor causes segfault.</td>
    </tr> <tr>
        <td>Opera 10.60</td>
        <td>Poor</td>
        <td>web-socket-js problems, mouse/keyboard issues (see note 1)</td>
    </tr> <tr>
        <td>Arora 0.10.1</td>
        <td>Good</td>
        <td>Slow due to broken putImageData and web-socket-js.</td>
    </tr> <tr>
        <td>Konqueror 4.3.2</td>
        <td><strong>Broken</strong></td>
        <td>web-socket-js never loads</td>
    </tr>
</table>


### Ubuntu Jaunty (9.04)

<table>
    <tr>
        <th>Browser</th>
        <th>Status</th>
        <th>Notes</th>
    </tr> <tr>
        <td>Chrome 5.0.375.29</td>
        <td>Excellent</td>
        <td>Very fast. Native WebSockets.</td>
    </tr> <tr>
        <td>Firefox 3.5</td>
        <td>Good</td>
        <td>Slowed by web-socket-js overhead.</td>
    </tr> <tr>
        <td>Firefox 3.0.17</td>
        <td>Fair</td>
        <td>Works fine but is slow.</td>
    </tr> <tr>
        <td>Opera 10.60</td>
        <td>Poor</td>
        <td>web-socket-js problems, mouse/keyboard issues (see note 1)</td>
    </tr> <tr>
        <td>Arora 0.5</td>
        <td>Good</td>
        <td>Slow due to broken putImageData and web-socket-js.</td>
    </tr> <tr>
        <td>Konqueror 4.2.2</td>
        <td><strong>Broken</strong></td>
        <td>web-socket-js never loads</td>
    </tr>
</table>


### Windows XP

<table>
    <tr>
        <th>Browser</th>
        <th>Status</th>
        <th>Notes</th>
    </tr> <tr>
        <td>Chrome 5.0.375.99</td>
        <td>Excellent</td>
        <td>Very fast. Native WebSockets.</td>
    </tr> <tr>
        <td>Firefox 3.0.19</td>
        <td>Good</td>
        <td>Some overhead from web-socket-js.</td>
    </tr> <tr>
        <td>Safari 5.0</td>
        <td>Fair</td>
        <td>Fast. Native WebSockets.</td>
    </tr> <tr>
        <td>IE 6, 7, 8</td>
        <td><strong>Non-starter</strong></td>
        <td>No basic Canvas support. Javascript painfully slow.</td>
    </tr>
</table>


* Note 1: Opera interacts poorly with web-socket-js. After two
  disconnects the browser tab or Flash often hang. Although Javascript
  is faster than Firefox 3.5, the high variability of web-socket-js
  performance results in overall performance being lower. Middle mouse
  clicks and keyboard events need some work to work properly under
  Opera. Also, Opera does not have support for setting the cursor
  style url to a data URI scheme, so cursor pseudo-encoding is
  disabled.

* Note 2: Firefox 4.0 Beta does not provide a direct way to accept
  SSL certificates via WebSockets. You can work around this by
  navigating directly to the WebSockets port using 'https://' and
  accepting the certificate. Then return to noVNC and connect
  normally.

* Note 3: Browsers using WebKit build 66396 or later
  (Chrome/Chromium after build 57838) have a Canvas rendering bug. The
  WebKit bug is <a
  href="https://bugs.webkit.org/show_bug.cgi?id=46319">#46319</a>.
  This is noVNC bug <a
  href="http://github.com/kanaka/novnc/issues/#issue/28">#28</a>.


