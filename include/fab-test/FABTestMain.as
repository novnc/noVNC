package {

import flash.display.*;
import flash.events.*;
import bridge.FABridge;

public class FABTestMain extends Sprite {

    public function FABTestMain() {
    
        // This is to avoid "You are trying to call recursively into the Flash Player ..."
        // error which (I heard) happens when you pass bunch of messages.
        // This workaround was written here:
        // http://www.themorphicgroup.com/blog/2009/02/14/fabridge-error-you-are-trying-to-call-recursively-into-the-flash-player-which-is-not-allowed/
        FABridge.EventsToCallLater["flash.events::Event"] = "true";
        FABridge.EventsToCallLater["FABTestMessageEvent"] = "true";
        
        var fab:FABridge = new FABridge();
        fab.rootObject = this;
        //log("Flash initialized");
    }
  
    public function create():FABTest {
        return new FABTest(this);
    }
}

}
