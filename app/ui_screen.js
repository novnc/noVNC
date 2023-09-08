



const UI = {
    connected: false,

    //Initial Loading of the UI
    prime() {

    },

    //Render default UI
    start() {
        window.addEventListener("beforeunload", (e) => { 
            if (UI.rfb) { 
                UI.disconnect(); 
            } 
        });


        UI.addDefaultHandlers();
    },

    addDefaultHandlers() {
        document.getElementById('noVNC_connect_button', UI.connect);
    },

    connect() {
        
    },

    disconnect() {

    }
}

UI.prime();

export default UI;