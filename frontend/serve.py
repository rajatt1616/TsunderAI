import http.server
import socketserver
import functools
import os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

PORT = int(os.environ.get('PORT', 5500))
handler = functools.partial(NoCacheHandler, directory='.')

with socketserver.TCPServer(('0.0.0.0', PORT), handler) as httpd:
    print(f'Serving frontend on http://0.0.0.0:{PORT} with no-store caching', flush=True)
    httpd.serve_forever()