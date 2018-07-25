const WIDTH = 1024
const HEIGHT = 768

import('./novnc')
    .then(wasm => {
        const canvas = document.getElementById('target')
        const ctx = canvas.getContext('2d')

        canvas.addEventListener('click', () => {
            const startMs = (new Date()).getTime()
            wasm.draw(ctx, WIDTH, HEIGHT,
                    parseInt(Math.random()*256),
                    parseInt(Math.random()*256),
                    parseInt(Math.random()*256))
            console.log("elapsed:", (new Date()).getTime() - startMs)
        });
        wasm.draw(ctx, WIDTH, HEIGHT, 50, 150, 150)
    })
