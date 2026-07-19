#!/usr/bin/env python3
"""Tiny local Resend mock for the edge-function test harness.

The edge functions send transactional email via the Resend HTTP API
(`_shared/email.ts`, POST to RESEND_API_URL). In tests we must never hit the
real Resend endpoint with live creds (dunning emails to lanef-*@example.com
would really go out and bounce). Instead the harness serves the functions with
RESEND_API_URL pointed at THIS mock, so email sending is *exercised and
assertable* rather than merely disabled.

Behaviour:
  * Binds 0.0.0.0:<port> (default 8384) so the Supabase edge-runtime container
    can reach it via host.docker.internal.
  * POST /emails (any path) -> 200 {"id":"mock-<n>"} and appends the raw request
    body (the JSON the function POSTed: {from,to,subject,html}) as ONE JSON line
    to the capture file. Tests read that file to assert what was sent.
  * GET /  (any path)       -> 200 {"ok":true}   (readiness probe).

Usage:  resend_mock.py <port> <capture-file>
No third-party deps — stdlib http.server only.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8384
CAPTURE = sys.argv[2] if len(sys.argv) > 2 else "/tmp/resend-mock-capture.jsonl"

_counter = {"n": 0}


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._reply(200, {"ok": True})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        # Append the raw request body verbatim as one line. It is already the
        # JSON payload the function sent; keep it exact so tests can match on
        # recipient/subject without re-encoding surprises.
        try:
            line = raw.decode("utf-8", "replace")
        except Exception:
            line = ""
        line = line.replace("\n", " ").replace("\r", " ")
        with open(CAPTURE, "a") as fh:
            fh.write(line + "\n")
        _counter["n"] += 1
        self._reply(200, {"id": "mock-%d" % _counter["n"]})

    # Silence per-request logging to keep serve logs clean.
    def log_message(self, *_args):
        pass


def main():
    # Truncate/create the capture file at startup so each run is clean.
    open(CAPTURE, "w").close()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
