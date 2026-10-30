from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
import webbrowser

root = Path(__file__).resolve().parent
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
server = None
for port in range(8767, 8787):
    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), handler)
        break
    except OSError:
        continue
if server is None:
    raise SystemExit('No free local port between 8767 and 8786.')
url = 'http://127.0.0.1:' + str(server.server_port) + '/'
print('Dragon Flight: ' + url)
print('Keep this window open. Press Ctrl+C to stop.')
Timer(1, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
