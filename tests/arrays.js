/*
 * Javascript binary array performance tests
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

var ctx, i, j, randlist,
    new_normal, new_imageData, new_arrayBuffer,
    browser = Browser.browser + " " +
              Browser.version + " on " +
              Browser.OS,
    do_imageData   = false,
    do_arrayBuffer = false,
    conf = {
        'create_cnt'     : 2000,
        'read_cnt'       : 5000000,
        'write_cnt'      : 5000000,
        'iterations'     : 0,
        'order_l1'       : [browser],
        'order_l2'       : ['normal',
                            'imageData',
                            'arrayBuffer'],
        'order_l3'       : ['create',
                            'sequentialRead',
                            'randomRead',
                            'sequentialWrite']
    },
    stats = {},
    testFunc = {},
    iteration, arraySize;

var newline = "\n";
if (Util.Engine.trident) {
    var newline = "<br>\n";
}
function message(str) {
    //console.log(str);
    cell = $D('messages');
    cell.innerHTML += str + newline;
    cell.scrollTop = cell.scrollHeight;
}

function vmessage(str) {
    if (verbose) {
        message(str);
    } else {
        console.log(str);
    }
}

new_normal = function() {
    var arr = [], i;
    for (i = 0; i < arraySize; i++) {
        arr[i] = 0;
    }
    return arr;
}

/* Will be overridden with real function */
new_imageData = function() {
    throw("imageData not supported");
};

new_imageData_createImageData = function() {
    var imageData = ctx.createImageData(1024/4, arraySize / 1024);
    return imageData.data;
};

new_imageData_getImageData = function() {
    var imageData = ctx.getImageData(0, 0, 1024/4, arraySize / 1024),
        arr = imageData.data;
    for (i = 0; i < arraySize; i++) {
        arr[i] = 0;
    }
    return arr;
};

new_arrayBuffer = function() {
    var arr = new ArrayBuffer(arraySize);
    return new Uint8Array(arr);
}

function init_randlist() {
    randlist = [];
    for (var i=0; i < arraySize; i++) {
        randlist[i] = parseInt(Math.random() * 256, 10);
    }
}
function copy_randlist(arr) {
    for (var i=0; i < arraySize; i++) {
        arr[i] = randlist[i];
    }
}

function begin() {
    var i, j;
    conf.iterations = parseInt($D('iterations').value, 10);
    arraySize = parseInt($D('arraySize').value, 10) * 1024;

    init_randlist();

    // TODO: randomize test_list
    
    stats = {};
    for (i = 0; i < conf.order_l2.length; i++) {
        stats[conf.order_l2[i]] = {};
        for (j = 0; j < conf.order_l3.length; j++) {
            stats[conf.order_l2[i]][conf.order_l3[j]] = [];
        }
    }

    $D('startButton').value = "Running";
    $D('startButton').disabled = true;

    message("running " + conf.iterations + " test iterations");
    iteration = 1;
    setTimeout(run_next_iteration, 250);
}

function finish() {
    var totalTime, arrayType, testType, times;
    message("tests finished");

    for (j = 0; j < conf.order_l3.length; j++) {
        testType = conf.order_l3[j];
        message("Test '" + testType + "'");
        for (i = 0; i < conf.order_l2.length; i++) {
            arrayType = conf.order_l2[i];
            message("  Array Type '" + arrayType);
            times = stats[arrayType][testType];
            message("    Average : " + times.mean() + "ms" +
                    " (Total: " + times.sum() + "ms)");
            message("    Min/Max : " + times.min() + "ms/" +
                                        times.max() + "ms");
            message("    StdDev  : " + times.stdDev() + "ms");
        }
    }

    vmessage("array_chart.py JSON data:");
    chart_data = {'conf' : conf, 'stats' : { } };
    chart_data.stats[browser] = stats;
    chart_data.stats['next_browser'] = {};
    vmessage(JSON.stringify(chart_data, null, 2));

    $D('startButton').disabled = false;
    $D('startButton').value = "Run Tests";
}

function run_next_iteration() {
    var arrayType, testType, deltaTime;
    
    for (i = 0; i < conf.order_l2.length; i++) {
        arrayType = conf.order_l2[i];
        if (arrayType === 'imageData' && (!do_imageData)) {
            continue;
        }
        if (arrayType === 'arrayBuffer' && (!do_arrayBuffer)) {
            continue;
        }
        for (j = 0; j < conf.order_l3.length; j++) {
            testType = conf.order_l3[j];

            deltaTime = testFunc[arrayType + "_" + testType]();

            stats[arrayType][testType].push(deltaTime);
            vmessage("test " + (arrayType + "_" + testType) +
                        " time: " + (deltaTime) + "ms");
        }
    }

    message("finished test iteration " + iteration);
    if (iteration >= conf.iterations) {
        setTimeout(finish, 1);
        return;
    }
    iteration++;
    setTimeout(run_next_iteration, 1);
}

/*
    * Test functions
    */

testFunc["normal_create"] = function() {
    var cnt, arrNormal, startTime, endTime;
    vmessage("create normal array " + conf.create_cnt + "x, initialized to 0");

    startTime = (new Date()).getTime();
    for (cnt = 0; cnt < conf.create_cnt; cnt++) {
        arrNormal = new_normal();
    }
    endTime = (new Date()).getTime();

    return endTime - startTime;
};

