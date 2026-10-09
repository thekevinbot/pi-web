"""Minimal study backend: an OpenAI-compatible model that plays a scripted session.

Pi treats this as its model. The script (session.json) is a tree of nodes; a node says
something and may end in a checkpoint, which becomes Laith's `offer_options` tool call.
Each option names the node it leads to.

Stateless: every request carries the full conversation, so the server replays it to find
the current node. A user message after a checkpoint is matched to an option by label or
id (`/pick` sends the label). Anything else is free text: logged, then redirected to the
checkpoint's `redirect` option.
"""

import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).parent
SCRIPT = json.loads(Path(os.environ.get("STUDY_SCRIPT", HERE / "session.json")).read_text())
FREE_TEXT_LOG = os.environ.get("STUDY_FREE_TEXT_LOG")
CHARS_PER_SEC = int(os.environ.get("STUB_CHARS_PER_SEC", 600))
PORT = int(os.environ.get("STUB_PORT", 4011))


def text_of(message):
    content = message.get("content") or ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if part.get("type") == "text")
    return content.strip()


def offered(message):
    return any(c["function"]["name"] == "offer_options" for c in message.get("tool_calls") or [])


def answer(node_id, text, latest):
    checkpoint = SCRIPT["nodes"][node_id]["checkpoint"]
    for option in checkpoint["options"]:
        if text in (option["label"], option["id"]):
            return option["next"]
    redirect = next(o for o in checkpoint["options"] if o["id"] == checkpoint["redirect"])
    if latest and FREE_TEXT_LOG:
        with open(FREE_TEXT_LOG, "a") as log:
            log.write(json.dumps({"at": time.time(), "node": node_id, "text": text, "redirect": redirect["id"]}) + "\n")
    return redirect["next"]


def current_node(messages):
    node_id, waiting = SCRIPT["start"], False
    for i, message in enumerate(messages):
        if message.get("role") == "assistant" and offered(message):
            waiting = True
        elif message.get("role") == "user" and waiting:
            node_id, waiting = answer(node_id, text_of(message), i == len(messages) - 1), False
    return node_id


def offer_options(checkpoint):
    args = {"question": checkpoint["question"], "options": [{"id": o["id"], "label": o["label"]} for o in checkpoint["options"]]}
    return {"name": "offer_options", "arguments": json.dumps(args)}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        messages = body.get("messages") or []
        if not body.get("tools"):
            return self.stream("Study session", [])
        if messages and messages[-1].get("role") == "tool":
            # Laith's offer_options result tells the model to say this, then stop.
            return self.stream("Pick one with /pick", [])
        node = SCRIPT["nodes"][current_node(messages)]
        calls = [offer_options(node["checkpoint"])] if "checkpoint" in node else []
        self.stream(node["say"], calls)

    def chunk(self, data):
        payload = f"data: {data if isinstance(data, str) else json.dumps(data)}\n\n".encode()
        self.wfile.write(f"{len(payload):x}\r\n".encode() + payload + b"\r\n")
        self.wfile.flush()

    def stream(self, text, calls):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        base = {"id": f"chatcmpl-{uuid.uuid4().hex[:24]}", "object": "chat.completion.chunk", "created": int(time.time()), "model": "study"}

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
