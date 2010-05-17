package {

import flash.events.*;
import flash.external.*;
import flash.utils.*;

[Event(name="message", type="FABTestMessageEvent")]
public class FABTest extends EventDispatcher {
  
    private var main:FABTestMain;
    private var intervalID:int;
    private var seqCnt:int;

    public function FABTest(main:FABTestMain) {
        this.main = main;
        ExternalInterface.call("console.log", "[FABTest] FABTest()");
    }
    
    public function start(eventDelay:int):void {
        ExternalInterface.call("console.log", "[FABTest] start()");
        seqCnt = 0;
        intervalID = setInterval(sendEvent, eventDelay);
    }
    
    public function stop():void {
        ExternalInterface.call("console.log", "[FABTest] stop()");
        clearInterval(intervalID);
    }
  
    private function sendEvent():void {
        //ExternalInterface.call("console.log", "[FABTest] sendEvent " + seqCnt);
        dispatchEvent(new FABTestMessageEvent("message", encodeURIComponent(seqCnt.toString())));
        seqCnt = seqCnt + 1;
    }
}

}
