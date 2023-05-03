const  lib = require('dht-universal/setup-relay.js');


(async ()=>{

    const { port, closeRelay } = await lib.setupRelay();
    console.log(port)
})();
