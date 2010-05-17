package {

import flash.events.*;

public class FABTestMessageEvent extends Event {
    public var data:String;
    
    public function FABTestMessageEvent(type:String, data:String) {
        super(type);
        this.data = data;
    }
}

}
