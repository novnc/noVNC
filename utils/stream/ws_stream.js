'use strict';

document.addEventListener('oncreateroom', function(){
    // Creo WS de stream
    streamws = new WebSocket(
        'ws://' +
        '127.0.0.1:8000' +
        '/ws/stream/' +
        room_name +
        '/'
    );
    console.log('[NOVNC] WebSocket streamws creado');
    // Handler streamws
    streamws.onmessage = function(e){
        let message_data = JSON.parse(e.data);
        console.log('[NOVNC] streamws: ', message_data);
        if(message_data['type'] == 'checkusers'){
            if(message_data['users']){
                console.log('[NOVNC] usuarios correctos');
                users = true;
                startLocalStream();
            }else{
                console.log('[NOVNC] usuarios incorrectos');
                users = false;
            }
        }else if(message_data['type'] == 'candidate'){
            console.log('[NOVNC] Candidate received');
            addIceCandidate(message_data['candidate']);
        }else if(message_data['type'] == 'offer'){
            console.log('[NOVNC] Offer received');
            startRemoteStream(message_data['offer']);
        }else if(message_data['type'] == 'answer'){
            console.log('[NOVNC] Answer received');
            setAnswerDescription(message_data['answer']);
        }else if(message_data['type'] == 'denied'){
            console.log('[NOVNC] Denied connection');
            window.location.pathname = '/';
        }
    }
});