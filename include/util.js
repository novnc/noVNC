if ((!window.console) || (! /__debug__$/i.test(document.location.href))) {
  // non-debug mode, an empty function  
  window.console = window.console || {};  
  window.console.log = function(message) {}; 
  window.console.warn = function(message) {}; 
  window.console.error = function(message) {}; 
}

function dirObj(obj, depth, parent) {
    var msg = "";
    var val = "";
    if (! depth) { depth=2; }
    if (! parent) { parent= ""; }

    // Print the properties of the passed-in object 
    for (var i in obj) {
        if ((depth > 1) && (typeof obj[i] == "object")) { 
            // Recurse attributes that are objects
            msg += dirObj(obj[i], depth-1, parent + "." + i);
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


/*
 * Make arrays quack
 */

Array.prototype.shift8 = function () {
    return this.shift();
};
Array.prototype.push8 = function (num) {
    this.push(num & 0xFF);
};

Array.prototype.shift16 = function () {
    return (this.shift() << 8) +
           (this.shift()     );
};
Array.prototype.push16 = function (num) {
    this.push((num >> 8) & 0xFF,
              (num     ) & 0xFF  );
};


Array.prototype.shift32 = function () {
    return (this.shift() << 24) +
           (this.shift() << 16) +
           (this.shift() <<  8) +
           (this.shift()      );
};
Array.prototype.get32 = function (off) {
    return (this[off    ] << 24) +
           (this[off + 1] << 16) +
           (this[off + 2] <<  8) +
           (this[off + 3]      );
};
Array.prototype.push32 = function (num) {
    this.push((num >> 24) & 0xFF,
              (num >> 16) & 0xFF,
              (num >>  8) & 0xFF,
              (num      ) & 0xFF  );
};

Array.prototype.shiftStr = function (len) {
    var arr = this.splice(0, len);
    return arr.map(function (num) {
            return String.fromCharCode(num); } ).join('');
};
Array.prototype.pushStr = function (str) {
    var i, n = str.length;
    for (i=0; i < n; i++) {
        this.push(str.charCodeAt(i));
    }
};

Array.prototype.shiftBytes = function (len) {
    return this.splice(0, len);
};

