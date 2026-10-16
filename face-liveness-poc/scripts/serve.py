#!/usr/bin/env python3
"""Server tĩnh nhỏ cho POC (chỉ để phát triển/kiểm thử; không phải backend, không xử lý dữ liệu).

  python3 scripts/serve.py                      # http://localhost:8000  (localhost được coi là secure context)
  python3 scripts/serve.py --https cert.pem key.pem --port 8443 --host 0.0.0.0
                                                # HTTPS để thử trên điện thoại qua mạng LAN
"""
import argparse
import functools
import http.server
import mimetypes
import os
import ssl

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".task")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # tránh cache khi đang chỉnh ngưỡng
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--https", nargs=2, metavar=("CERT", "KEY"), help="đường dẫn cert.pem key.pem")
    args = ap.parse_args()

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    handler = functools.partial(NoCacheHandler, directory=root)
    httpd = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    scheme = "http"
    if args.https:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(args.https[0], args.https[1])
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"
    print(f"Phục vụ {root}\n→ {scheme}://{args.host}:{args.port}/   (Ctrl+C để dừng)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
