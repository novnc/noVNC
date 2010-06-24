// Copyright: Hiroshi Ichikawa <http://gimite.net/en/>
// License: New BSD License
// Reference: http://dev.w3.org/html5/websockets/
// Reference: http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-31

package {

import flash.display.*;
import flash.events.*;
import flash.external.*;
import flash.net.*;
import flash.system.*;
import flash.utils.*;
import mx.core.*;
import mx.controls.*;
import mx.events.*;
import mx.utils.*;

public class WebSocketMessageEvent extends Event {
  
  public var data:String;
  
  public function WebSocketMessageEvent(type:String, data:String) {
    super(type);
    this.data = data;
  }
  
}

}
