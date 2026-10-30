// Local-only simulated tracker. No hardware or SDK is required.
const http = require('http');
const crypto = require('crypto');
const clients = new Set();
let position = { x: 100, y: 200, z: 300 };
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Motion Tracker Simulator</title><style>
body{font:16px Arial;background:#102c3b;color:#eef7fa;max-width:760px;margin:30px auto;padding:20px}
#pad{height:360px;background:#236382;border:2px solid #8bdcec;position:relative;touch-action:none;cursor:crosshair}
#dot{position:absolute;width:20px;height:20px;border-radius:50%;background:#a5ff94;transform:translate(-50%,-50%);pointer-events:none}
button,a{padding:10px;display:inline-block}a{color:#a5ff94}output{display:block;margin:16px 0}input{width:90px}
</style><h1>Motion Tracker Simulator</h1>
<p>This sends simulated XYZ data, not real sensor data.</p>
<p>In the game, enable Motion tracker and connect to <b>ws://127.0.0.1:8080</b>.
Use X/Y half-ranges of 20. Leave Prop ID blank. Click Start after connecting.</p>
<a href="http://127.0.0.1:8765/" target="_blank">Open Dragon Flight</a>
<p>Drag inside the pad to move the simulated prop. The game captures your current
position only when you start or restart. Switching windows pauses the game;
click Resume when you return.</p>
<div id="pad"><div id="dot"></div></div><output id="readout"></output>
<label>Z <input id="z" type="number" value="300"></label>
<button id="reset">Reset simulated position</button>
<button id="stream">Pause data stream</button>
<button id="demo">Start automatic movement</button>
<p>For continuous gameplay, start automatic movement and return to the game.
The position moves in a slow loop; press Start in the game to capture its current position.</p>
<p>Change Z to verify it does not move the dragon. Pause the data stream to test
the timeout. Restore the stream, then explicitly resume the game.</p>
<script>
let x=100,y=200,z=300,streaming=true,automatic=false,started=0;
const pad=document.getElementById('pad'),dot=document.getElementById('dot');
function render(){dot.style.left=((x-60)/80*100)+'%';dot.style.top=((240-y)/80*100)+'%';
document.getElementById('readout').textContent='X: '+x.toFixed(2)+'  Y: '+y.toFixed(2)+'  Z: '+z;}
function move(e){const r=pad.getBoundingClientRect();x=60+80*Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
y=240-80*Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));automatic=false;render();}
pad.onpointerdown=e=>{pad.setPointerCapture(e.pointerId);move(e)};
pad.onpointermove=e=>{if(pad.hasPointerCapture(e.pointerId))move(e)};
document.getElementById('z').oninput=e=>{const v=Number(e.target.value);if(Number.isFinite(v))z=v;render()};
document.getElementById('reset').onclick=()=>{x=100;y=200;render()};
document.getElementById('stream').onclick=e=>{streaming=!streaming;e.target.textContent=streaming?'Pause data stream':'Restore data stream';};
document.getElementById('demo').onclick=e=>{automatic=!automatic;started=performance.now();e.target.textContent=automatic?'Stop automatic movement':'Start automatic movement';};
let sending=false;
setInterval(async()=>{if(automatic){const t=(performance.now()-started)/4000;x=100+12*Math.sin(t);y=200+12*Math.cos(t);render();}
if(!streaming||sending)return;sending=true;try{await fetch('/position?x='+x+'&y='+y+'&z='+z)}finally{sending=false}},33);
render();
</script></html>`;
let lastUpdate = 0;
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8080');
  res.setHeader('Cache-Control','no-store');
  if (url.pathname === '/position') {
    const next = Object.fromEntries(['x','y','z'].map(key => [key,Number(url.searchParams.get(key))]));
    if (!Object.values(next).every(Number.isFinite)) {res.writeHead(400);return res.end();}
    position = next;
    lastUpdate = Date.now();
    res.writeHead(204);return res.end();
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});
server.on('upgrade',(req,socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  clients.add(socket);
  socket.on('error',()=>clients.delete(socket));
  socket.on('close',()=>clients.delete(socket));
  socket.on('data',data=>{if((data[0]&15)===8){clients.delete(socket);socket.end(Buffer.from([0x88,0]));}});
});
setInterval(()=>{
  // Stop broadcasting if the simulator UI stops posting positions.
  if(Date.now()-lastUpdate>300)return;
  const body = Buffer.from(JSON.stringify({props:[{id:1,pos:position}]}));
  const header=Buffer.alloc(body.length<126?2:4);header[0]=0x81;
  if(body.length<126)header[1]=body.length;else{header[1]=126;header.writeUInt16BE(body.length,2);}
  for(const socket of clients)if(!socket.destroyed&&socket.writableLength<65536)socket.write(Buffer.concat([header,body]));
},33);
server.listen(8080,'127.0.0.1',()=>console.log('Simulated tracker: http://127.0.0.1:8080/'));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
