"""Dev-only stand-in for the replay backend, so the UI has something to talk to.

OpenAI-compatible chat completions over SSE. Emits Laith's `offer_options` tool call
(question plus options with ids) and follows his tool result's instruction to reply
"Pick one with /pick". Not the real backend: that is Laith's.
"""

import json
import os
import random
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHARS_PER_SEC = int(os.environ.get("STUB_CHARS_PER_SEC", 600))
PORT = int(os.environ.get("STUB_PORT", 4011))

WORDS = """the agent email form handler test branch validation signup input regex domain retry cache
schema migration user session token config error edge case fixture diff patch commit build log
should could maybe first then because instead check run read write update remove keep""".split()

OPTIONS = [
    ("tighten-regex", "Tighten the email regex and add tests for the edge cases it currently accepts"),
    ("use-library", "Replace the hand-written regex with a maintained validation library"),
    ("ask-maintainer", "Stop and ask the maintainer which addresses must be accepted before changing anything"),
    ("ship-as-is", "Leave validation as it is and move on to the retry bug"),
]


def sentence(lo=5, hi=20):
    return " ".join(random.choices(WORDS, k=random.randint(lo, hi))).capitalize() + "."


def body_text(opening):
    blocks = [
        " ".join(sentence() for _ in range(random.randint(2, 5))),
        "```diff\n" + "\n".join(random.choice("+- ") + sentence(3, 8) for _ in range(6)) + "\n```",
        "- " + "\n- ".join(sentence() for _ in range(3)),
    ]
    head = "## Where we are\n\n" if opening else ""
    return head + "\n\n".join(blocks)


def offer_options():
    options = random.sample(OPTIONS, random.choice([2, 3, 4]))
    args = {"question": "How should we handle email validation?", "options": [{"id": i, "label": l} for i, l in options]}
    return {"name": "offer_options", "arguments": json.dumps(args)}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        msgs = body.get("messages") or []
        if not body.get("tools"):
            return self.stream(sentence(2, 5), [])
        last = msgs[-1] if msgs else {}
        if last.get("role") == "tool":
            return self.stream("Pick one with /pick", [])
        opening = not any(m.get("role") == "assistant" for m in msgs)
        self.stream(body_text(opening), [offer_options()])

    def chunk(self, data):
        payload = f"data: {data if isinstance(data, str) else json.dumps(data)}\n\n".encode()
        self.wfile.write(f"{len(payload):x}\r\n".encode() + payload + b"\r\n")
        self.wfile.flush()

    def stream(self, text, calls):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        base = {"id": f"chatcmpl-{uuid.uuid4().hex[:24]}", "object": "chat.completion.chunk", "created": int(time.time()), "model": "stub"}

        def delta(d, finish=None):
            self.chunk({**base, "choices": [{"index": 0, "delta": d, "finish_reason": finish}]})

        delta({"role": "assistant", "content": ""})
        for i in range(0, len(text), 8):
            delta({"content": text[i : i + 8]})
            time.sleep(8 / CHARS_PER_SEC)
        for i, fn in enumerate(calls):
            delta({"tool_calls": [{"index": i, "id": f"call_{uuid.uuid4().hex[:24]}", "type": "function", "function": {"name": fn["name"], "arguments": ""}}]})
            args = fn["arguments"]
            for j in range(0, len(args), 16):
                delta({"tool_calls": [{"index": i, "function": {"arguments": args[j : j + 16]}}]})
                time.sleep(16 / CHARS_PER_SEC)
        delta({}, "tool_calls" if calls else "stop")
        self.chunk("[DONE]")
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
