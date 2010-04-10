var n = 1;
var cur = 1;
var timer = null;

function search() {
    if (timer) clearTimeout(timer);
    var sqrtn = Math.sqrt(n);
    for (iters = 0; iters < 10000; iters += 1) {
        cur += 1;
        if ((cur <= sqrtn) && (n % cur != 0)) continue;
        if (cur > sqrtn) {
            postMessage("num:" + n);
        }
        n += 1;
        cur = 1;
    }
    timer = setTimeout(search, 10);
}


onmessage = function (e) {
    switch (e.data) {
        case 'start':
            postMessage("log:start");
            if (timer) clearTimeout(timer);
            timer = setTimeout(search, 100);
            break;
        case 'stop':
            postMessage("log:stop");
            if (timer) clearTimeout(timer);
            started = false;
            break;
        case 'reset':
            postMessage("log:reset");
            n = 1;
            postMessage('num:');
            break;
    }
}
