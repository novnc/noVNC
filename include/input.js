/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

/*jslint browser: true, white: false, bitwise: false */
/*global window, Util */


//
// Keyboard event handler
//

// the meat of the keyboard handling implementation comes from three external files:
// src/helper.js
// src/keyboard.js
// src/keysymdef.js
// The files are pasted verbatim into this file under the corresponding comments below
// This is done because the Keyboard object does not expose the internal helper functions, so unit tests cannot be run against this file
// Instead, the "raw" implementation resides in src/, which the unit tests can run against.
// For convenience, when using noVNC, everything is copied into this file.

function Keyboard(defaults) {
"use strict";

var that           = {},  // Public API methods
    conf           = {},  // Configuration attributes

    keyDownList    = [];         // List of depressed keys 
                                 // (even if they are happy)

// Configuration attributes
Util.conf_defaults(conf, that, defaults, [
    ['target',      'wo', 'dom',  document, 'DOM element that captures keyboard input'],
    ['focused',     'rw', 'bool', true, 'Capture and send key events'],

    ['onKeyPress',  'rw', 'func', null, 'Handler for key press/release']
    ]);


// 
// Private functions
//

///////// helper.js

///////// keyboard.js

/////// setup

function onRfbEvent(evt) {
    if (conf.onKeyPress) {
        Util.Debug("onKeyPress " + (evt.type == 'keydown' ? "down" : "up")
        + ", keysym: " + evt.keysym.keysym + "(" + evt.keysym.keyname + ")");
        conf.onKeyPress(evt.keysym.keysym, evt.type == 'keydown');
    }
}

var k = KeyEventDecoder(ModifierSync(),
    VerifyCharModifier(
        TrackKeyState(
            EscapeModifiers(onRfbEvent)
        )
    )
);

function onKeyDown(e) {
    if (! conf.focused) {
        return true;
    }
    if (k.keydown(e)) {
        // Suppress bubbling/default actions
        Util.stopEvent(e);
        return false;
    } else {
        // Allow the event to bubble and become a keyPress event which
        // will have the character code translated
        return true;
    }
}
function onKeyPress(e) {
    if (! conf.focused) {
        return true;
    }
    if (k.keypress(e)) {
        // Suppress bubbling/default actions
        Util.stopEvent(e);
        return false;
    } else {
        // Allow the event to bubble and become a keyPress event which
        // will have the character code translated
        return true;
    }
}

function onKeyUp(e) {
    if (! conf.focused) {
        return true;
    }
    if (k.keyup(e)) {
        // Suppress bubbling/default actions
        Util.stopEvent(e);
        return false;
    } else {
        // Allow the event to bubble and become a keyPress event which
        // will have the character code translated
        return true;
    }
}

function onOther(e) {
    k.syncModifiers(e);
}

function allKeysUp() {
    Util.Debug(">> Keyboard.allKeysUp");

    k.releaseAll();
    Util.Debug("<< Keyboard.allKeysUp");
}

//
// Public API interface functions
//

that.grab = function() {
    //Util.Debug(">> Keyboard.grab");
    var c = conf.target;

    Util.addEvent(c, 'keydown', onKeyDown);
    Util.addEvent(c, 'keyup', onKeyUp);
    Util.addEvent(c, 'keypress', onKeyPress);

    // Release (key up) if window loses focus
    Util.addEvent(window, 'blur', allKeysUp);

    //Util.Debug("<< Keyboard.grab");
};

that.ungrab = function() {
    //Util.Debug(">> Keyboard.ungrab");
    var c = conf.target;

    Util.removeEvent(c, 'keydown', onKeyDown);
    Util.removeEvent(c, 'keyup', onKeyUp);
    Util.removeEvent(c, 'keypress', onKeyPress);
    Util.removeEvent(window, 'blur', allKeysUp);

    // Release (key up) all keys that are in a down state
    allKeysUp();

    //Util.Debug(">> Keyboard.ungrab");
};

that.sync = function(e) {
    k.syncModifiers(e);
}

return that;  // Return the public API interface

}  // End of Keyboard()


//
// Mouse event handler
//

