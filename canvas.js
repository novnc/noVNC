window.onload = init;

var img = null;
var c_x = 0;
var c_y = 0;
var c_wx = 0;
var c_wy = 0;

function debug(str) {
    cell = $('debug');
    cell.innerHTML += str + "\n";
    cell.scrollTop = cell.scrollHeight;
}

function dirObj(obj, parent, depth) {
    var msg = "";
    if (! depth) { depth=0; }
    if (! parent) { parent= ""; }

    // Print the properties of the passed-in object 
    for (var i in obj) {
        if ((depth < 2) && (typeof obj[i] == "object")) { 
            // Recurse attributes that are objects
            msg += dirObj(obj[i], parent + "." + i, depth+1);
        } else {
            msg += parent + "." + i + ": " + obj[i] + "\n";
        }
    }
    return msg;
}

function mouseDown(e) {
    evt = e.event || window.event;
    e.stop();
    debug('mouse ' + evt.which + '/' + evt.button + ' down:' +
            (evt.clientX - c_x) + "," + (evt.clientY - c_y));
}

function mouseUp(e) {
    evt = e.event || window.event;
    e.stop();
    debug('mouse ' + evt.which + '/' + evt.button + ' up:' +
            (evt.clientX - c_x) + "," + (evt.clientY - c_y));
}

function keyDown(e) {
    e.stop();
    debug("keydown: " + e.key + "(" + e.code + ")");
}

function keyUp(e) {
    e.stop();
    debug("keyup: " + e.key + "(" + e.code + ")");
}

function ctxDisable(e) {
    evt = e.event || window.event;
    /* Stop propagation if inside canvas area */
    if ((evt.clientX >= c_x) && (evt.clientX < (c_x + c_wx)) &&
        (evt.clientY >= c_y) && (evt.clientY < (c_y + c_wy))) {
        e.stop();
        return false;
    };
}


function init() {
    debug(">> init");

    c = $('tutorial');
    c.addEvent('mousedown', mouseDown);
    c.addEvent('mouseup', mouseUp);
    document.addEvent('keydown', keyDown);
    document.addEvent('keyup', keyUp);

    /* Work around right and middle click browser behaviors */
    document.addEvent('click', ctxDisable);
    document.body.addEvent('contextmenu', ctxDisable);

    c_x = c.getPosition().x;
    c_y = c.getPosition().y;
    c_wx = c.getSize().x;
    c_wy = c.getSize().y;

    //var canvas = document.getElementById('tutorial');  
    if (! c.getContext) return;
    var ctx = c.getContext('2d'); 

    /* Border */
    ctx.stroke();  
    ctx.rect(0, 0, 500, 300);
    ctx.stroke();  

    /*
    // Does not work in firefox
    var himg = new Image();
    himg.src = "head_ani2.gif"
    ctx.drawImage(himg, 10, 10);
    */

    /* Test array image data */
    img = ctx.createImageData(50, 50);
    for (y=0; y< 50; y++) {
        for (x=0; x< 50; x++) {
            img.data[(y*50 + x)*4 + 0] = 255 - parseInt((255 / 50) * y);
            img.data[(y*50 + x)*4 + 1] = parseInt((255 / 50) * y);
            img.data[(y*50 + x)*4 + 2] = parseInt((255 / 50) * x);
            img.data[(y*50 + x)*4 + 3] = 255;
        }
    }
    ctx.putImageData(img, 100, 100);

    debug("<< init");
}

