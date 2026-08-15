import http.server
import socketserver
import functools

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

handler = functools.partial(NoCacheHandler, directory='.')
with socketserver.TCPServer(('127.0.0.1', 5500), handler) as httpd:
    print('Serving frontend on http://127.0.0.1:5500 with no-store caching', flush=True)
    httpd.serve_forever()