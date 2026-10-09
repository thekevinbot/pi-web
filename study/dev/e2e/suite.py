"""Adversarial e2e for the option card. Usage: suite.py <landing-url> <browser> [case,case]"""
import json, sys, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

LANDING, BROWSER = sys.argv[1:3]
ONLY = sys.argv[3].split(",") if len(sys.argv) > 3 else None
_u = urllib.parse.urlsplit(LANDING)
BASE = f"{_u.scheme}://{_u.netloc}"
_q = urllib.parse.parse_qs(_u.query)
PROJECT, WS = _q["project"][0], _q["workspace"][0]
API = BASE + "/api"
results = []


def post(path, body):
    req = urllib.request.Request(API + path, json.dumps(body).encode(), {"content-type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read() or b"{}")


def get(path):
    return json.loads(urllib.request.urlopen(API + path).read())


CWD = next(p["path"] for p in get("/projects") if p["id"] == PROJECT)


def new_session():
    s = post("/sessions", {"cwd": CWD})
    post(f"/machines/local/sessions/{s['id']}/prompt", {"cwd": CWD, "text": "Continue the task."})
    return s["id"], s["path"]


def url(sid):
    return f"{BASE}/?project={PROJECT}&workspace={WS}&session={sid}&view=chat"


def entries(path):
    try:
        return [json.loads(l) for l in open(path) if l.strip()]
    except FileNotFoundError:
        return []


def offers(path):
    out = []
    for e in entries(path):
        for c in (e.get("message", {}).get("content") or []) if isinstance(e.get("message", {}).get("content"), list) else []:
            if c.get("type") == "toolCall" and c.get("name") == "offer_options":
                out.append(c["arguments"])
    return out


def selections(path):
    return [e.get("details", {}).get("id") for e in entries(path) if e.get("type") == "custom_message" and e.get("customType") == "option_selection"]


def ready(path, n, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        es = entries(path)
        msgs = [e["message"] for e in es if e.get("type") == "message"]
        if len(offers(path)) >= n and msgs and msgs[-1].get("role") == "assistant" and "Pick one" in json.dumps(msgs[-1].get("content")):
            return True
        time.sleep(0.3)
    raise AssertionError(f"session not ready for offer {n}")


def enabled(page):
    return page.locator("checkpoint-card button:not([disabled])")


def card_ids(page, idx=-1):
    cards = page.locator("checkpoint-card")
    c = cards.nth(cards.count() - 1 if idx == -1 else idx)
    bs = c.locator("button")
    return [bs.nth(i).get_attribute("data-option-id") for i in range(bs.count())]


def records(page):
    return page.locator("checkpoint-record").evaluate_all("els => els.map(e => e.shadowRoot.textContent.replace(/\\s+/g, ' ').trim())")


def label(path, n, oid):
    return next(o["label"] for o in offers(path)[n]["options"] if o["id"] == oid)


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def wait_for(fn, msg, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if fn():
            return
        time.sleep(0.25)
    raise AssertionError(msg)


def hygiene(page):
    body = page.locator("chat-view").inner_text()
    expect("Pick one with /pick" not in body, "'Pick one with /pick' visible")
    expect("offer_options" not in body, "raw offer_options visible")
    expect(page.locator("extension-dialog-card").count() == 0, "extension dialog shown")
    expect(page.locator("app-navigation-panel").count() == 0, "navigation panel rendered")


def t_first_card(page, sid, path):
    page.goto(url(sid)); ready(path, 1)
    wait_for(lambda: enabled(page).count() > 0, "no enabled card")
    expect(sorted(card_ids(page)) == sorted(o["id"] for o in offers(path)[0]["options"]), "card options != offered options")
    expect(page.locator("prompt-editor").count() == 0, "composer shown alongside the card")
    expect(page.locator("chat-view checkpoint-card").count() == 0, "card rendered inside the transcript")
    hygiene(page)


def t_click_records(page, sid, path):
    page.goto(url(sid)); ready(path, 1)
    wait_for(lambda: enabled(page).count() > 0, "no enabled card")
    pick = enabled(page).first.get_attribute("data-option-id")
    enabled(page).first.click()
    ready(path, 2)
    expect(selections(path) == [pick], f"selections {selections(path)} != [{pick}]")
    want = f"Chose: {label(path, 0, pick)}"
    wait_for(lambda: len(records(page)) == 1 and want in records(page)[0], f"record missing, got {records(page)}")
    wait_for(lambda: sorted(card_ids(page)) == sorted(o["id"] for o in offers(path)[1]["options"]) and enabled(page).count() > 0, "second card not docked")
    hygiene(page)


def t_double_click(page, sid, path):
    page.goto(url(sid)); ready(path, 1)
    wait_for(lambda: enabled(page).count() > 1, "need 2 options")
    a, b = enabled(page).nth(0), enabled(page).nth(1)
    a.dblclick()
    try:
        b.click(timeout=500, force=True)
    except Exception:
        pass
    ready(path, 2)
    time.sleep(2)
    expect(len(selections(path)) == 1, f"expected one selection, got {selections(path)}")


def t_reload_persists(page, sid, path):
    page.goto(url(sid)); ready(path, 1)
    wait_for(lambda: enabled(page).count() > 0, "no enabled card")
    order = card_ids(page)
    page.reload(); wait_for(lambda: enabled(page).count() > 0, "no card after reload")
    expect(card_ids(page) == order, f"order changed on reload {order} -> {card_ids(page)}")
    pick = enabled(page).first.get_attribute("data-option-id")
    enabled(page).first.click(); ready(path, 2)
    page.reload()
    want = f"Chose: {label(path, 0, pick)}"
    wait_for(lambda: len(records(page)) == 1 and want in records(page)[0], f"choice lost on reload: {records(page)}")
    wait_for(lambda: enabled(page).count() > 0, "second card missing after reload")
    hygiene(page)


def t_mid_stream(page, sid, path):
    page.goto(url(sid))
    seen = []
    end = time.time() + 40
    while time.time() < end and not (len(offers(path)) >= 1 and "Pick one" in json.dumps(entries(path)[-1])):
        n = enabled(page).count()
        if n:
            seen.append(n)
        time.sleep(0.1)
    ready(path, 1)
    final = len(offers(path)[0]["options"])
    early = [n for n in seen if n != final]
    expect(not early, f"clickable card with partial options during stream: counts {sorted(set(seen))}, final {final}")


def t_click_while_streaming(page, sid, path):
    page.goto(url(sid))
    wait_for(lambda: enabled(page).count() > 0, "no card", 40)
    if "Pick one" in json.dumps(entries(path)[-1]):
        return "card only enabled after turn ended (ok)"
    enabled(page).first.click()
    ready(path, 1); time.sleep(4)
    expect(len(selections(path)) == 1, f"click during stream lost: selections {selections(path)}")


def t_free_text(page, sid, path):
    page.goto(url(sid)); ready(path, 1)
    wait_for(lambda: enabled(page).count() > 0, "no card")
    expect(page.locator("prompt-editor").count() == 0, "composer shown alongside the card")
    page.get_by_label("Other").fill("Actually, can you explain the options first?")
    page.keyboard.press("Enter")
    ready(path, 2)
    wait_for(lambda: len(records(page)) == 1 and records(page)[0] and "Chose:" not in records(page)[0], f"bypassed record wrong: {records(page)}")
    wait_for(lambda: enabled(page).count() > 0, "second card not docked after free text")
    expect(selections(path) == [], f"free text recorded a selection: {selections(path)}")


def t_two_tabs(page, sid, path):
    page.goto(url(sid)); ready(path, 1)
    other = page.context.new_page(); other.goto(url(sid))
    wait_for(lambda: enabled(page).count() > 0 and enabled(other).count() > 0, "card missing in a tab")
    expect(card_ids(page) == card_ids(other), "tabs disagree on order")
    enabled(page).first.click(); ready(path, 2)
    wait_for(lambda: len(records(other)) == 1 and "Chose:" in records(other)[0], "other tab did not record the pick")
    other.close()


def t_keyboard(page, sid, path):
    page.goto(url(sid)); ready(path, 1)
    wait_for(lambda: enabled(page).count() > 0, "no card")
    pick = enabled(page).first.get_attribute("data-option-id")
    enabled(page).first.focus(); page.keyboard.press("Enter")
    ready(path, 2)
    expect(selections(path) == [pick], f"keyboard pick: {selections(path)}")


def t_mobile(page, sid, path):
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(url(sid)); ready(path, 1)
    wait_for(lambda: page.locator("checkpoint-card").count() > 0, "no card on mobile", 30)
    b = page.locator("checkpoint-card button").last
    b.scroll_into_view_if_needed()
    box = b.bounding_box()
    expect(box is not None and box["width"] > 0, "button not laid out")
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    hit = page.evaluate("([x,y]) => { let e = document.elementFromPoint(x,y); while (e && e.shadowRoot && e.shadowRoot.elementFromPoint(x,y) && e.shadowRoot.elementFromPoint(x,y) !== e) e = e.shadowRoot.elementFromPoint(x,y); return e ? (e.getAttribute('data-option-id') || e.tagName) : null }", [cx, cy])
    expect(hit == b.get_attribute("data-option-id"), f"last option occluded on mobile: hit {hit}")


TESTS = [t_first_card, t_click_records, t_double_click, t_reload_persists, t_mid_stream, t_click_while_streaming, t_free_text, t_two_tabs, t_keyboard, t_mobile]

with sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    for t in TESTS:
        name = t.__name__[2:]
        if ONLY and name not in ONLY:
            continue
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" and "interactive-widget" not in m.text else None)
        sid, path = new_session()
        try:
            note = t(page, sid, path)
            status = "PASS" + (f" ({note})" if note else "")
        except Exception as e:
            status = f"FAIL {e}" if isinstance(e, AssertionError) else f"ERROR {type(e).__name__}: {str(e).splitlines()[0]}"
            page.screenshot(path=f"/out/e2e-{BROWSER}-{name}.png")
        if errs:
            status += f"  [console: {errs[:2]}]"
        print(f"{BROWSER:8} {name:22} {status}", flush=True)
        ctx.close()