testFunc["imageData_create"] = function() {
    var cnt, arrImage, startTime, endTime;
    vmessage("create imageData array " + conf.create_cnt + "x, initialized to 0");

    startTime = (new Date()).getTime();
    for (cnt = 0; cnt < conf.create_cnt; cnt++) {
        arrImage = new_imageData();
    }
    endTime = (new Date()).getTime();

    if (arrImage[103] !== 0) {
        message("Initialization failed, arrImage[103] is: " + arrImage[103]);
        throw("Initialization failed, arrImage[103] is: " + arrImage[103]);
    }
    return endTime - startTime;
};

testFunc["arrayBuffer_create"] = function() {
    var cnt, arrBuffer, startTime, endTime;
    vmessage("create arrayBuffer array " + conf.create_cnt + "x, initialized to 0");

    startTime = (new Date()).getTime();
    for (cnt = 0; cnt < conf.create_cnt; cnt++) {
        arrBuffer = new_arrayBuffer();
    }
    endTime = (new Date()).getTime();

    if (arrBuffer[103] !== 0) {
        message("Initialization failed, arrBuffer[103] is: " + arrBuffer[103]);
        throw("Initialization failed, arrBuffer[103] is: " + arrBuffer[103]);
    }
    return endTime - startTime;
};

function test_sequentialRead(arr) {
    var i, j, cnt, startTime, endTime;
    /* Initialize the array */
    copy_randlist(arr);

    startTime = (new Date()).getTime();
    i = 0;
    j = 0;
    for (cnt = 0; cnt < conf.read_cnt; cnt++) {
        j = arr[i];
        i++;
        if (i >= arraySize) {
            i = 0;
        }
    }
    endTime = (new Date()).getTime();

    return endTime - startTime;
}

function test_randomRead(arr) {
    var i, cnt, startTime, endTime;
    /* Initialize the array */
    copy_randlist(arr);   // used as jumplist

    startTime = (new Date()).getTime();
    i = 0;
    for (cnt = 0; cnt < conf.read_cnt; cnt++) {
        i = (arr[i] + cnt) % arraySize;
    }
    endTime = (new Date()).getTime();

    return endTime - startTime;
}

function test_sequentialWrite(arr) {
    var i, cnt, startTime, endTime;
    /* Initialize the array */
    copy_randlist(arr);

    startTime = (new Date()).getTime();
    i = 0;
    for (cnt = 0; cnt < conf.write_cnt; cnt++) {
        arr[i] = (cnt % 256);
        i++;
        if (i >= arraySize) {
            i = 0;
        }
    }
    endTime = (new Date()).getTime();

    return endTime - startTime;
}

/* Sequential Read Tests */
testFunc["normal_sequentialRead"] = function() {
    vmessage("read normal array " + conf.read_cnt + "x");
    return test_sequentialRead(new_normal());
};

testFunc["imageData_sequentialRead"] = function() {
    vmessage("read imageData array " + conf.read_cnt + "x");
    return test_sequentialRead(new_imageData());
};

testFunc["arrayBuffer_sequentialRead"] = function() {
    vmessage("read arrayBuffer array " + conf.read_cnt + "x");
    return test_sequentialRead(new_arrayBuffer());
};


/* Random Read Tests */
testFunc["normal_randomRead"] = function() {
    vmessage("read normal array " + conf.read_cnt + "x");
    return test_randomRead(new_normal());
};

testFunc["imageData_randomRead"] = function() {
    vmessage("read imageData array " + conf.read_cnt + "x");
    return test_randomRead(new_imageData());
};

testFunc["arrayBuffer_randomRead"] = function() {
    vmessage("read arrayBuffer array " + conf.read_cnt + "x");
    return test_randomRead(new_arrayBuffer());
};


/* Sequential Write Tests */
testFunc["normal_sequentialWrite"] = function() {
    vmessage("write normal array " + conf.write_cnt + "x");
    return test_sequentialWrite(new_normal());
};

testFunc["imageData_sequentialWrite"] = function() {
    vmessage("write imageData array " + conf.write_cnt + "x");
    return test_sequentialWrite(new_imageData());
};

testFunc["arrayBuffer_sequentialWrite"] = function() {
    vmessage("write arrayBuffer array " + conf.write_cnt + "x");
    return test_sequentialWrite(new_arrayBuffer());
};

init = function() {
    vmessage(">> init");

    $D('iterations').value = 10;
    $D('arraySize').value = 10;
    arraySize = parseInt($D('arraySize').value, 10) * 1024;

    message("Browser: " + browser);

    /* Determine browser binary array support */
    try {
        ctx = $D('canvas').getContext('2d');
        new_imageData = new_imageData_createImageData;
        new_imageData();
        do_imageData = true;
    } catch (exc) {
        vmessage("createImageData not supported: " + exc);
        try {
            ctx = $D('canvas').getContext('2d');
            new_imageData = new_imageData_getImageData;
            blah = new_imageData();
            do_imageData = true;
        } catch (exc) {
            vmessage("getImageData not supported: " + exc);
        }
    }
    if (! do_imageData) {
        message("imageData arrays not supported");
    }

    try {
        new_arrayBuffer();
        do_arrayBuffer = true;
    } catch (exc) {
        vmessage("Typed Arrays not supported: " + exc);
    }
    if (! do_arrayBuffer) {
        message("Typed Arrays (ArrayBuffers) not suppoted");
    }
    vmessage("<< init");
}
