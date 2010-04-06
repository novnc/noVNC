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


Canvas = {

c_x : 0,
c_y : 0,
c_wx : 0,
c_wy : 0,
ctx  : null,

mouseDown: function (e) {
    evt = e.event || window.event;
    e.stop();
    debug('mouse ' + evt.which + '/' + evt.button + ' down:' +
            (evt.clientX - Canvas.c_x) + "," + (evt.clientY - Canvas.c_y));
},

mouseUp: function (e) {
    evt = e.event || window.event;
    e.stop();
    debug('mouse ' + evt.which + '/' + evt.button + ' up:' +
            (evt.clientX - Canvas.c_x) + "," + (evt.clientY - Canvas.c_y));
},

keyDown: function (e) {
    e.stop();
    debug("keydown: " + e.key + "(" + e.code + ")");
},

keyUp : function (e) {
    e.stop();
    debug("keyup: " + e.key + "(" + e.code + ")");
},

ctxDisable: function (e) {
    evt = e.event || window.event;
    /* Stop propagation if inside canvas area */
    if ((evt.clientX >= Canvas.c_x) && (evt.clientX < (Canvas.c_x + Canvas.c_wx)) &&
        (evt.clientY >= Canvas.c_y) && (evt.clientY < (Canvas.c_y + Canvas.c_wy))) {
        e.stop();
        return false;
    };
},


init: function (canvas, width, height, keyDown, keyUp, mouseDown, mouseUp) {
    debug(">> init_canvas");

    if (! keyDown) keyDown = Canvas.keyDown;
    if (! keyUp) keyUp = Canvas.keyUp;
    if (! mouseDown) mouseDown = Canvas.mouseDown;
    if (! mouseUp) mouseUp = Canvas.mouseUp;

    c = $(canvas);
    c.width = width;
    c.height = height;
    document.addEvent('keydown', keyDown);
    document.addEvent('keyup', keyUp);
    c.addEvent('mousedown', mouseDown);
    c.addEvent('mouseup', mouseUp);

    /* Work around right and middle click browser behaviors */
    document.addEvent('click', Canvas.ctxDisable);
    document.body.addEvent('contextmenu', Canvas.ctxDisable);

    Canvas.c_x = c.getPosition().x;
    Canvas.c_y = c.getPosition().y;
    Canvas.c_wx = c.getSize().x;
    Canvas.c_wy = c.getSize().y;

    if (! c.getContext) return;
    Canvas.ctx = c.getContext('2d'); 

    /* Border */
    Canvas.ctx.stroke();  
    Canvas.ctx.rect(0, 0, Canvas.c_wx, Canvas.c_wy);
    Canvas.ctx.stroke();  

    /*
    // Does not work in firefox
    var himg = new Image();
    himg.src = "head_ani2.gif"
    Canvas.ctx.drawImage(himg, 10, 10);
    */

    /* Test array image data */
    var img = Canvas.ctx.createImageData(50, 50);
    for (y=0; y< 50; y++) {
        for (x=0; x< 50; x++) {
            img.data[(y*50 + x)*4 + 0] = 255 - parseInt((255 / 50) * y);
            img.data[(y*50 + x)*4 + 1] = parseInt((255 / 50) * y);
            img.data[(y*50 + x)*4 + 2] = parseInt((255 / 50) * x);
            img.data[(y*50 + x)*4 + 3] = 255;
        }
    }
    Canvas.ctx.putImageData(img, 100, 100);

    debug("<< init_canvas");
},

rfbImage: function(x, y, width, height, arr) {
    var img = Canvas.ctx.createImageData(width, height);
    for (var i=0; i < (width * height); i++) {
        img.data[i*4 + 0] = arr[i*4 + 2];
        img.data[i*4 + 1] = arr[i*4 + 1];
        img.data[i*4 + 2] = arr[i*4 + 0];
        img.data[i*4 + 3] = 255; // Set Alpha
    }
    Canvas.ctx.putImageData(img, x, y);

}

};

