Dragon Flight
Packaged October 28, 2026

START ON WINDOWS
1. Extract the entire ZIP. Do not launch files from inside the ZIP viewer.
2. Install Python 3 if it is not already available.
3. Double-click START-GAME.bat.
4. Your browser opens automatically. Keep the server window open while playing.
5. To stop the server, press Ctrl+C in its window.
The launcher selects a free local port between 8767 and 8786.

MAC OR LINUX
Open a terminal in this folder and run: python3 serve-game.py

GAME CONTROLS
Space/Enter or click: start/restart, followed by a 3-second countdown.
WASD/arrow keys or mouse movement: steer.
Play fullscreen: hide settings and enlarge the game. Esc exits fullscreen.
Survive 60 seconds to reach home. White sheep award 50 points. One randomly
selected sheep among the five scheduled appearances is black and awards 200.
A round ending early may end before the scheduled black sheep appears.

MOTION TRACKER
Normal mouse/keyboard play requires no tracking equipment.
For hardware input, the device data server must already be running.
Enable Motion tracker, configure its WebSocket URL and movement half-ranges,
then click Connect. Start only after Tracking appears. XY origin is captured
at the end of the preparation countdown. See TRACKER-SETUP.txt for details.
Hardware drivers, device SDKs, and the separate tracker source archive are not included.

OPTIONAL SIMULATOR
Requires Node.js. In a second terminal in this folder run:
node motion-simulator.cjs
Open http://127.0.0.1:8080/ and start automatic movement. In the game connect
to ws://127.0.0.1:8080. This is simulated input, not a physical tracker.

CONTENTS
Editable game sources, all referenced images, local p5.js 2.3.4 and sound
library, motion-input adapter, simulator, startup helper, and setup notes.
The packaged index uses the included libraries instead of downloading them
from a CDN. No npm installation or build step is required.

LATEST GAMEPLAY UPDATE
Sheep throws last a randomized 1.5-2.5 seconds, with 2-3 rotations.
Throw styles include cross-screen, diagonal and fully in-screen vertical arcs.
Paths are selected to avoid the player's current position; a short pickup grace
period prevents instant collection on launch. White sheep award 50 points;
one randomly selected scheduled sheep per round is black and awards 200.
Rock difficulty increases through approach speed, wave spacing and formations.
Precision-targeted waves are scheduled every 3-4 waves, subject to route checks.
After the round timer reaches zero, new rocks stop spawning. The player must
clear the remaining rocks before the return-home animation begins. The ocean
stops moving when the return-home animation starts.
