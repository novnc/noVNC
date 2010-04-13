if ((!window.console) || (! /__debug__$/i.test(document.location.href))) {
 // non-debug mode, an empty function  
  window.console = window.console || {};  
  window.console.log = function(message) {}; 
}

function dirObj(obj, parent, depth) {
    var msg = "";
    var val = "";
    if (! depth) { depth=2; }
    if (! parent) { parent= ""; }

    // Print the properties of the passed-in object 
    for (var i in obj) {
        if ((depth > 1) && (typeof obj[i] == "object")) { 
            // Recurse attributes that are objects
            msg += dirObj(obj[i], parent + "." + i, depth-1);
        } else {
            val = new String(obj[i]).replace("\n", " ");
            if (val.length > 30) {
                val = val.substr(0,30) + "...";
            } 
            msg += parent + "." + i + ": " + val + "\n";
        }
    }
    return msg;
}