function Mouse(defaults) {
"use strict";

var that           = {},  // Public API methods
    conf           = {},  // Configuration attributes
    mouseCaptured  = false;

// Configuration attributes
Util.conf_defaults(conf, that, defaults, [
    ['target',         'ro', 'dom',  document, 'DOM element that captures mouse input'],
    ['notify',         'ro', 'func',  null, 'Function to call to notify whenever a mouse event is received'],
    ['focused',        'rw', 'bool', true, 'Capture and send mouse clicks/movement'],
    ['scale',          'rw', 'float', 1.0, 'Viewport scale factor 0.0 - 1.0'],

    ['onMouseButton',  'rw', 'func', null, 'Handler for mouse button click/release'],
    ['onMouseMove',    'rw', 'func', null, 'Handler for mouse movement'],
    ['touchButton',    'rw', 'int', 1, 'Button mask (1, 2, 4) for touch devices (0 means ignore clicks)']
    ]);

function captureMouse() {
    // capturing the mouse ensures we get the mouseup event
    if (conf.target.setCapture) {
        conf.target.setCapture();
    }

    // some browsers give us mouseup events regardless,
    // so if we never captured the mouse, we can disregard the event
    mouseCaptured = true;
}

function releaseMouse() {
    if (conf.target.releaseCapture) {
        conf.target.releaseCapture();
    }
    mouseCaptured = false;
}
// 
// Private functions
//

function onMouseButton(e, down) {
    var evt, pos, bmask;
    if (! conf.focused) {
        return true;
    }

    if (conf.notify) {
        conf.notify(e);
    }

    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    if (e.touches || e.changedTouches) {
        // Touch device
        bmask = conf.touchButton;
        // If bmask is set
    } else if (evt.which) {
        /* everything except IE */
        bmask = 1 << evt.button;
    } else {
        /* IE including 9 */
        bmask = (evt.button & 0x1) +      // Left
                (evt.button & 0x2) * 2 +  // Right
                (evt.button & 0x4) / 2;   // Middle
    }
    //Util.Debug("mouse " + pos.x + "," + pos.y + " down: " + down +
    //           " bmask: " + bmask + "(evt.button: " + evt.button + ")");
    if (bmask > 0 && conf.onMouseButton) {
        Util.Debug("onMouseButton " + (down ? "down" : "up") +
                   ", x: " + pos.x + ", y: " + pos.y + ", bmask: " + bmask);
        conf.onMouseButton(pos.x, pos.y, down, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseDown(e) {
    captureMouse();
    onMouseButton(e, 1);
}

function onMouseUp(e) {
    if (!mouseCaptured) {
        return;
    }

    onMouseButton(e, 0);
    releaseMouse();
}

function onMouseWheel(e) {
    var evt, pos, bmask, wheelData;
    if (! conf.focused) {
        return true;
    }
    if (conf.notify) {
        conf.notify(e);
    }

    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    wheelData = evt.detail ? evt.detail * -1 : evt.wheelDelta / 40;
    if (wheelData > 0) {
        bmask = 1 << 3;
    } else {
        bmask = 1 << 4;
    }
    //Util.Debug('mouse scroll by ' + wheelData + ':' + pos.x + "," + pos.y);
    if (conf.onMouseButton) {
        conf.onMouseButton(pos.x, pos.y, 1, bmask);
        conf.onMouseButton(pos.x, pos.y, 0, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseMove(e) {
    var evt, pos;
    if (! conf.focused) {
        return true;
    }
    if (conf.notify) {
        conf.notify(e);
    }

    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    //Util.Debug('mouse ' + evt.which + '/' + evt.button + ' up:' + pos.x + "," + pos.y);
    if (conf.onMouseMove) {
        conf.onMouseMove(pos.x, pos.y);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseDisable(e) {
    var evt, pos;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    /* Stop propagation if inside canvas area */
    if ((pos.x >= 0) && (pos.y >= 0) &&
        (pos.x < conf.target.offsetWidth) &&
        (pos.y < conf.target.offsetHeight)) {
        //Util.Debug("mouse event disabled");
        Util.stopEvent(e);
        return false;
    }
    //Util.Debug("mouse event not disabled");
    return true;
}

//
// Public API interface functions
//

that.grab = function() {
    //Util.Debug(">> Mouse.grab");
    var c = conf.target;

    if ('ontouchstart' in document.documentElement) {
        Util.addEvent(c, 'touchstart', onMouseDown);
        Util.addEvent(window, 'touchend', onMouseUp);
        Util.addEvent(c, 'touchend', onMouseUp);
        Util.addEvent(c, 'touchmove', onMouseMove);
    } else {
        Util.addEvent(c, 'mousedown', onMouseDown);
        Util.addEvent(window, 'mouseup', onMouseUp);
        Util.addEvent(c, 'mouseup', onMouseUp);
        Util.addEvent(c, 'mousemove', onMouseMove);
        Util.addEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
                onMouseWheel);
    }

    /* Work around right and middle click browser behaviors */
    Util.addEvent(document, 'click', onMouseDisable);
    Util.addEvent(document.body, 'contextmenu', onMouseDisable);

    //Util.Debug("<< Mouse.grab");
};

that.ungrab = function() {
    //Util.Debug(">> Mouse.ungrab");
    var c = conf.target;

    if ('ontouchstart' in document.documentElement) {
        Util.removeEvent(c, 'touchstart', onMouseDown);
        Util.removeEvent(window, 'touchend', onMouseUp);
        Util.removeEvent(c, 'touchend', onMouseUp);
        Util.removeEvent(c, 'touchmove', onMouseMove);
    } else {
        Util.removeEvent(c, 'mousedown', onMouseDown);
        Util.removeEvent(window, 'mouseup', onMouseUp);
        Util.removeEvent(c, 'mouseup', onMouseUp);
        Util.removeEvent(c, 'mousemove', onMouseMove);
        Util.removeEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
                onMouseWheel);
    }

    /* Work around right and middle click browser behaviors */
    Util.removeEvent(document, 'click', onMouseDisable);
    Util.removeEvent(document.body, 'contextmenu', onMouseDisable);

    //Util.Debug(">> Mouse.ungrab");
};

return that;  // Return the public API interface

}  // End of Mouse()


///////// keysymdef.js
var keysyms = (function(){
    var keynames = {"32":"space","33":"exclam","34":"quotedbl","35":"numbersign","36":"dollar","37":"percent","38":"ampersand","39":"quoteright","40":"parenleft","41":"parenright","42":"asterisk","43":"plus","44":"comma","45":"minus","46":"period","47":"slash","48":"0","49":"1","50":"2","51":"3","52":"4","53":"5","54":"6","55":"7","56":"8","57":"9","58":"colon","59":"semicolon","60":"less","61":"equal","62":"greater","63":"question","64":"at","65":"A","66":"B","67":"C","68":"D","69":"E","70":"F","71":"G","72":"H","73":"I","74":"J","75":"K","76":"L","77":"M","78":"N","79":"O","80":"P","81":"Q","82":"R","83":"S","84":"T","85":"U","86":"V","87":"W","88":"X","89":"Y","90":"Z","91":"bracketleft","92":"backslash","93":"bracketright","94":"asciicircum","95":"underscore","96":"quoteleft","97":"a","98":"b","99":"c","100":"d","101":"e","102":"f","103":"g","104":"h","105":"i","106":"j","107":"k","108":"l","109":"m","110":"n","111":"o","112":"p","113":"q","114":"r","115":"s","116":"t","117":"u","118":"v","119":"w","120":"x","121":"y","122":"z","123":"braceleft","124":"bar","125":"braceright","126":"asciitilde","160":"nobreakspace","161":"exclamdown","162":"cent","163":"sterling","164":"currency","165":"yen","166":"brokenbar","167":"section","168":"diaeresis","169":"copyright","170":"ordfeminine","171":"guillemotleft","172":"notsign","173":"hyphen","174":"registered","175":"macron","176":"degree","177":"plusminus","178":"twosuperior","179":"threesuperior","180":"acute","181":"mu","182":"paragraph","183":"periodcentered","184":"cedilla","185":"onesuperior","186":"masculine","187":"guillemotright","188":"onequarter","189":"onehalf","190":"threequarters","191":"questiondown","192":"Agrave","193":"Aacute","194":"Acircumflex","195":"Atilde","196":"Adiaeresis","197":"Aring","198":"AE","199":"Ccedilla","200":"Egrave","201":"Eacute","202":"Ecircumflex","203":"Ediaeresis","204":"Igrave","205":"Iacute","206":"Icircumflex","207":"Idiaeresis","208":"Eth","209":"Ntilde","210":"Ograve","211":"Oacute","212":"Ocircumflex","213":"Otilde","214":"Odiaeresis","215":"multiply","216":"Ooblique","217":"Ugrave","218":"Uacute","219":"Ucircumflex","220":"Udiaeresis","221":"Yacute","222":"Thorn","223":"ssharp","224":"agrave","225":"aacute","226":"acircumflex","227":"atilde","228":"adiaeresis","229":"aring","230":"ae","231":"ccedilla","232":"egrave","233":"eacute","234":"ecircumflex","235":"ediaeresis","236":"igrave","237":"iacute","238":"icircumflex","239":"idiaeresis","240":"eth","241":"ntilde","242":"ograve","243":"oacute","244":"ocircumflex","245":"otilde","246":"odiaeresis","247":"division","248":"ooblique","249":"ugrave","250":"uacute","251":"ucircumflex","252":"udiaeresis","253":"yacute","254":"thorn","255":"ydiaeresis","417":"Aogonek","418":"breve","419":"Lstroke","421":"Lcaron","422":"Sacute","425":"Scaron","426":"Scedilla","427":"Tcaron","428":"Zacute","430":"Zcaron","431":"Zabovedot","433":"aogonek","434":"ogonek","435":"lstroke","437":"lcaron","438":"sacute","439":"caron","441":"scaron","442":"scedilla","443":"tcaron","444":"zacute","445":"doubleacute","446":"zcaron","447":"zabovedot","448":"Racute","451":"Abreve","453":"Lacute","454":"Cacute","456":"Ccaron","458":"Eogonek","460":"Ecaron","463":"Dcaron","464":"Dstroke","465":"Nacute","466":"Ncaron","469":"Odoubleacute","472":"Rcaron","473":"Uring","475":"Udoubleacute","478":"Tcedilla","480":"racute","483":"abreve","485":"lacute","486":"cacute","488":"ccaron","490":"eogonek","492":"ecaron","495":"dcaron","496":"dstroke","497":"nacute","498":"ncaron","501":"odoubleacute","504":"rcaron","505":"uring","507":"udoubleacute","510":"tcedilla","511":"abovedot","673":"Hstroke","678":"Hcircumflex","681":"Iabovedot","683":"Gbreve","684":"Jcircumflex","689":"hstroke","694":"hcircumflex","697":"idotless","699":"gbreve","700":"jcircumflex","709":"Cabovedot","710":"Ccircumflex","725":"Gabovedot","728":"Gcircumflex","733":"Ubreve","734":"Scircumflex","741":"cabovedot","742":"ccircumflex","757":"gabovedot","760":"gcircumflex","765":"ubreve","766":"scircumflex","930":"kappa","931":"Rcedilla","933":"Itilde","934":"Lcedilla","938":"Emacron","939":"Gcedilla","940":"Tslash","947":"rcedilla","949":"itilde","950":"lcedilla","954":"emacron","955":"gcedilla","956":"tslash","957":"ENG","959":"eng","960":"Amacron","967":"Iogonek","972":"Eabovedot","975":"Imacron","977":"Ncedilla","978":"Omacron","979":"Kcedilla","985":"Uogonek","989":"Utilde","990":"Umacron","992":"amacron","999":"iogonek","1004":"eabovedot","1007":"imacron","1009":"ncedilla","1010":"omacron","1011":"kcedilla","1017":"uogonek","1021":"utilde","1022":"umacron","1150":"overline","1185":"kana_fullstop","1186":"kana_openingbracket","1187":"kana_closingbracket","1188":"kana_comma","1189":"kana_middledot","1190":"kana_WO","1191":"kana_a","1192":"kana_i","1193":"kana_u","1194":"kana_e","1195":"kana_o","1196":"kana_ya","1197":"kana_yu","1198":"kana_yo","1199":"kana_tu","1200":"prolongedsound","1201":"kana_A","1202":"kana_I","1203":"kana_U","1204":"kana_E","1205":"kana_O","1206":"kana_KA","1207":"kana_KI","1208":"kana_KU","1209":"kana_KE","1210":"kana_KO","1211":"kana_SA","1212":"kana_SHI","1213":"kana_SU","1214":"kana_SE","1215":"kana_SO","1216":"kana_TA","1217":"kana_TI","1218":"kana_TU","1219":"kana_TE","1220":"kana_TO","1221":"kana_NA","1222":"kana_NI","1223":"kana_NU","1224":"kana_NE","1225":"kana_NO","1226":"kana_HA","1227":"kana_HI","1228":"kana_HU","1229":"kana_HE","1230":"kana_HO","1231":"kana_MA","1232":"kana_MI","1233":"kana_MU","1234":"kana_ME","1235":"kana_MO","1236":"kana_YA","1237":"kana_YU","1238":"kana_YO","1239":"kana_RA","1240":"kana_RI","1241":"kana_RU","1242":"kana_RE","1243":"kana_RO","1244":"kana_WA","1245":"kana_N","1246":"voicedsound","1247":"semivoicedsound","1452":"Arabic_comma","1467":"Arabic_semicolon","1471":"Arabic_question_mark","1473":"Arabic_hamza","1474":"Arabic_maddaonalef","1475":"Arabic_hamzaonalef","1476":"Arabic_hamzaonwaw","1477":"Arabic_hamzaunderalef","1478":"Arabic_hamzaonyeh","1479":"Arabic_alef","1480":"Arabic_beh","1481":"Arabic_tehmarbuta","1482":"Arabic_teh","1483":"Arabic_theh","1484":"Arabic_jeem","1485":"Arabic_hah","1486":"Arabic_khah","1487":"Arabic_dal","1488":"Arabic_thal","1489":"Arabic_ra","1490":"Arabic_zain","1491":"Arabic_seen","1492":"Arabic_sheen","1493":"Arabic_sad","1494":"Arabic_dad","1495":"Arabic_tah","1496":"Arabic_zah","1497":"Arabic_ain","1498":"Arabic_ghain","1504":"Arabic_tatweel","1505":"Arabic_feh","1506":"Arabic_qaf","1507":"Arabic_kaf","1508":"Arabic_lam","1509":"Arabic_meem","1510":"Arabic_noon","1511":"Arabic_heh","1512":"Arabic_waw","1513":"Arabic_alefmaksura","1514":"Arabic_yeh","1515":"Arabic_fathatan","1516":"Arabic_dammatan","1517":"Arabic_kasratan","1518":"Arabic_fatha","1519":"Arabic_damma","1520":"Arabic_kasra","1521":"Arabic_shadda","1522":"Arabic_sukun","1697":"Serbian_dje","1698":"Macedonia_gje","1699":"Cyrillic_io","1700":"Ukranian_je","1701":"Macedonia_dse","1702":"Ukranian_i","1703":"Ukranian_yi","1704":"Serbian_je","1705":"Serbian_lje","1706":"Serbian_nje","1707":"Serbian_tshe","1708":"Macedonia_kje","1709":"Ukrainian_ghe_with_upturn","1710":"Byelorussian_shortu","1711":"Serbian_dze","1712":"numerosign","1713":"Serbian_DJE","1714":"Macedonia_GJE","1715":"Cyrillic_IO","1716":"Ukranian_JE","1717":"Macedonia_DSE","1718":"Ukranian_I","1719":"Ukranian_YI","1720":"Serbian_JE","1721":"Serbian_LJE","1722":"Serbian_NJE","1723":"Serbian_TSHE","1724":"Macedonia_KJE","1725":"Ukrainian_GHE_WITH_UPTURN","1726":"Byelorussian_SHORTU","1727":"Serbian_DZE","1728":"Cyrillic_yu","1729":"Cyrillic_a","1730":"Cyrillic_be","1731":"Cyrillic_tse","1732":"Cyrillic_de","1733":"Cyrillic_ie","1734":"Cyrillic_ef","1735":"Cyrillic_ghe","1736":"Cyrillic_ha","1737":"Cyrillic_i","1738":"Cyrillic_shorti","1739":"Cyrillic_ka","1740":"Cyrillic_el","1741":"Cyrillic_em","1742":"Cyrillic_en","1743":"Cyrillic_o","1744":"Cyrillic_pe","1745":"Cyrillic_ya","1746":"Cyrillic_er","1747":"Cyrillic_es","1748":"Cyrillic_te","1749":"Cyrillic_u","1750":"Cyrillic_zhe","1751":"Cyrillic_ve","1752":"Cyrillic_softsign","1753":"Cyrillic_yeru","1754":"Cyrillic_ze","1755":"Cyrillic_sha","1756":"Cyrillic_e","1757":"Cyrillic_shcha","1758":"Cyrillic_che","1759":"Cyrillic_hardsign","1760":"Cyrillic_YU","1761":"Cyrillic_A","1762":"Cyrillic_BE","1763":"Cyrillic_TSE","1764":"Cyrillic_DE","1765":"Cyrillic_IE","1766":"Cyrillic_EF","1767":"Cyrillic_GHE","1768":"Cyrillic_HA","1769":"Cyrillic_I","1770":"Cyrillic_SHORTI","1771":"Cyrillic_KA","1772":"Cyrillic_EL","1773":"Cyrillic_EM","1774":"Cyrillic_EN","1775":"Cyrillic_O","1776":"Cyrillic_PE","1777":"Cyrillic_YA","1778":"Cyrillic_ER","1779":"Cyrillic_ES","1780":"Cyrillic_TE","1781":"Cyrillic_U","1782":"Cyrillic_ZHE","1783":"Cyrillic_VE","1784":"Cyrillic_SOFTSIGN","1785":"Cyrillic_YERU","1786":"Cyrillic_ZE","1787":"Cyrillic_SHA","1788":"Cyrillic_E","1789":"Cyrillic_SHCHA","1790":"Cyrillic_CHE","1791":"Cyrillic_HARDSIGN","1953":"Greek_ALPHAaccent","1954":"Greek_EPSILONaccent","1955":"Greek_ETAaccent","1956":"Greek_IOTAaccent","1957":"Greek_IOTAdiaeresis","1959":"Greek_OMICRONaccent","1960":"Greek_UPSILONaccent","1961":"Greek_UPSILONdieresis","1963":"Greek_OMEGAaccent","1966":"Greek_accentdieresis","1967":"Greek_horizbar","1969":"Greek_alphaaccent","1970":"Greek_epsilonaccent","1971":"Greek_etaaccent","1972":"Greek_iotaaccent","1973":"Greek_iotadieresis","1974":"Greek_iotaaccentdieresis","1975":"Greek_omicronaccent","1976":"Greek_upsilonaccent","1977":"Greek_upsilondieresis","1978":"Greek_upsilonaccentdieresis","1979":"Greek_omegaaccent","1985":"Greek_ALPHA","1986":"Greek_BETA","1987":"Greek_GAMMA","1988":"Greek_DELTA","1989":"Greek_EPSILON","1990":"Greek_ZETA","1991":"Greek_ETA","1992":"Greek_THETA","1993":"Greek_IOTA","1994":"Greek_KAPPA","1995":"Greek_LAMBDA","1996":"Greek_MU","1997":"Greek_NU","1998":"Greek_XI","1999":"Greek_OMICRON","2000":"Greek_PI","2001":"Greek_RHO","2002":"Greek_SIGMA","2004":"Greek_TAU","2005":"Greek_UPSILON","2006":"Greek_PHI","2007":"Greek_CHI","2008":"Greek_PSI","2009":"Greek_OMEGA","2017":"Greek_alpha","2018":"Greek_beta","2019":"Greek_gamma","2020":"Greek_delta","2021":"Greek_epsilon","2022":"Greek_zeta","2023":"Greek_eta","2024":"Greek_theta","2025":"Greek_iota","2026":"Greek_kappa","2027":"Greek_lambda","2028":"Greek_mu","2029":"Greek_nu","2030":"Greek_xi","2031":"Greek_omicron","2032":"Greek_pi","2033":"Greek_rho","2034":"Greek_sigma","2035":"Greek_finalsmallsigma","2036":"Greek_tau","2037":"Greek_upsilon","2038":"Greek_phi","2039":"Greek_chi","2040":"Greek_psi","2041":"Greek_omega","2209":"leftradical","2210":"topleftradical","2211":"horizconnector","2212":"topintegral","2213":"botintegral","2214":"vertconnector","2215":"topleftsqbracket","2216":"botleftsqbracket","2217":"toprightsqbracket","2218":"botrightsqbracket","2219":"topleftparens","2220":"botleftparens","2221":"toprightparens","2222":"botrightparens","2223":"leftmiddlecurlybrace","2224":"rightmiddlecurlybrace","2225":"topleftsummation","2226":"botleftsummation","2227":"topvertsummationconnector","2228":"botvertsummationconnector","2229":"toprightsummation","2230":"botrightsummation","2231":"rightmiddlesummation","2236":"lessthanequal","2237":"notequal","2238":"greaterthanequal","2239":"integral","2240":"therefore","2241":"variation","2242":"infinity","2245":"nabla","2248":"approximate","2249":"similarequal","2253":"ifonlyif","2254":"implies","2255":"identical","2262":"radical","2266":"includedin","2267":"includes","2268":"intersection","2269":"union","2270":"logicaland","2271":"logicalor","2287":"partialderivative","2294":"function","2299":"leftarrow","2300":"uparrow","2301":"rightarrow","2302":"downarrow","2527":"blank","2528":"soliddiamond","2529":"checkerboard","2530":"ht","2531":"ff","2532":"cr","2533":"lf","2536":"nl","2537":"vt","2538":"lowrightcorner","2539":"uprightcorner","2540":"upleftcorner","2541":"lowleftcorner","2542":"crossinglines","2543":"horizlinescan1","2544":"horizlinescan3","2545":"horizlinescan5","2546":"horizlinescan7","2547":"horizlinescan9","2548":"leftt","2549":"rightt","2550":"bott","2551":"topt","2552":"vertbar","2721":"emspace","2722":"enspace","2723":"em3space","2724":"em4space","2725":"digitspace","2726":"punctspace","2727":"thinspace","2728":"hairspace","2729":"emdash","2730":"endash","2732":"signifblank","2734":"ellipsis","2735":"doubbaselinedot","2736":"onethird","2737":"twothirds","2738":"onefifth","2739":"twofifths","2740":"threefifths","2741":"fourfifths","2742":"onesixth","2743":"fivesixths","2744":"careof","2747":"figdash","2748":"leftanglebracket","2749":"decimalpoint","2750":"rightanglebracket","2751":"marker","2755":"oneeighth","2756":"threeeighths","2757":"fiveeighths","2758":"seveneighths","2761":"trademark","2762":"signaturemark","2763":"trademarkincircle","2764":"leftopentriangle","2765":"rightopentriangle","2766":"emopencircle","2767":"emopenrectangle","2768":"leftsinglequotemark","2769":"rightsinglequotemark","2770":"leftdoublequotemark","2771":"rightdoublequotemark","2772":"prescription","2773":"permille","2774":"minutes","2775":"seconds","2777":"latincross","2778":"hexagram","2779":"filledrectbullet","2780":"filledlefttribullet","2781":"filledrighttribullet","2782":"emfilledcircle","2783":"emfilledrect","2784":"enopencircbullet","2785":"enopensquarebullet","2786":"openrectbullet","2787":"opentribulletup","2788":"opentribulletdown","2789":"openstar","2790":"enfilledcircbullet","2791":"enfilledsqbullet","2792":"filledtribulletup","2793":"filledtribulletdown","2794":"leftpointer","2795":"rightpointer","2796":"club","2797":"diamond","2798":"heart","2800":"maltesecross","2801":"dagger","2802":"doubledagger","2803":"checkmark","2804":"ballotcross","2805":"musicalsharp","2806":"musicalflat","2807":"malesymbol","2808":"femalesymbol","2809":"telephone","2810":"telephonerecorder","2811":"phonographcopyright","2812":"caret","2813":"singlelowquotemark","2814":"doublelowquotemark","2815":"cursor","2979":"leftcaret","2982":"rightcaret","2984":"downcaret","2985":"upcaret","3008":"overbar","3010":"downtack","3011":"upshoe","3012":"downstile","3014":"underbar","3018":"jot","3020":"quad","3022":"uptack","3023":"circle","3027":"upstile","3030":"downshoe","3032":"rightshoe","3034":"leftshoe","3036":"lefttack","3068":"righttack","3295":"hebrew_doublelowline","3296":"hebrew_aleph","3297":"hebrew_beth","3298":"hebrew_gimmel","3299":"hebrew_daleth","3300":"hebrew_he","3301":"hebrew_waw","3302":"hebrew_zayin","3303":"hebrew_het","3304":"hebrew_teth","3305":"hebrew_yod","3306":"hebrew_finalkaph","3307":"hebrew_kaph","3308":"hebrew_lamed","3309":"hebrew_finalmem","3310":"hebrew_mem","3311":"hebrew_finalnun","3312":"hebrew_nun","3313":"hebrew_samekh","3314":"hebrew_ayin","3315":"hebrew_finalpe","3316":"hebrew_pe","3317":"hebrew_finalzadi","3318":"hebrew_zadi","3319":"hebrew_kuf","3320":"hebrew_resh","3321":"hebrew_shin","3322":"hebrew_taf","3489":"Thai_kokai","3490":"Thai_khokhai","3491":"Thai_khokhuat","3492":"Thai_khokhwai","3493":"Thai_khokhon","3494":"Thai_khorakhang","3495":"Thai_ngongu","3496":"Thai_chochan","3497":"Thai_choching","3498":"Thai_chochang","3499":"Thai_soso","3500":"Thai_chochoe","3501":"Thai_yoying","3502":"Thai_dochada","3503":"Thai_topatak","3504":"Thai_thothan","3505":"Thai_thonangmontho","3506":"Thai_thophuthao","3507":"Thai_nonen","3508":"Thai_dodek","3509":"Thai_totao","3510":"Thai_thothung","3511":"Thai_thothahan","3512":"Thai_thothong","3513":"Thai_nonu","3514":"Thai_bobaimai","3515":"Thai_popla","3516":"Thai_phophung","3517":"Thai_fofa","3518":"Thai_phophan","3519":"Thai_fofan","3520":"Thai_phosamphao","3521":"Thai_moma","3522":"Thai_yoyak","3523":"Thai_rorua","3524":"Thai_ru","3525":"Thai_loling","3526":"Thai_lu","3527":"Thai_wowaen","3528":"Thai_sosala","3529":"Thai_sorusi","3530":"Thai_sosua","3531":"Thai_hohip","3532":"Thai_lochula","3533":"Thai_oang","3534":"Thai_honokhuk","3535":"Thai_paiyannoi","3536":"Thai_saraa","3537":"Thai_maihanakat","3538":"Thai_saraaa","3539":"Thai_saraam","3540":"Thai_sarai","3541":"Thai_saraii","3542":"Thai_saraue","3543":"Thai_sarauee","3544":"Thai_sarau","3545":"Thai_sarauu","3546":"Thai_phinthu","3550":"Thai_maihanakat_maitho","3551":"Thai_baht","3552":"Thai_sarae","3553":"Thai_saraae","3554":"Thai_sarao","3555":"Thai_saraaimaimuan","3556":"Thai_saraaimaimalai","3557":"Thai_lakkhangyao","3558":"Thai_maiyamok","3559":"Thai_maitaikhu","3560":"Thai_maiek","3561":"Thai_maitho","3562":"Thai_maitri","3563":"Thai_maichattawa","3564":"Thai_thanthakhat","3565":"Thai_nikhahit","3568":"Thai_leksun","3569":"Thai_leknung","3570":"Thai_leksong","3571":"Thai_leksam","3572":"Thai_leksi","3573":"Thai_lekha","3574":"Thai_lekhok","3575":"Thai_lekchet","3576":"Thai_lekpaet","3577":"Thai_lekkao","3745":"Hangul_Kiyeog","3746":"Hangul_SsangKiyeog","3747":"Hangul_KiyeogSios","3748":"Hangul_Nieun","3749":"Hangul_NieunJieuj","3750":"Hangul_NieunHieuh","3751":"Hangul_Dikeud","3752":"Hangul_SsangDikeud","3753":"Hangul_Rieul","3754":"Hangul_RieulKiyeog","3755":"Hangul_RieulMieum","3756":"Hangul_RieulPieub","3757":"Hangul_RieulSios","3758":"Hangul_RieulTieut","3759":"Hangul_RieulPhieuf","3760":"Hangul_RieulHieuh","3761":"Hangul_Mieum","3762":"Hangul_Pieub","3763":"Hangul_SsangPieub","3764":"Hangul_PieubSios","3765":"Hangul_Sios","3766":"Hangul_SsangSios","3767":"Hangul_Ieung","3768":"Hangul_Jieuj","3769":"Hangul_SsangJieuj","3770":"Hangul_Cieuc","3771":"Hangul_Khieuq","3772":"Hangul_Tieut","3773":"Hangul_Phieuf","3774":"Hangul_Hieuh","3775":"Hangul_A","3776":"Hangul_AE","3777":"Hangul_YA","3778":"Hangul_YAE","3779":"Hangul_EO","3780":"Hangul_E","3781":"Hangul_YEO","3782":"Hangul_YE","3783":"Hangul_O","3784":"Hangul_WA","3785":"Hangul_WAE","3786":"Hangul_OE","3787":"Hangul_YO","3788":"Hangul_U","3789":"Hangul_WEO","3790":"Hangul_WE","3791":"Hangul_WI","3792":"Hangul_YU","3793":"Hangul_EU","3794":"Hangul_YI","3795":"Hangul_I","3796":"Hangul_J_Kiyeog","3797":"Hangul_J_SsangKiyeog","3798":"Hangul_J_KiyeogSios","3799":"Hangul_J_Nieun","3800":"Hangul_J_NieunJieuj","3801":"Hangul_J_NieunHieuh","3802":"Hangul_J_Dikeud","3803":"Hangul_J_Rieul","3804":"Hangul_J_RieulKiyeog","3805":"Hangul_J_RieulMieum","3806":"Hangul_J_RieulPieub","3807":"Hangul_J_RieulSios","3808":"Hangul_J_RieulTieut","3809":"Hangul_J_RieulPhieuf","3810":"Hangul_J_RieulHieuh","3811":"Hangul_J_Mieum","3812":"Hangul_J_Pieub","3813":"Hangul_J_PieubSios","3814":"Hangul_J_Sios","3815":"Hangul_J_SsangSios","3816":"Hangul_J_Ieung","3817":"Hangul_J_Jieuj","3818":"Hangul_J_Cieuc","3819":"Hangul_J_Khieuq","3820":"Hangul_J_Tieut","3821":"Hangul_J_Phieuf","3822":"Hangul_J_Hieuh","3823":"Hangul_RieulYeorinHieuh","3824":"Hangul_SunkyeongeumMieum","3825":"Hangul_SunkyeongeumPieub","3826":"Hangul_PanSios","3827":"Hangul_KkogjiDalrinIeung","3828":"Hangul_SunkyeongeumPhieuf","3829":"Hangul_YeorinHieuh","3830":"Hangul_AraeA","3831":"Hangul_AraeAE","3832":"Hangul_J_PanSios","3833":"Hangul_J_KkogjiDalrinIeung","3834":"Hangul_J_YeorinHieuh","3839":"Korean_Won","5052":"OE","5053":"oe","5054":"Ydiaeresis","8364":"EuroSign","64769":"3270_Duplicate","64770":"3270_FieldMark","64771":"3270_Right2","64772":"3270_Left2","64773":"3270_BackTab","64774":"3270_EraseEOF","64775":"3270_EraseInput","64776":"3270_Reset","64777":"3270_Quit","64778":"3270_PA1","64779":"3270_PA2","64780":"3270_PA3","64781":"3270_Test","64782":"3270_Attn","64783":"3270_CursorBlink","64784":"3270_AltCursor","64785":"3270_KeyClick","64786":"3270_Jump","64787":"3270_Ident","64788":"3270_Rule","64789":"3270_Copy","64790":"3270_Play","64791":"3270_Setup","64792":"3270_Record","64793":"3270_ChangeScreen","64794":"3270_DeleteWord","64795":"3270_ExSelect","64796":"3270_CursorSelect","64797":"3270_PrintScreen","64798":"3270_Enter","65025":"ISO_Lock","65026":"ISO_Level2_Latch","65027":"ISO_Level3_Shift","65028":"ISO_Level3_Latch","65029":"ISO_Level3_Lock","65030":"ISO_Group_Latch","65031":"ISO_Group_Lock","65032":"ISO_Next_Group","65033":"ISO_Next_Group_Lock","65034":"ISO_Prev_Group","65035":"ISO_Prev_Group_Lock","65036":"ISO_First_Group","65037":"ISO_First_Group_Lock","65038":"ISO_Last_Group","65039":"ISO_Last_Group_Lock","65041":"ISO_Level5_Shift","65042":"ISO_Level5_Latch","65043":"ISO_Level5_Lock","65056":"ISO_Left_Tab","65057":"ISO_Move_Line_Up","65058":"ISO_Move_Line_Down","65059":"ISO_Partial_Line_Up","65060":"ISO_Partial_Line_Down","65061":"ISO_Partial_Space_Left","65062":"ISO_Partial_Space_Right","65063":"ISO_Set_Margin_Left","65064":"ISO_Set_Margin_Right","65065":"ISO_Release_Margin_Left","65066":"ISO_Release_Margin_Right","65067":"ISO_Release_Both_Margins","65068":"ISO_Fast_Cursor_Left","65069":"ISO_Fast_Cursor_Right","65070":"ISO_Fast_Cursor_Up","65071":"ISO_Fast_Cursor_Down","65072":"ISO_Continuous_Underline","65073":"ISO_Discontinuous_Underline","65074":"ISO_Emphasize","65075":"ISO_Center_Object","65076":"ISO_Enter","65104":"dead_grave","65105":"dead_acute","65106":"dead_circumflex","65107":"dead_perispomeni","65108":"dead_macron","65109":"dead_breve","65110":"dead_abovedot","65111":"dead_diaeresis","65112":"dead_abovering","65113":"dead_doubleacute","65114":"dead_caron","65115":"dead_cedilla","65116":"dead_ogonek","65117":"dead_iota","65118":"dead_voiced_sound","65119":"dead_semivoiced_sound","65120":"dead_belowdot","65121":"dead_hook","65122":"dead_horn","65123":"dead_stroke","65124":"dead_psili","65125":"dead_dasia","65126":"dead_doublegrave","65127":"dead_belowring","65128":"dead_belowmacron","65129":"dead_belowcircumflex","65130":"dead_belowtilde","65131":"dead_belowbreve","65132":"dead_belowdiaeresis","65133":"dead_invertedbreve","65134":"dead_belowcomma","65135":"dead_currency","65136":"AccessX_Enable","65137":"AccessX_Feedback_Enable","65138":"RepeatKeys_Enable","65139":"SlowKeys_Enable","65140":"BounceKeys_Enable","65141":"StickyKeys_Enable","65142":"MouseKeys_Enable","65143":"MouseKeys_Accel_Enable","65144":"Overlay1_Enable","65145":"Overlay2_Enable","65146":"AudibleBell_Enable","65152":"dead_a","65153":"dead_A","65154":"dead_e","65155":"dead_E","65156":"dead_i","65157":"dead_I","65158":"dead_o","65159":"dead_O","65160":"dead_u","65161":"dead_U","65162":"dead_small_schwa","65163":"dead_capital_schwa","65164":"dead_greek","65184":"ch","65185":"Ch","65186":"CH","65187":"c_h","65188":"C_h","65189":"C_H","65232":"First_Virtual_Screen","65233":"Prev_Virtual_Screen","65234":"Next_Virtual_Screen","65236":"Last_Virtual_Screen","65237":"Terminate_Server","65248":"Pointer_Left","65249":"Pointer_Right","65250":"Pointer_Up","65251":"Pointer_Down","65252":"Pointer_UpLeft","65253":"Pointer_UpRight","65254":"Pointer_DownLeft","65255":"Pointer_DownRight","65256":"Pointer_Button_Dflt","65257":"Pointer_Button1","65258":"Pointer_Button2","65259":"Pointer_Button3","65260":"Pointer_Button4","65261":"Pointer_Button5","65262":"Pointer_DblClick_Dflt","65263":"Pointer_DblClick1","65264":"Pointer_DblClick2","65265":"Pointer_DblClick3","65266":"Pointer_DblClick4","65267":"Pointer_DblClick5","65268":"Pointer_Drag_Dflt","65269":"Pointer_Drag1","65270":"Pointer_Drag2","65271":"Pointer_Drag3","65272":"Pointer_Drag4","65273":"Pointer_EnableKeys","65274":"Pointer_Accelerate","65275":"Pointer_DfltBtnNext","65276":"Pointer_DfltBtnPrev","65277":"Pointer_Drag5","65288":"BackSpace","65289":"Tab","65290":"Linefeed","65291":"Clear","65293":"Return","65299":"Pause","65300":"Scroll_Lock","65301":"Sys_Req","65307":"Escape","65312":"Multi_key","65313":"Kanji","65314":"Muhenkan","65315":"Henkan","65316":"Romaji","65317":"Hiragana","65318":"Katakana","65319":"Hiragana_Katakana","65320":"Zenkaku","65321":"Hankaku","65322":"Zenkaku_Hankaku","65323":"Touroku","65324":"Massyo","65325":"Kana_Lock","65326":"Kana_Shift","65327":"Eisu_Shift","65328":"Eisu_toggle","65329":"Hangul","65330":"Hangul_Start","65331":"Hangul_End","65332":"Hangul_Hanja","65333":"Hangul_Jamo","65334":"Hangul_Romaja","65335":"Hangul_Codeinput","65336":"Hangul_Jeonja","65337":"Hangul_Banja","65338":"Hangul_PreHanja","65339":"Hangul_PostHanja","65340":"Hangul_SingleCandidate","65341":"Hangul_MultipleCandidate","65342":"Hangul_PreviousCandidate","65343":"Hangul_Special","65360":"Home","65361":"Left","65362":"Up","65363":"Right","65364":"Down","65365":"Page_Up","65366":"Page_Down","65367":"End","65368":"Begin","65376":"Select","65377":"Print","65378":"Execute","65379":"Insert","65381":"Undo","65382":"Redo","65383":"Menu","65384":"Find","65385":"Cancel","65386":"Help","65387":"Break","65406":"Hangul_switch","65407":"Num_Lock","65408":"KP_Space","65417":"KP_Tab","65421":"KP_Enter","65425":"KP_F1","65426":"KP_F2","65427":"KP_F3","65428":"KP_F4","65429":"KP_Home","65430":"KP_Left","65431":"KP_Up","65432":"KP_Right","65433":"KP_Down","65434":"KP_Page_Up","65435":"KP_Page_Down","65436":"KP_End","65437":"KP_Begin","65438":"KP_Insert","65439":"KP_Delete","65450":"KP_Multiply","65451":"KP_Add","65452":"KP_Separator","65453":"KP_Subtract","65454":"KP_Decimal","65455":"KP_Divide","65456":"KP_0","65457":"KP_1","65458":"KP_2","65459":"KP_3","65460":"KP_4","65461":"KP_5","65462":"KP_6","65463":"KP_7","65464":"KP_8","65465":"KP_9","65469":"KP_Equal","65470":"F1","65471":"F2","65472":"F3","65473":"F4","65474":"F5","65475":"F6","65476":"F7","65477":"F8","65478":"F9","65479":"F10","65480":"L1","65481":"L2","65482":"L3","65483":"L4","65484":"L5","65485":"L6","65486":"L7","65487":"L8","65488":"L9","65489":"L10","65490":"R1","65491":"R2","65492":"R3","65493":"R4","65494":"R5","65495":"R6","65496":"R7","65497":"R8","65498":"R9","65499":"R10","65500":"R11","65501":"R12","65502":"R13","65503":"R14","65504":"R15","65505":"Shift_L","65506":"Shift_R","65507":"Control_L","65508":"Control_R","65509":"Caps_Lock","65510":"Shift_Lock","65511":"Meta_L","65512":"Meta_R","65513":"Alt_L","65514":"Alt_R","65515":"Super_L","65516":"Super_R","65517":"Hyper_L","65518":"Hyper_R","65521":"braille_dot_1","65522":"braille_dot_2","65523":"braille_dot_3","65524":"braille_dot_4","65525":"braille_dot_5","65526":"braille_dot_6","65527":"braille_dot_7","65528":"braille_dot_8","65529":"braille_dot_9","65530":"braille_dot_10","65535":"Delete","16777215":"VoidSymbol","16777516":"Ibreve","16777517":"ibreve","16777588":"Wcircumflex","16777589":"wcircumflex","16777590":"Ycircumflex","16777591":"ycircumflex","16777615":"SCHWA","16777631":"Obarred","16777632":"Ohorn","16777633":"ohorn","16777647":"Uhorn","16777648":"uhorn","16777653":"Zstroke","16777654":"zstroke","16777655":"EZH","16777681":"Ocaron","16777682":"ocaron","16777702":"Gcaron","16777703":"gcaron","16777817":"schwa","16777845":"obarred","16777874":"ezh","16778386":"Cyrillic_GHE_bar","16778387":"Cyrillic_ghe_bar","16778390":"Cyrillic_ZHE_descender","16778391":"Cyrillic_zhe_descender","16778394":"Cyrillic_KA_descender","16778395":"Cyrillic_ka_descender","16778396":"Cyrillic_KA_vertstroke","16778397":"Cyrillic_ka_vertstroke","16778402":"Cyrillic_EN_descender","16778403":"Cyrillic_en_descender","16778414":"Cyrillic_U_straight","16778415":"Cyrillic_u_straight","16778416":"Cyrillic_U_straight_bar","16778417":"Cyrillic_u_straight_bar","16778418":"Cyrillic_HA_descender","16778419":"Cyrillic_ha_descender","16778422":"Cyrillic_CHE_descender","16778423":"Cyrillic_che_descender","16778424":"Cyrillic_CHE_vertstroke","16778425":"Cyrillic_che_vertstroke","16778426":"Cyrillic_SHHA","16778427":"Cyrillic_shha","16778456":"Cyrillic_SCHWA","16778457":"Cyrillic_schwa","16778466":"Cyrillic_I_macron","16778467":"Cyrillic_i_macron","16778472":"Cyrillic_O_bar","16778473":"Cyrillic_o_bar","16778478":"Cyrillic_U_macron","16778479":"Cyrillic_u_macron","16778545":"Armenian_AYB","16778546":"Armenian_BEN","16778547":"Armenian_GIM","16778548":"Armenian_DA","16778549":"Armenian_YECH","16778550":"Armenian_ZA","16778551":"Armenian_E","16778552":"Armenian_AT","16778553":"Armenian_TO","16778554":"Armenian_ZHE","16778555":"Armenian_INI","16778556":"Armenian_LYUN","16778557":"Armenian_KHE","16778558":"Armenian_TSA","16778559":"Armenian_KEN","16778560":"Armenian_HO","16778561":"Armenian_DZA","16778562":"Armenian_GHAT","16778563":"Armenian_TCHE","16778564":"Armenian_MEN","16778565":"Armenian_HI","16778566":"Armenian_NU","16778567":"Armenian_SHA","16778568":"Armenian_VO","16778569":"Armenian_CHA","16778570":"Armenian_PE","16778571":"Armenian_JE","16778572":"Armenian_RA","16778573":"Armenian_SE","16778574":"Armenian_VEV","16778575":"Armenian_TYUN","16778576":"Armenian_RE","16778577":"Armenian_TSO","16778578":"Armenian_VYUN","16778579":"Armenian_PYUR","16778580":"Armenian_KE","16778581":"Armenian_O","16778582":"Armenian_FE","16778586":"Armenian_apostrophe","16778587":"Armenian_shesht","16778588":"Armenian_amanak","16778589":"Armenian_but","16778590":"Armenian_paruyk","16778593":"Armenian_ayb","16778594":"Armenian_ben","16778595":"Armenian_gim","16778596":"Armenian_da","16778597":"Armenian_yech","16778598":"Armenian_za","16778599":"Armenian_e","16778600":"Armenian_at","16778601":"Armenian_to","16778602":"Armenian_zhe","16778603":"Armenian_ini","16778604":"Armenian_lyun","16778605":"Armenian_khe","16778606":"Armenian_tsa","16778607":"Armenian_ken","16778608":"Armenian_ho","16778609":"Armenian_dza","16778610":"Armenian_ghat","16778611":"Armenian_tche","16778612":"Armenian_men","16778613":"Armenian_hi","16778614":"Armenian_nu","16778615":"Armenian_sha","16778616":"Armenian_vo","16778617":"Armenian_cha","16778618":"Armenian_pe","16778619":"Armenian_je","16778620":"Armenian_ra","16778621":"Armenian_se","16778622":"Armenian_vev","16778623":"Armenian_tyun","16778624":"Armenian_re","16778625":"Armenian_tso","16778626":"Armenian_vyun","16778627":"Armenian_pyur","16778628":"Armenian_ke","16778629":"Armenian_o","16778630":"Armenian_fe","16778631":"Armenian_ligature_ew","16778633":"Armenian_verjaket","16778634":"Armenian_yentamna","16778835":"Arabic_madda_above","16778836":"Arabic_hamza_above","16778837":"Arabic_hamza_below","16778848":"Arabic_0","16778849":"Arabic_1","16778850":"Arabic_2","16778851":"Arabic_3","16778852":"Arabic_4","16778853":"Arabic_5","16778854":"Arabic_6","16778855":"Arabic_7","16778856":"Arabic_8","16778857":"Arabic_9","16778858":"Arabic_percent","16778864":"Arabic_superscript_alef","16778873":"Arabic_tteh","16778878":"Arabic_peh","16778886":"Arabic_tcheh","16778888":"Arabic_ddal","16778897":"Arabic_rreh","16778904":"Arabic_jeh","16778916":"Arabic_veh","16778921":"Arabic_keheh","16778927":"Arabic_gaf","16778938":"Arabic_noon_ghunna","16778942":"Arabic_heh_doachashmee","16778945":"Arabic_heh_goal","16778956":"Arabic_farsi_yeh","16778962":"Arabic_yeh_baree","16778964":"Arabic_fullstop","16778992":"Farsi_0","16778993":"Farsi_1","16778994":"Farsi_2","16778995":"Farsi_3","16778996":"Farsi_4","16778997":"Farsi_5","16778998":"Farsi_6","16778999":"Farsi_7","16779000":"Farsi_8","16779001":"Farsi_9","16780674":"Sinh_ng","16780675":"Sinh_h2","16780677":"Sinh_a","16780678":"Sinh_aa","16780679":"Sinh_ae","16780680":"Sinh_aee","16780681":"Sinh_i","16780682":"Sinh_ii","16780683":"Sinh_u","16780684":"Sinh_uu","16780685":"Sinh_ri","16780686":"Sinh_rii","16780687":"Sinh_lu","16780688":"Sinh_luu","16780689":"Sinh_e","16780690":"Sinh_ee","16780691":"Sinh_ai","16780692":"Sinh_o","16780693":"Sinh_oo","16780694":"Sinh_au","16780698":"Sinh_ka","16780699":"Sinh_kha","16780700":"Sinh_ga","16780701":"Sinh_gha","16780702":"Sinh_ng2","16780703":"Sinh_nga","16780704":"Sinh_ca","16780705":"Sinh_cha","16780706":"Sinh_ja","16780707":"Sinh_jha","16780708":"Sinh_nya","16780709":"Sinh_jnya","16780710":"Sinh_nja","16780711":"Sinh_tta","16780712":"Sinh_ttha","16780713":"Sinh_dda","16780714":"Sinh_ddha","16780715":"Sinh_nna","16780716":"Sinh_ndda","16780717":"Sinh_tha","16780718":"Sinh_thha","16780719":"Sinh_dha","16780720":"Sinh_dhha","16780721":"Sinh_na","16780723":"Sinh_ndha","16780724":"Sinh_pa","16780725":"Sinh_pha","16780726":"Sinh_ba","16780727":"Sinh_bha","16780728":"Sinh_ma","16780729":"Sinh_mba","16780730":"Sinh_ya","16780731":"Sinh_ra","16780733":"Sinh_la","16780736":"Sinh_va","16780737":"Sinh_sha","16780738":"Sinh_ssha","16780739":"Sinh_sa","16780740":"Sinh_ha","16780741":"Sinh_lla","16780742":"Sinh_fa","16780746":"Sinh_al","16780751":"Sinh_aa2","16780752":"Sinh_ae2","16780753":"Sinh_aee2","16780754":"Sinh_i2","16780755":"Sinh_ii2","16780756":"Sinh_u2","16780758":"Sinh_uu2","16780760":"Sinh_ru2","16780761":"Sinh_e2","16780762":"Sinh_ee2","16780763":"Sinh_ai2","16780764":"Sinh_o2","16780765":"Sinh_oo2","16780766":"Sinh_au2","16780767":"Sinh_lu2","16780786":"Sinh_ruu2","16780787":"Sinh_luu2","16780788":"Sinh_kunddaliya","16781520":"Georgian_an","16781521":"Georgian_ban","16781522":"Georgian_gan","16781523":"Georgian_don","16781524":"Georgian_en","16781525":"Georgian_vin","16781526":"Georgian_zen","16781527":"Georgian_tan","16781528":"Georgian_in","16781529":"Georgian_kan","16781530":"Georgian_las","16781531":"Georgian_man","16781532":"Georgian_nar","16781533":"Georgian_on","16781534":"Georgian_par","16781535":"Georgian_zhar","16781536":"Georgian_rae","16781537":"Georgian_san","16781538":"Georgian_tar","16781539":"Georgian_un","16781540":"Georgian_phar","16781541":"Georgian_khar","16781542":"Georgian_ghan","16781543":"Georgian_qar","16781544":"Georgian_shin","16781545":"Georgian_chin","16781546":"Georgian_can","16781547":"Georgian_jil","16781548":"Georgian_cil","16781549":"Georgian_char","16781550":"Georgian_xan","16781551":"Georgian_jhan","16781552":"Georgian_hae","16781553":"Georgian_he","16781554":"Georgian_hie","16781555":"Georgian_we","16781556":"Georgian_har","16781557":"Georgian_hoe","16781558":"Georgian_fi","16784898":"Babovedot","16784899":"babovedot","16784906":"Dabovedot","16784907":"dabovedot","16784926":"Fabovedot","16784927":"fabovedot","16784950":"Lbelowdot","16784951":"lbelowdot","16784960":"Mabovedot","16784961":"mabovedot","16784982":"Pabovedot","16784983":"pabovedot","16784992":"Sabovedot","16784993":"sabovedot","16785002":"Tabovedot","16785003":"tabovedot","16785024":"Wgrave","16785025":"wgrave","16785026":"Wacute","16785027":"wacute","16785028":"Wdiaeresis","16785029":"wdiaeresis","16785034":"Xabovedot","16785035":"xabovedot","16785056":"Abelowdot","16785057":"abelowdot","16785058":"Ahook","16785059":"ahook","16785060":"Acircumflexacute","16785061":"acircumflexacute","16785062":"Acircumflexgrave","16785063":"acircumflexgrave","16785064":"Acircumflexhook","16785065":"acircumflexhook","16785066":"Acircumflextilde","16785067":"acircumflextilde","16785068":"Acircumflexbelowdot","16785069":"acircumflexbelowdot","16785070":"Abreveacute","16785071":"abreveacute","16785072":"Abrevegrave","16785073":"abrevegrave","16785074":"Abrevehook","16785075":"abrevehook","16785076":"Abrevetilde","16785077":"abrevetilde","16785078":"Abrevebelowdot","16785079":"abrevebelowdot","16785080":"Ebelowdot","16785081":"ebelowdot","16785082":"Ehook","16785083":"ehook","16785084":"Etilde","16785085":"etilde","16785086":"Ecircumflexacute","16785087":"ecircumflexacute","16785088":"Ecircumflexgrave","16785089":"ecircumflexgrave","16785090":"Ecircumflexhook","16785091":"ecircumflexhook","16785092":"Ecircumflextilde","16785093":"ecircumflextilde","16785094":"Ecircumflexbelowdot","16785095":"ecircumflexbelowdot","16785096":"Ihook","16785097":"ihook","16785098":"Ibelowdot","16785099":"ibelowdot","16785100":"Obelowdot","16785101":"obelowdot","16785102":"Ohook","16785103":"ohook","16785104":"Ocircumflexacute","16785105":"ocircumflexacute","16785106":"Ocircumflexgrave","16785107":"ocircumflexgrave","16785108":"Ocircumflexhook","16785109":"ocircumflexhook","16785110":"Ocircumflextilde","16785111":"ocircumflextilde","16785112":"Ocircumflexbelowdot","16785113":"ocircumflexbelowdot","16785114":"Ohornacute","16785115":"ohornacute","16785116":"Ohorngrave","16785117":"ohorngrave","16785118":"Ohornhook","16785119":"ohornhook","16785120":"Ohorntilde","16785121":"ohorntilde","16785122":"Ohornbelowdot","16785123":"ohornbelowdot","16785124":"Ubelowdot","16785125":"ubelowdot","16785126":"Uhook","16785127":"uhook","16785128":"Uhornacute","16785129":"uhornacute","16785130":"Uhorngrave","16785131":"uhorngrave","16785132":"Uhornhook","16785133":"uhornhook","16785134":"Uhorntilde","16785135":"uhorntilde","16785136":"Uhornbelowdot","16785137":"uhornbelowdot","16785138":"Ygrave","16785139":"ygrave","16785140":"Ybelowdot","16785141":"ybelowdot","16785142":"Yhook","16785143":"yhook","16785144":"Ytilde","16785145":"ytilde","16785520":"zerosuperior","16785524":"foursuperior","16785525":"fivesuperior","16785526":"sixsuperior","16785527":"sevensuperior","16785528":"eightsuperior","16785529":"ninesuperior","16785536":"zerosubscript","16785537":"onesubscript","16785538":"twosubscript","16785539":"threesubscript","16785540":"foursubscript","16785541":"fivesubscript","16785542":"sixsubscript","16785543":"sevensubscript","16785544":"eightsubscript","16785545":"ninesubscript","16785568":"EcuSign","16785569":"ColonSign","16785570":"CruzeiroSign","16785571":"FFrancSign","16785572":"LiraSign","16785573":"MillSign","16785574":"NairaSign","16785575":"PesetaSign","16785576":"RupeeSign","16785577":"WonSign","16785578":"NewSheqelSign","16785579":"DongSign","16785922":"partdifferential","16785925":"emptyset","16785928":"elementof","16785929":"notelementof","16785931":"containsas","16785946":"squareroot","16785947":"cuberoot","16785948":"fourthroot","16785964":"dintegral","16785965":"tintegral","16785973":"because","16785991":"notapproxeq","16785992":"approxeq","16786018":"notidentical","16786019":"stricteq","16787456":"braille_blank","16787457":"braille_dots_1","16787458":"braille_dots_2","16787459":"braille_dots_12","16787460":"braille_dots_3","16787461":"braille_dots_13","16787462":"braille_dots_23","16787463":"braille_dots_123","16787464":"braille_dots_4","16787465":"braille_dots_14","16787466":"braille_dots_24","16787467":"braille_dots_124","16787468":"braille_dots_34","16787469":"braille_dots_134","16787470":"braille_dots_234","16787471":"braille_dots_1234","16787472":"braille_dots_5","16787473":"braille_dots_15","16787474":"braille_dots_25","16787475":"braille_dots_125","16787476":"braille_dots_35","16787477":"braille_dots_135","16787478":"braille_dots_235","16787479":"braille_dots_1235","16787480":"braille_dots_45","16787481":"braille_dots_145","16787482":"braille_dots_245","16787483":"braille_dots_1245","16787484":"braille_dots_345","16787485":"braille_dots_1345","16787486":"braille_dots_2345","16787487":"braille_dots_12345","16787488":"braille_dots_6","16787489":"braille_dots_16","16787490":"braille_dots_26","16787491":"braille_dots_126","16787492":"braille_dots_36","16787493":"braille_dots_136","16787494":"braille_dots_236","16787495":"braille_dots_1236","16787496":"braille_dots_46","16787497":"braille_dots_146","16787498":"braille_dots_246","16787499":"braille_dots_1246","16787500":"braille_dots_346","16787501":"braille_dots_1346","16787502":"braille_dots_2346","16787503":"braille_dots_12346","16787504":"braille_dots_56","16787505":"braille_dots_156","16787506":"braille_dots_256","16787507":"braille_dots_1256","16787508":"braille_dots_356","16787509":"braille_dots_1356","16787510":"braille_dots_2356","16787511":"braille_dots_12356","16787512":"braille_dots_456","16787513":"braille_dots_1456","16787514":"braille_dots_2456","16787515":"braille_dots_12456","16787516":"braille_dots_3456","16787517":"braille_dots_13456","16787518":"braille_dots_23456","16787519":"braille_dots_123456","16787520":"braille_dots_7","16787521":"braille_dots_17","16787522":"braille_dots_27","16787523":"braille_dots_127","16787524":"braille_dots_37","16787525":"braille_dots_137","16787526":"braille_dots_237","16787527":"braille_dots_1237","16787528":"braille_dots_47","16787529":"braille_dots_147","16787530":"braille_dots_247","16787531":"braille_dots_1247","16787532":"braille_dots_347","16787533":"braille_dots_1347","16787534":"braille_dots_2347","16787535":"braille_dots_12347","16787536":"braille_dots_57","16787537":"braille_dots_157","16787538":"braille_dots_257","16787539":"braille_dots_1257","16787540":"braille_dots_357","16787541":"braille_dots_1357","16787542":"braille_dots_2357","16787543":"braille_dots_12357","16787544":"braille_dots_457","16787545":"braille_dots_1457","16787546":"braille_dots_2457","16787547":"braille_dots_12457","16787548":"braille_dots_3457","16787549":"braille_dots_13457","16787550":"braille_dots_23457","16787551":"braille_dots_123457","16787552":"braille_dots_67","16787553":"braille_dots_167","16787554":"braille_dots_267","16787555":"braille_dots_1267","16787556":"braille_dots_367","16787557":"braille_dots_1367","16787558":"braille_dots_2367","16787559":"braille_dots_12367","16787560":"braille_dots_467","16787561":"braille_dots_1467","16787562":"braille_dots_2467","16787563":"braille_dots_12467","16787564":"braille_dots_3467","16787565":"braille_dots_13467","16787566":"braille_dots_23467","16787567":"braille_dots_123467","16787568":"braille_dots_567","16787569":"braille_dots_1567","16787570":"braille_dots_2567","16787571":"braille_dots_12567","16787572":"braille_dots_3567","16787573":"braille_dots_13567","16787574":"braille_dots_23567","16787575":"braille_dots_123567","16787576":"braille_dots_4567","16787577":"braille_dots_14567","16787578":"braille_dots_24567","16787579":"braille_dots_124567","16787580":"braille_dots_34567","16787581":"braille_dots_134567","16787582":"braille_dots_234567","16787583":"braille_dots_1234567","16787584":"braille_dots_8","16787585":"braille_dots_18","16787586":"braille_dots_28","16787587":"braille_dots_128","16787588":"braille_dots_38","16787589":"braille_dots_138","16787590":"braille_dots_238","16787591":"braille_dots_1238","16787592":"braille_dots_48","16787593":"braille_dots_148","16787594":"braille_dots_248","16787595":"braille_dots_1248","16787596":"braille_dots_348","16787597":"braille_dots_1348","16787598":"braille_dots_2348","16787599":"braille_dots_12348","16787600":"braille_dots_58","16787601":"braille_dots_158","16787602":"braille_dots_258","16787603":"braille_dots_1258","16787604":"braille_dots_358","16787605":"braille_dots_1358","16787606":"braille_dots_2358","16787607":"braille_dots_12358","16787608":"braille_dots_458","16787609":"braille_dots_1458","16787610":"braille_dots_2458","16787611":"braille_dots_12458","16787612":"braille_dots_3458","16787613":"braille_dots_13458","16787614":"braille_dots_23458","16787615":"braille_dots_123458","16787616":"braille_dots_68","16787617":"braille_dots_168","16787618":"braille_dots_268","16787619":"braille_dots_1268","16787620":"braille_dots_368","16787621":"braille_dots_1368","16787622":"braille_dots_2368","16787623":"braille_dots_12368","16787624":"braille_dots_468","16787625":"braille_dots_1468","16787626":"braille_dots_2468","16787627":"braille_dots_12468","16787628":"braille_dots_3468","16787629":"braille_dots_13468","16787630":"braille_dots_23468","16787631":"braille_dots_123468","16787632":"braille_dots_568","16787633":"braille_dots_1568","16787634":"braille_dots_2568","16787635":"braille_dots_12568","16787636":"braille_dots_3568","16787637":"braille_dots_13568","16787638":"braille_dots_23568","16787639":"braille_dots_123568","16787640":"braille_dots_4568","16787641":"braille_dots_14568","16787642":"braille_dots_24568","16787643":"braille_dots_124568","16787644":"braille_dots_34568","16787645":"braille_dots_134568","16787646":"braille_dots_234568","16787647":"braille_dots_1234568","16787648":"braille_dots_78","16787649":"braille_dots_178","16787650":"braille_dots_278","16787651":"braille_dots_1278","16787652":"braille_dots_378","16787653":"braille_dots_1378","16787654":"braille_dots_2378","16787655":"braille_dots_12378","16787656":"braille_dots_478","16787657":"braille_dots_1478","16787658":"braille_dots_2478","16787659":"braille_dots_12478","16787660":"braille_dots_3478","16787661":"braille_dots_13478","16787662":"braille_dots_23478","16787663":"braille_dots_123478","16787664":"braille_dots_578","16787665":"braille_dots_1578","16787666":"braille_dots_2578","16787667":"braille_dots_12578","16787668":"braille_dots_3578","16787669":"braille_dots_13578","16787670":"braille_dots_23578","16787671":"braille_dots_123578","16787672":"braille_dots_4578","16787673":"braille_dots_14578","16787674":"braille_dots_24578","16787675":"braille_dots_124578","16787676":"braille_dots_34578","16787677":"braille_dots_134578","16787678":"braille_dots_234578","16787679":"braille_dots_1234578","16787680":"braille_dots_678","16787681":"braille_dots_1678","16787682":"braille_dots_2678","16787683":"braille_dots_12678","16787684":"braille_dots_3678","16787685":"braille_dots_13678","16787686":"braille_dots_23678","16787687":"braille_dots_123678","16787688":"braille_dots_4678","16787689":"braille_dots_14678","16787690":"braille_dots_24678","16787691":"braille_dots_124678","16787692":"braille_dots_34678","16787693":"braille_dots_134678","16787694":"braille_dots_234678","16787695":"braille_dots_1234678","16787696":"braille_dots_5678","16787697":"braille_dots_15678","16787698":"braille_dots_25678","16787699":"braille_dots_125678","16787700":"braille_dots_35678","16787701":"braille_dots_135678","16787702":"braille_dots_235678","16787703":"braille_dots_1235678","16787704":"braille_dots_45678","16787705":"braille_dots_145678","16787706":"braille_dots_245678","16787707":"braille_dots_1245678","16787708":"braille_dots_345678","16787709":"braille_dots_1345678","16787710":"braille_dots_2345678","16787711":"braille_dots_12345678"};
    var codepoints = {"32":32,"33":33,"34":34,"35":35,"36":36,"37":37,"38":38,"39":39,"40":40,"41":41,"42":42,"43":43,"44":44,"45":45,"46":46,"47":47,"48":48,"49":49,"50":50,"51":51,"52":52,"53":53,"54":54,"55":55,"56":56,"57":57,"58":58,"59":59,"60":60,"61":61,"62":62,"63":63,"64":64,"65":65,"66":66,"67":67,"68":68,"69":69,"70":70,"71":71,"72":72,"73":73,"74":74,"75":75,"76":76,"77":77,"78":78,"79":79,"80":80,"81":81,"82":82,"83":83,"84":84,"85":85,"86":86,"87":87,"88":88,"89":89,"90":90,"91":91,"92":92,"93":93,"94":94,"95":95,"96":96,"97":97,"98":98,"99":99,"100":100,"101":101,"102":102,"103":103,"104":104,"105":105,"106":106,"107":107,"108":108,"109":109,"110":110,"111":111,"112":112,"113":113,"114":114,"115":115,"116":116,"117":117,"118":118,"119":119,"120":120,"121":121,"122":122,"123":123,"124":124,"125":125,"126":126,"160":160,"161":161,"162":162,"163":163,"164":164,"165":165,"166":166,"167":167,"168":168,"169":169,"170":170,"171":171,"172":172,"173":173,"174":174,"175":175,"176":176,"177":177,"178":178,"179":179,"180":180,"181":181,"182":182,"183":183,"184":184,"185":185,"186":186,"187":187,"188":188,"189":189,"190":190,"191":191,"192":192,"193":193,"194":194,"195":195,"196":196,"197":197,"198":198,"199":199,"200":200,"201":201,"202":202,"203":203,"204":204,"205":205,"206":206,"207":207,"208":208,"209":209,"210":210,"211":211,"212":212,"213":213,"214":214,"215":215,"216":216,"217":217,"218":218,"219":219,"220":220,"221":221,"222":222,"223":223,"224":224,"225":225,"226":226,"227":227,"228":228,"229":229,"230":230,"231":231,"232":232,"233":233,"234":234,"235":235,"236":236,"237":237,"238":238,"239":239,"240":240,"241":241,"242":242,"243":243,"244":244,"245":245,"246":246,"247":247,"248":248,"249":249,"250":250,"251":251,"252":252,"253":253,"254":254,"255":255,"256":960,"257":992,"258":451,"259":483,"260":417,"261":433,"262":454,"263":486,"264":710,"265":742,"266":709,"267":741,"268":456,"269":488,"270":463,"271":495,"272":464,"273":496,"274":938,"275":954,"278":972,"279":1004,"280":458,"281":490,"282":460,"283":492,"284":728,"285":760,"286":683,"287":699,"288":725,"289":757,"290":939,"291":955,"292":678,"293":694,"294":673,"295":689,"296":933,"297":949,"298":975,"299":1007,"300":16777516,"301":16777517,"302":967,"303":999,"304":681,"305":697,"308":684,"309":700,"310":979,"311":1011,"312":930,"313":453,"314":485,"315":934,"316":950,"317":421,"318":437,"321":419,"322":435,"323":465,"324":497,"325":977,"326":1009,"327":466,"328":498,"330":957,"331":959,"332":978,"333":1010,"336":469,"337":501,"338":5052,"339":5053,"340":448,"341":480,"342":931,"343":947,"344":472,"345":504,"346":422,"347":438,"348":734,"349":766,"350":426,"351":442,"352":425,"353":441,"354":478,"355":510,"356":427,"357":443,"358":940,"359":956,"360":989,"361":1021,"362":990,"363":1022,"364":733,"365":765,"366":473,"367":505,"368":475,"369":507,"370":985,"371":1017,"372":16777588,"373":16777589,"374":16777590,"375":16777591,"376":5054,"377":428,"378":444,"379":431,"380":447,"381":430,"382":446,"399":16777615,"402":2294,"415":16777631,"416":16777632,"417":16777633,"431":16777647,"432":16777648,"437":16777653,"438":16777654,"439":16777655,"466":16777681,"486":16777702,"487":16777703,"601":16777817,"629":16777845,"658":16777874,"711":439,"728":418,"729":511,"731":434,"733":445,"901":1966,"902":1953,"904":1954,"905":1955,"906":1956,"908":1959,"910":1960,"911":1963,"912":1974,"913":1985,"914":1986,"915":1987,"916":1988,"917":1989,"918":1990,"919":1991,"920":1992,"921":1993,"922":1994,"923":1995,"924":1996,"925":1997,"926":1998,"927":1999,"928":2000,"929":2001,"931":2002,"932":2004,"933":2005,"934":2006,"935":2007,"936":2008,"937":2009,"938":1957,"939":1961,"940":1969,"941":1970,"942":1971,"943":1972,"944":1978,"945":2017,"946":2018,"947":2019,"948":2020,"949":2021,"950":2022,"951":2023,"952":2024,"953":2025,"954":2026,"955":2027,"956":2028,"957":2029,"958":2030,"959":2031,"960":2032,"961":2033,"962":2035,"963":2034,"964":2036,"965":2037,"966":2038,"967":2039,"968":2040,"969":2041,"970":1973,"971":1977,"972":1975,"973":1976,"974":1979,"1025":1715,"1026":1713,"1027":1714,"1028":1716,"1029":1717,"1030":1718,"1031":1719,"1032":1720,"1033":1721,"1034":1722,"1035":1723,"1036":1724,"1038":1726,"1039":1727,"1040":1761,"1041":1762,"1042":1783,"1043":1767,"1044":1764,"1045":1765,"1046":1782,"1047":1786,"1048":1769,"1049":1770,"1050":1771,"1051":1772,"1052":1773,"1053":1774,"1054":1775,"1055":1776,"1056":1778,"1057":1779,"1058":1780,"1059":1781,"1060":1766,"1061":1768,"1062":1763,"1063":1790,"1064":1787,"1065":1789,"1066":1791,"1067":1785,"1068":1784,"1069":1788,"1070":1760,"1071":1777,"1072":1729,"1073":1730,"1074":1751,"1075":1735,"1076":1732,"1077":1733,"1078":1750,"1079":1754,"1080":1737,"1081":1738,"1082":1739,"1083":1740,"1084":1741,"1085":1742,"1086":1743,"1087":1744,"1088":1746,"1089":1747,"1090":1748,"1091":1749,"1092":1734,"1093":1736,"1094":1731,"1095":1758,"1096":1755,"1097":1757,"1098":1759,"1099":1753,"1100":1752,"1101":1756,"1102":1728,"1103":1745,"1105":1699,"1106":1697,"1107":1698,"1108":1700,"1109":1701,"1110":1702,"1111":1703,"1112":1704,"1113":1705,"1114":1706,"1115":1707,"1116":1708,"1118":1710,"1119":1711,"1168":1725,"1169":1709,"1170":16778386,"1171":16778387,"1174":16778390,"1175":16778391,"1178":16778394,"1179":16778395,"1180":16778396,"1181":16778397,"1186":16778402,"1187":16778403,"1198":16778414,"1199":16778415,"1200":16778416,"1201":16778417,"1202":16778418,"1203":16778419,"1206":16778422,"1207":16778423,"1208":16778424,"1209":16778425,"1210":16778426,"1211":16778427,"1240":16778456,"1241":16778457,"1250":16778466,"1251":16778467,"1256":16778472,"1257":16778473,"1262":16778478,"1263":16778479,"1329":16778545,"1330":16778546,"1331":16778547,"1332":16778548,"1333":16778549,"1334":16778550,"1335":16778551,"1336":16778552,"1337":16778553,"1338":16778554,"1339":16778555,"1340":16778556,"1341":16778557,"1342":16778558,"1343":16778559,"1344":16778560,"1345":16778561,"1346":16778562,"1347":16778563,"1348":16778564,"1349":16778565,"1350":16778566,"1351":16778567,"1352":16778568,"1353":16778569,"1354":16778570,"1355":16778571,"1356":16778572,"1357":16778573,"1358":16778574,"1359":16778575,"1360":16778576,"1361":16778577,"1362":16778578,"1363":16778579,"1364":16778580,"1365":16778581,"1366":16778582,"1370":16778586,"1371":16778587,"1372":16778588,"1373":16778589,"1374":16778590,"1377":16778593,"1378":16778594,"1379":16778595,"1380":16778596,"1381":16778597,"1382":16778598,"1383":16778599,"1384":16778600,"1385":16778601,"1386":16778602,"1387":16778603,"1388":16778604,"1389":16778605,"1390":16778606,"1391":16778607,"1392":16778608,"1393":16778609,"1394":16778610,"1395":16778611,"1396":16778612,"1397":16778613,"1398":16778614,"1399":16778615,"1400":16778616,"1401":16778617,"1402":16778618,"1403":16778619,"1404":16778620,"1405":16778621,"1406":16778622,"1407":16778623,"1408":16778624,"1409":16778625,"1410":16778626,"1411":16778627,"1412":16778628,"1413":16778629,"1414":16778630,"1415":16778631,"1417":16778633,"1418":16778634,"1488":3296,"1489":3297,"1490":3298,"1491":3299,"1492":3300,"1493":3301,"1494":3302,"1495":3303,"1496":3304,"1497":3305,"1498":3306,"1499":3307,"1500":3308,"1501":3309,"1502":3310,"1503":3311,"1504":3312,"1505":3313,"1506":3314,"1507":3315,"1508":3316,"1509":3317,"1510":3318,"1511":3319,"1512":3320,"1513":3321,"1514":3322,"1548":1452,"1563":1467,"1567":1471,"1569":1473,"1570":1474,"1571":1475,"1572":1476,"1573":1477,"1574":1478,"1575":1479,"1576":1480,"1577":1481,"1578":1482,"1579":1483,"1580":1484,"1581":1485,"1582":1486,"1583":1487,"1584":1488,"1585":1489,"1586":1490,"1587":1491,"1588":1492,"1589":1493,"1590":1494,"1591":1495,"1592":1496,"1593":1497,"1594":1498,"1600":1504,"1601":1505,"1602":1506,"1603":1507,"1604":1508,"1605":1509,"1606":1510,"1607":1511,"1608":1512,"1609":1513,"1610":1514,"1611":1515,"1612":1516,"1613":1517,"1614":1518,"1615":1519,"1616":1520,"1617":1521,"1618":1522,"1619":16778835,"1620":16778836,"1621":16778837,"1632":16778848,"1633":16778849,"1634":16778850,"1635":16778851,"1636":16778852,"1637":16778853,"1638":16778854,"1639":16778855,"1640":16778856,"1641":16778857,"1642":16778858,"1648":16778864,"1657":16778873,"1662":16778878,"1670":16778886,"1672":16778888,"1681":16778897,"1688":16778904,"1700":16778916,"1705":16778921,"1711":16778927,"1722":16778938,"1726":16778942,"1729":16778945,"1740":16778956,"1746":16778962,"1748":16778964,"1776":16778992,"1777":16778993,"1778":16778994,"1779":16778995,"1780":16778996,"1781":16778997,"1782":16778998,"1783":16778999,"1784":16779000,"1785":16779001,"3458":16780674,"3459":16780675,"3461":16780677,"3462":16780678,"3463":16780679,"3464":16780680,"3465":16780681,"3466":16780682,"3467":16780683,"3468":16780684,"3469":16780685,"3470":16780686,"3471":16780687,"3472":16780688,"3473":16780689,"3474":16780690,"3475":16780691,"3476":16780692,"3477":16780693,"3478":16780694,"3482":16780698,"3483":16780699,"3484":16780700,"3485":16780701,"3486":16780702,"3487":16780703,"3488":16780704,"3489":16780705,"3490":16780706,"3491":16780707,"3492":16780708,"3493":16780709,"3494":16780710,"3495":16780711,"3496":16780712,"3497":16780713,"3498":16780714,"3499":16780715,"3500":16780716,"3501":16780717,"3502":16780718,"3503":16780719,"3504":16780720,"3505":16780721,"3507":16780723,"3508":16780724,"3509":16780725,"3510":16780726,"3511":16780727,"3512":16780728,"3513":16780729,"3514":16780730,"3515":16780731,"3517":16780733,"3520":16780736,"3521":16780737,"3522":16780738,"3523":16780739,"3524":16780740,"3525":16780741,"3526":16780742,"3530":16780746,"3535":16780751,"3536":16780752,"3537":16780753,"3538":16780754,"3539":16780755,"3540":16780756,"3542":16780758,"3544":16780760,"3545":16780761,"3546":16780762,"3547":16780763,"3548":16780764,"3549":16780765,"3550":16780766,"3551":16780767,"3570":16780786,"3571":16780787,"3572":16780788,"3585":3489,"3586":3490,"3587":3491,"3588":3492,"3589":3493,"3590":3494,"3591":3495,"3592":3496,"3593":3497,"3594":3498,"3595":3499,"3596":3500,"3597":3501,"3598":3502,"3599":3503,"3600":3504,"3601":3505,"3602":3506,"3603":3507,"3604":3508,"3605":3509,"3606":3510,"3607":3511,"3608":3512,"3609":3513,"3610":3514,"3611":3515,"3612":3516,"3613":3517,"3614":3518,"3615":3519,"3616":3520,"3617":3521,"3618":3522,"3619":3523,"3620":3524,"3621":3525,"3622":3526,"3623":3527,"3624":3528,"3625":3529,"3626":3530,"3627":3531,"3628":3532,"3629":3533,"3630":3534,"3631":3535,"3632":3536,"3633":3537,"3634":3538,"3635":3539,"3636":3540,"3637":3541,"3638":3542,"3639":3543,"3640":3544,"3641":3545,"3642":3546,"3647":3551,"3648":3552,"3649":3553,"3650":3554,"3651":3555,"3652":3556,"3653":3557,"3654":3558,"3655":3559,"3656":3560,"3657":3561,"3658":3562,"3659":3563,"3660":3564,"3661":3565,"3664":3568,"3665":3569,"3666":3570,"3667":3571,"3668":3572,"3669":3573,"3670":3574,"3671":3575,"3672":3576,"3673":3577,"4304":16781520,"4305":16781521,"4306":16781522,"4307":16781523,"4308":16781524,"4309":16781525,"4310":16781526,"4311":16781527,"4312":16781528,"4313":16781529,"4314":16781530,"4315":16781531,"4316":16781532,"4317":16781533,"4318":16781534,"4319":16781535,"4320":16781536,"4321":16781537,"4322":16781538,"4323":16781539,"4324":16781540,"4325":16781541,"4326":16781542,"4327":16781543,"4328":16781544,"4329":16781545,"4330":16781546,"4331":16781547,"4332":16781548,"4333":16781549,"4334":16781550,"4335":16781551,"4336":16781552,"4337":16781553,"4338":16781554,"4339":16781555,"4340":16781556,"4341":16781557,"4342":16781558,"7682":16784898,"7683":16784899,"7690":16784906,"7691":16784907,"7710":16784926,"7711":16784927,"7734":16784950,"7735":16784951,"7744":16784960,"7745":16784961,"7766":16784982,"7767":16784983,"7776":16784992,"7777":16784993,"7786":16785002,"7787":16785003,"7808":16785024,"7809":16785025,"7810":16785026,"7811":16785027,"7812":16785028,"7813":16785029,"7818":16785034,"7819":16785035,"7840":16785056,"7841":16785057,"7842":16785058,"7843":16785059,"7844":16785060,"7845":16785061,"7846":16785062,"7847":16785063,"7848":16785064,"7849":16785065,"7850":16785066,"7851":16785067,"7852":16785068,"7853":16785069,"7854":16785070,"7855":16785071,"7856":16785072,"7857":16785073,"7858":16785074,"7859":16785075,"7860":16785076,"7861":16785077,"7862":16785078,"7863":16785079,"7864":16785080,"7865":16785081,"7866":16785082,"7867":16785083,"7868":16785084,"7869":16785085,"7870":16785086,"7871":16785087,"7872":16785088,"7873":16785089,"7874":16785090,"7875":16785091,"7876":16785092,"7877":16785093,"7878":16785094,"7879":16785095,"7880":16785096,"7881":16785097,"7882":16785098,"7883":16785099,"7884":16785100,"7885":16785101,"7886":16785102,"7887":16785103,"7888":16785104,"7889":16785105,"7890":16785106,"7891":16785107,"7892":16785108,"7893":16785109,"7894":16785110,"7895":16785111,"7896":16785112,"7897":16785113,"7898":16785114,"7899":16785115,"7900":16785116,"7901":16785117,"7902":16785118,"7903":16785119,"7904":16785120,"7905":16785121,"7906":16785122,"7907":16785123,"7908":16785124,"7909":16785125,"7910":16785126,"7911":16785127,"7912":16785128,"7913":16785129,"7914":16785130,"7915":16785131,"7916":16785132,"7917":16785133,"7918":16785134,"7919":16785135,"7920":16785136,"7921":16785137,"7922":16785138,"7923":16785139,"7924":16785140,"7925":16785141,"7926":16785142,"7927":16785143,"7928":16785144,"7929":16785145,"8194":2722,"8195":2721,"8196":2723,"8197":2724,"8199":2725,"8200":2726,"8201":2727,"8202":2728,"8210":2747,"8211":2730,"8212":2729,"8213":1967,"8215":3295,"8216":2768,"8217":2769,"8218":2813,"8220":2770,"8221":2771,"8222":2814,"8224":2801,"8225":2802,"8226":2790,"8229":2735,"8230":2734,"8240":2773,"8242":2774,"8243":2775,"8248":2812,"8254":1150,"8304":16785520,"8308":16785524,"8309":16785525,"8310":16785526,"8311":16785527,"8312":16785528,"8313":16785529,"8320":16785536,"8321":16785537,"8322":16785538,"8323":16785539,"8324":16785540,"8325":16785541,"8326":16785542,"8327":16785543,"8328":16785544,"8329":16785545,"8352":16785568,"8353":16785569,"8354":16785570,"8355":16785571,"8356":16785572,"8357":16785573,"8358":16785574,"8359":16785575,"8360":16785576,"8361":3839,"8362":16785578,"8363":16785579,"8364":8364,"8453":2744,"8470":1712,"8471":2811,"8478":2772,"8482":2761,"8531":2736,"8532":2737,"8533":2738,"8534":2739,"8535":2740,"8536":2741,"8537":2742,"8538":2743,"8539":2755,"8540":2756,"8541":2757,"8542":2758,"8592":2299,"8593":2300,"8594":2301,"8595":2302,"8658":2254,"8660":2253,"8706":2287,"8709":16785925,"8711":2245,"8712":16785928,"8713":16785929,"8715":16785931,"8728":3018,"8730":2262,"8731":16785947,"8732":16785948,"8733":2241,"8734":2242,"8743":2270,"8744":2271,"8745":2268,"8746":2269,"8747":2239,"8748":16785964,"8749":16785965,"8756":2240,"8757":16785973,"8764":2248,"8771":2249,"8773":16785992,"8775":16785991,"8800":2237,"8801":2255,"8802":16786018,"8803":16786019,"8804":2236,"8805":2238,"8834":2266,"8835":2267,"8866":3068,"8867":3036,"8868":3010,"8869":3022,"8968":3027,"8970":3012,"8981":2810,"8992":2212,"8993":2213,"9109":3020,"9115":2219,"9117":2220,"9118":2221,"9120":2222,"9121":2215,"9123":2216,"9124":2217,"9126":2218,"9128":2223,"9132":2224,"9143":2209,"9146":2543,"9147":2544,"9148":2546,"9149":2547,"9225":2530,"9226":2533,"9227":2537,"9228":2531,"9229":2532,"9251":2732,"9252":2536,"9472":2211,"9474":2214,"9484":2210,"9488":2539,"9492":2541,"9496":2538,"9500":2548,"9508":2549,"9516":2551,"9524":2550,"9532":2542,"9618":2529,"9642":2791,"9643":2785,"9644":2779,"9645":2786,"9646":2783,"9647":2767,"9650":2792,"9651":2787,"9654":2781,"9655":2765,"9660":2793,"9661":2788,"9664":2780,"9665":2764,"9670":2528,"9675":2766,"9679":2782,"9702":2784,"9734":2789,"9742":2809,"9747":2762,"9756":2794,"9758":2795,"9792":2808,"9794":2807,"9827":2796,"9829":2798,"9830":2797,"9837":2806,"9839":2805,"10003":2803,"10007":2804,"10013":2777,"10016":2800,"10216":2748,"10217":2750,"10240":16787456,"10241":16787457,"10242":16787458,"10243":16787459,"10244":16787460,"10245":16787461,"10246":16787462,"10247":16787463,"10248":16787464,"10249":16787465,"10250":16787466,"10251":16787467,"10252":16787468,"10253":16787469,"10254":16787470,"10255":16787471,"10256":16787472,"10257":16787473,"10258":16787474,"10259":16787475,"10260":16787476,"10261":16787477,"10262":16787478,"10263":16787479,"10264":16787480,"10265":16787481,"10266":16787482,"10267":16787483,"10268":16787484,"10269":16787485,"10270":16787486,"10271":16787487,"10272":16787488,"10273":16787489,"10274":16787490,"10275":16787491,"10276":16787492,"10277":16787493,"10278":16787494,"10279":16787495,"10280":16787496,"10281":16787497,"10282":16787498,"10283":16787499,"10284":16787500,"10285":16787501,"10286":16787502,"10287":16787503,"10288":16787504,"10289":16787505,"10290":16787506,"10291":16787507,"10292":16787508,"10293":16787509,"10294":16787510,"10295":16787511,"10296":16787512,"10297":16787513,"10298":16787514,"10299":16787515,"10300":16787516,"10301":16787517,"10302":16787518,"10303":16787519,"10304":16787520,"10305":16787521,"10306":16787522,"10307":16787523,"10308":16787524,"10309":16787525,"10310":16787526,"10311":16787527,"10312":16787528,"10313":16787529,"10314":16787530,"10315":16787531,"10316":16787532,"10317":16787533,"10318":16787534,"10319":16787535,"10320":16787536,"10321":16787537,"10322":16787538,"10323":16787539,"10324":16787540,"10325":16787541,"10326":16787542,"10327":16787543,"10328":16787544,"10329":16787545,"10330":16787546,"10331":16787547,"10332":16787548,"10333":16787549,"10334":16787550,"10335":16787551,"10336":16787552,"10337":16787553,"10338":16787554,"10339":16787555,"10340":16787556,"10341":16787557,"10342":16787558,"10343":16787559,"10344":16787560,"10345":16787561,"10346":16787562,"10347":16787563,"10348":16787564,"10349":16787565,"10350":16787566,"10351":16787567,"10352":16787568,"10353":16787569,"10354":16787570,"10355":16787571,"10356":16787572,"10357":16787573,"10358":16787574,"10359":16787575,"10360":16787576,"10361":16787577,"10362":16787578,"10363":16787579,"10364":16787580,"10365":16787581,"10366":16787582,"10367":16787583,"10368":16787584,"10369":16787585,"10370":16787586,"10371":16787587,"10372":16787588,"10373":16787589,"10374":16787590,"10375":16787591,"10376":16787592,"10377":16787593,"10378":16787594,"10379":16787595,"10380":16787596,"10381":16787597,"10382":16787598,"10383":16787599,"10384":16787600,"10385":16787601,"10386":16787602,"10387":16787603,"10388":16787604,"10389":16787605,"10390":16787606,"10391":16787607,"10392":16787608,"10393":16787609,"10394":16787610,"10395":16787611,"10396":16787612,"10397":16787613,"10398":16787614,"10399":16787615,"10400":16787616,"10401":16787617,"10402":16787618,"10403":16787619,"10404":16787620,"10405":16787621,"10406":16787622,"10407":16787623,"10408":16787624,"10409":16787625,"10410":16787626,"10411":16787627,"10412":16787628,"10413":16787629,"10414":16787630,"10415":16787631,"10416":16787632,"10417":16787633,"10418":16787634,"10419":16787635,"10420":16787636,"10421":16787637,"10422":16787638,"10423":16787639,"10424":16787640,"10425":16787641,"10426":16787642,"10427":16787643,"10428":16787644,"10429":16787645,"10430":16787646,"10431":16787647,"10432":16787648,"10433":16787649,"10434":16787650,"10435":16787651,"10436":16787652,"10437":16787653,"10438":16787654,"10439":16787655,"10440":16787656,"10441":16787657,"10442":16787658,"10443":16787659,"10444":16787660,"10445":16787661,"10446":16787662,"10447":16787663,"10448":16787664,"10449":16787665,"10450":16787666,"10451":16787667,"10452":16787668,"10453":16787669,"10454":16787670,"10455":16787671,"10456":16787672,"10457":16787673,"10458":16787674,"10459":16787675,"10460":16787676,"10461":16787677,"10462":16787678,"10463":16787679,"10464":16787680,"10465":16787681,"10466":16787682,"10467":16787683,"10468":16787684,"10469":16787685,"10470":16787686,"10471":16787687,"10472":16787688,"10473":16787689,"10474":16787690,"10475":16787691,"10476":16787692,"10477":16787693,"10478":16787694,"10479":16787695,"10480":16787696,"10481":16787697,"10482":16787698,"10483":16787699,"10484":16787700,"10485":16787701,"10486":16787702,"10487":16787703,"10488":16787704,"10489":16787705,"10490":16787706,"10491":16787707,"10492":16787708,"10493":16787709,"10494":16787710,"10495":16787711,"12289":1188,"12290":1185,"12300":1186,"12301":1187,"12443":1246,"12444":1247,"12449":1191,"12450":1201,"12451":1192,"12452":1202,"12453":1193,"12454":1203,"12455":1194,"12456":1204,"12457":1195,"12458":1205,"12459":1206,"12461":1207,"12463":1208,"12465":1209,"12467":1210,"12469":1211,"12471":1212,"12473":1213,"12475":1214,"12477":1215,"12479":1216,"12481":1217,"12483":1199,"12484":1218,"12486":1219,"12488":1220,"12490":1221,"12491":1222,"12492":1223,"12493":1224,"12494":1225,"12495":1226,"12498":1227,"12501":1228,"12504":1229,"12507":1230,"12510":1231,"12511":1232,"12512":1233,"12513":1234,"12514":1235,"12515":1196,"12516":1236,"12517":1197,"12518":1237,"12519":1198,"12520":1238,"12521":1239,"12522":1240,"12523":1241,"12524":1242,"12525":1243,"12527":1244,"12530":1190,"12531":1245,"12539":1189,"12540":1200};

    function lookup(k) { return k ? {keysym: k, keyname: keynames ? keynames[k] : k} : undefined; }
    return {
        fromUnicode : function(u) { return lookup(codepoints[u]); },
        lookup : lookup
    };
})();
