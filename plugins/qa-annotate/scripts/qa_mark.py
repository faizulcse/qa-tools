#!/usr/bin/env python3
"""qa_mark.py - mark the failing area on a screenshot and write the reason on it.

The original screenshot is never changed. For 02.png the marks live in
02.marks.json and the marked copy is 02.marked.png, both next to it.

    # 1. a spec with the Expected / Actual banner
    from-record CASE [--check N]      from qa-agent's qa_record.py result.json
    from-results FILE [--item ID]     from a qa-loop results file
    new PNG --expected ... --actual ... [--title ...] [--status fail|warn|info]

    # 2. marks
    locate -s SESSION TARGET --spec SPEC [--label ...] [--level ...] [--scroll] [--shoot PNG]
        exact box of an element in the open playwright-cli page (ref like e42, or a selector)
    redact -s SESSION --spec SPEC [--pattern REGEX]
        blur boxes over emails, tokens, UUIDs and long IDs visible on the open page
    add SPEC --box X,Y,W,H | --arrow X,Y | --blur X,Y,W,H | --solid X,Y,W,H
        [--label ...] [--level ...] [--approx] [--units px|css]
        a mark by coordinates (image pixels by default); use --approx when placed by eye
    show SPEC / remove SPEC N

    # 3. draw
    draw SPEC [SPEC ...] [--out PNG]  -> <name>.marked.png
    batch PATH [--banner-only] [--force]
        specs for every failing check / item with a screenshot under PATH (a case
        folder, a qa-results folder or a results file); draws the ones that have marks
    check PATH                         read-only: what is unmarked, out of date or approximate

Drawing uses playwright-cli (session "qa-mark", or QA_MARK_SESSION) on a page
served from a temporary 127.0.0.1 server; no image library is needed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import functools
import http.server
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "templates" / "overlay.html"
DRAW_SESSION = os.environ.get("QA_MARK_SESSION", "qa-mark")
LEVELS = ("fail", "warn", "info")
IMG_EXT = (".png",)


# --------------------------------------------------------------------------- #
# helpers

def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def png_size(path: Path) -> tuple[int, int]:
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        die(f"{path} is not a PNG (qa-annotate marks PNG screenshots)")
    return struct.unpack(">II", head[16:24])


def spec_path_for(png: Path) -> Path:
    return png.with_name(png.stem + ".marks.json")


def marked_path_for(png: Path) -> Path:
    return png.with_name(png.stem + ".marked.png")


def is_derived(p: Path) -> bool:
    return p.name.endswith(".marked.png")


def load_spec(path: str | Path) -> tuple[Path, dict]:
    p = Path(path)
    if p.suffix == ".png":
        p = spec_path_for(p)
    if not p.exists():
        die(f"no spec at {p} (create one with new, from-record or from-results)")
    return p, json.loads(p.read_text())


def save_spec(p: Path, spec: dict) -> None:
    p.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n")


def rel(target: Path, base: Path) -> str:
    try:
        return os.path.relpath(target.resolve(), base.resolve())
    except ValueError:  # different drive on Windows
        return str(target.resolve())


def source_of(spec_file: Path, spec: dict) -> Path:
    return (spec_file.parent / spec["source"]).resolve()


def output_of(spec_file: Path, spec: dict) -> Path:
    return (spec_file.parent / spec.get("output", Path(spec["source"]).stem + ".marked.png")).resolve()


def new_spec(png: Path, title: str, findings: list[dict], status: str, record: dict | None,
             force: bool) -> Path | None:
    png = png.resolve()
    if not png.exists():
        die(f"screenshot not found: {png}")
    if is_derived(png):
        die(f"{png.name} is already a marked copy; mark the original")
    w, h = png_size(png)
    sp = spec_path_for(png)
    if sp.exists() and not force:
        _, old = load_spec(sp)
        # same screenshot used by another finding: add it to the banner
        known = {(f.get("expected"), f.get("actual")) for f in old["banner"].get("findings", [])}
        added = [f for f in findings if (f.get("expected"), f.get("actual")) not in known]
        if added:
            old["banner"]["findings"].extend(added)
            save_spec(sp, old)
            print(f"spec: {sp} (added {len(added)} finding(s) to the banner)")
        else:
            print(f"spec: {sp} (exists, unchanged)")
        return sp
    spec = {
        "source": png.name,
        "output": marked_path_for(png).name,
        "image": {"width": w, "height": h},
        "banner": {"status": status, "title": title, "findings": findings},
        "marks": [],
        "record": record or {},
        "created": dt.datetime.now().isoformat(timespec="seconds"),
    }
    save_spec(sp, spec)
    print(f"spec: {sp}")
    return sp


def next_n(spec: dict) -> int:
    return max([m.get("n", 0) for m in spec["marks"]] + [0]) + 1


def resolve_evidence(path: str, *bases: Path) -> Path | None:
    p = Path(path)
    if p.is_absolute():
        return p if p.exists() else None
    for b in (Path.cwd(), *bases):
        q = (b / p)
        if q.exists():
            return q.resolve()
    return None


# --------------------------------------------------------------------------- #
# playwright-cli

def pw(session: str, *args: str, cwd: str | None = None) -> str:
    exe = shutil.which("playwright-cli")
    if not exe:
        die("playwright-cli is not on PATH (set it up with qa-agent's qa-setup first)")
    out = subprocess.run([exe, f"-s={session}", *args], capture_output=True, text=True, cwd=cwd)
    text = (out.stdout or "") + (out.stderr or "")
    m = re.search(r"^### Error\s*\n(.+?)(?:\n###|\Z)", text, re.S | re.M)
    if m or out.returncode != 0:
        raise RuntimeError((m.group(1) if m else text).strip()[:500])
    return text


def pw_eval(session: str, func: str, target: str | None = None):
    args = ["eval", func] + ([target] if target else [])
    text = pw(session, *args)
    m = re.search(r"^### Result\s*\n(.+)$", text, re.M)
    if not m:
        raise RuntimeError("no result from playwright-cli eval:\n" + text[:400])
    val = json.loads(m.group(1))
    return json.loads(val) if isinstance(val, str) else val


LOCATE_JS = """el => {
  if (%(scroll)s) el.scrollIntoView({block: 'center', inline: 'center'});
  const r = el.getBoundingClientRect();
  return JSON.stringify({x: r.x, y: r.y, w: r.width, h: r.height,
    sx: window.scrollX, sy: window.scrollY, vw: window.innerWidth, vh: window.innerHeight,
    dpr: window.devicePixelRatio, text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80)});
}"""

REDACT_JS = r"""() => {
  const pats = %(pats)s.map(p => new RegExp(p, 'g'));
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const inputs = [...document.querySelectorAll('input, textarea')];
  const push = (r, why) => {
    if (r.width < 1 || r.height < 1 || out.length >= 80) return;
    out.push({x: r.x, y: r.y, w: r.width, h: r.height, why});
  };
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue; if (!t || t.length < 6) continue;
    const st = n.parentElement && getComputedStyle(n.parentElement);
    if (st && (st.visibility === 'hidden' || st.display === 'none')) continue;
    for (const [i, re] of pats.entries()) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(t))) {
        const range = document.createRange();
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        for (const r of range.getClientRects()) push(r, %(names)s[i]);
      }
    }
  }
  for (const el of inputs) {
    const v = el.value || ''; if (el.type === 'password' && v) { push(el.getBoundingClientRect(), 'password'); continue; }
    for (const [i, re] of pats.entries()) { re.lastIndex = 0; if (re.test(v)) { push(el.getBoundingClientRect(), %(names)s[i]); break; } }
  }
  return JSON.stringify({marks: out, sx: window.scrollX, sy: window.scrollY,
    vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio});
}"""

PII = [
    ("email", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    ("token", r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}"),
    ("uuid", r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"),
    ("long id", r"\b[0-9a-fA-F]{24,}\b"),
    ("secret", r"\b(?:sk|pk|rk|ghp|gho|xox[bpas])[-_][A-Za-z0-9_-]{12,}\b"),
]


# --------------------------------------------------------------------------- #
# spec creation

def cmd_new(a) -> int:
    findings = [{"label": a.label or "", "expected": a.expected or "", "actual": a.actual or ""}]
    new_spec(Path(a.png), a.title or "", findings, a.status, {"kind": "manual"}, a.force)
    return 0


def find_result_json(case: str) -> Path:
    p = Path(case)
    if p.is_file():
        return p
    if p.is_dir() and (p / "result.json").exists():
        return p / "result.json"
    root = Path(os.environ.get("QA_OUT_DIR", "./qa-results"))
    slug = re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", case.lower()))[:60]
    if (root / slug / "result.json").exists():
        return root / slug / "result.json"
    die(f"no result.json for {case} (pass the case folder, its result.json or the case id)")
    raise SystemExit  # for type checkers


def specs_from_record(result_file: Path, only: int | None, force: bool) -> tuple[list[Path], list[str]]:
    r = json.loads(result_file.read_text())
    made, skipped = [], []
    entries = sorted(r.get("checks", []) + r.get("steps", []), key=lambda s: s.get("n", 0))
    for e in entries:
        if e.get("status") != "FAIL" or (only is not None and e.get("n") != only):
            continue
        shot = e.get("screenshot")
        png = resolve_evidence(shot, result_file.parent) if shot else None
        if not png:
            skipped.append(f"{r.get('caseId')} #{e.get('n')} {e.get('label')}: no screenshot recorded")
            continue
        findings = [{"label": "" if e.get("expected") else e.get("label", ""),
                     "expected": e.get("expected") or "", "actual": e.get("error") or ""}]
        title = f"{r.get('caseId', '')} {r.get('title', '')}".strip()
        record = {"kind": "qa_record", "file": rel(result_file, png.parent), "case": r.get("caseId"),
                  "n": e.get("n"), "url": e.get("url")}
        made.append(new_spec(png, title, findings, "fail", record, force))
    return [m for m in made if m], skipped


def cmd_from_record(a) -> int:
    made, skipped = specs_from_record(find_result_json(a.case), a.check, a.force)
    for s in skipped:
        print(f"skipped: {s}")
    if not made and not skipped:
        print("no failing checks in this case")
    return 0


ITEM_LEVEL = {"fail": "fail", "partial": "warn", "not_fixed": "fail", "partly": "warn"}


def specs_from_results(results_file: Path, only: str | None, force: bool) -> tuple[list[Path], list[str]]:
    r = json.loads(results_file.read_text())
    made, skipped = [], []
    for it in r.get("items", []):
        if only and it.get("id") != only:
            continue
        t = it.get("type")
        if t == "issue":
            level = "fail" if it.get("severity") in ("S1", "S2") else "warn"
            label = f"{it.get('severity', '')} {it.get('title', '')}".strip()
            expected, actual = it.get("expected", ""), it.get("now", "")
            if not (expected or actual) and it.get("rows"):
                rows = it["rows"][1:] if len(it["rows"]) > 1 else it["rows"]
                actual = "; ".join(f"{x[0]}: {x[1]}" for x in rows if len(x) >= 2)
                expected = "; ".join(f"{x[0]}: {x[2]}" for x in rows if len(x) >= 3)
        elif t == "ac" and it.get("status") in ITEM_LEVEL:
            level, label = ITEM_LEVEL[it["status"]], ""
            expected, actual = it.get("title", ""), it.get("outcome", "")
        elif t == "retest" and it.get("status") in ITEM_LEVEL:
            level, label = ITEM_LEVEL[it["status"]], "Retest"
            expected, actual = f"Fixed: {it.get('title', '')}", it.get("outcome", "")
        else:
            continue
        pngs = [p for p in (resolve_evidence(e, results_file.parent) for e in it.get("evidence", []))
                if p and p.suffix.lower() in IMG_EXT and not is_derived(p)]
        if not pngs:
            skipped.append(f"{r.get('key')} {it.get('id')}: no PNG screenshot in evidence")
            continue
        title = f"{r.get('key', '')} {it.get('id', '')}: {it.get('title', '')}".strip()
        record = {"kind": "qa_results", "file": rel(results_file, pngs[0].parent), "item": it.get("id")}
        made.append(new_spec(pngs[0], title, [{"label": label, "expected": expected, "actual": actual}],
                             level, record, force))
    return [m for m in made if m], skipped


def cmd_from_results(a) -> int:
    f = Path(a.file)
    if not f.exists():
        die(f"results file not found: {f}")
    made, skipped = specs_from_results(f, a.item, a.force)
    for s in skipped:
        print(f"skipped: {s}")
    if not made and not skipped:
        print("no failing items in this results file")
    return 0


# --------------------------------------------------------------------------- #
# marks

def parse_nums(s: str, n: int, name: str) -> list[float]:
    try:
        vals = [float(v) for v in s.split(",")]
    except ValueError:
        vals = []
    if len(vals) != n:
        die(f"--{name} takes {n} numbers separated by commas")
    return vals


def css_frame(info: dict) -> dict:
    return {k: info[k] for k in ("sx", "sy", "vw", "vh", "dpr")}


def cmd_locate(a) -> int:
    try:
        info = pw_eval(a.session, LOCATE_JS % {"scroll": "true" if a.scroll else "false"}, a.target)
    except RuntimeError as e:
        die(f"could not locate {a.target}: {e}")
    if a.shoot:
        shot = Path(a.shoot).resolve()
        shot.parent.mkdir(parents=True, exist_ok=True)
        try:
            pw(a.session, "screenshot", f"--filename={shot}")
        except RuntimeError as e:
            die(f"screenshot failed: {e}")
        print(f"screenshot: {shot}")
    mark = {"kind": "box", "level": a.level, "label": a.label or "",
            "rect": [round(info["x"], 1), round(info["y"], 1), round(info["w"], 1), round(info["h"], 1)],
            "units": "css", "frame": css_frame(info), "source": f"locate {a.target}", "approx": False}
    if info["w"] < 1 or info["h"] < 1:
        print("warning: the element has no size on the page (hidden?) - the box will be tiny")
    if a.shoot:
        # the fresh shot gets its own spec; the banner is copied from --spec if given
        banner, record = {"status": a.level, "title": "", "findings": []}, {"kind": "manual"}
        if a.spec:
            _, base = load_spec(a.spec)
            banner, record = base["banner"], dict(base.get("record") or {}, focus_of=base["source"])
        shot_spec = spec_path_for(Path(a.shoot).resolve())
        if not shot_spec.exists():
            new_spec(Path(a.shoot), banner.get("title", ""), banner.get("findings", []),
                     banner.get("status", a.level), record, False)
        a.spec = str(shot_spec)
    if a.spec:
        sp, spec = load_spec(a.spec)
        mark["n"] = next_n(spec)
        spec["marks"].append(mark)
        save_spec(sp, spec)
        print(f"mark {mark['n']} added to {sp}: {a.target} \"{info.get('text', '')}\" at "
              f"{mark['rect']} (css px, scroll {info['sx']:.0f},{info['sy']:.0f})")
        warn_offscreen(sp, spec, mark)
    else:
        print(json.dumps(mark, indent=2))
    return 0


def to_image_rect(spec: dict, m: dict) -> tuple[float, float, float, float]:
    """Rect in image pixels. css units are scaled by image width / viewport width
    (handles --hires shots) and offset by scroll when the shot is full-page."""
    if "rect" in m:
        x, y, w, h = m["rect"]
    else:
        x, y = m["at"]
        w = h = 0
    if m.get("units") != "css":
        return x, y, w, h
    fr = m.get("frame") or {}
    iw, ih = spec["image"]["width"], spec["image"]["height"]
    vw = fr.get("vw") or iw
    s = iw / vw
    full_page = spec["image"].get("full_page")
    if full_page is None:
        full_page = ih > (fr.get("vh") or ih) * s + 2
    if full_page:
        x, y = x + fr.get("sx", 0), y + fr.get("sy", 0)
    return x * s, y * s, w * s, h * s


def warn_offscreen(sp: Path, spec: dict, m: dict) -> None:
    x, y, w, h = to_image_rect(spec, m)
    iw, ih = spec["image"]["width"], spec["image"]["height"]
    if x + w <= 0 or y + h <= 0 or x >= iw or y >= ih:
        print(f"warning: mark {m.get('n', '')} is outside the screenshot ({iw}x{ih}). The element "
              f"was scrolled away when the shot was taken: re-run locate with --scroll --shoot NEW.png, "
              f"or take a --full-page screenshot.")


def cmd_redact(a) -> int:
    pats = PII + [(f"pattern {i + 1}", p) for i, p in enumerate(a.pattern or [])]
    js = REDACT_JS % {"pats": json.dumps([p for _, p in pats]), "names": json.dumps([n for n, _ in pats])}
    try:
        info = pw_eval(a.session, js)
    except RuntimeError as e:
        die(f"could not scan the page: {e}")
    sp, spec = load_spec(a.spec)
    frame = css_frame(info)
    added = 0
    for r in info["marks"]:
        pad = 2
        m = {"kind": "blur", "rect": [r["x"] - pad, r["y"] - pad, r["w"] + 2 * pad, r["h"] + 2 * pad],
             "units": "css", "frame": frame, "why": r["why"], "source": "redact"}
        x, y, w, h = to_image_rect(spec, m)
        if x + w <= 0 or y + h <= 0 or x >= spec["image"]["width"] or y >= spec["image"]["height"]:
            continue
        spec["marks"].append(m)
        added += 1
    save_spec(sp, spec)
    kinds = sorted({r["why"] for r in info["marks"]})
    print(f"redact: {added} blur box(es) added to {sp}" + (f" ({', '.join(kinds)})" if kinds else ""))
    if not added:
        print("nothing found on the visible page - check the screenshot by eye for names, phones or addresses")
    return 0


def cmd_add(a) -> int:
    sp, spec = load_spec(a.spec)
    given = [k for k in ("box", "arrow", "blur", "solid") if getattr(a, k)]
    if len(given) != 1:
        die("give exactly one of --box, --arrow, --blur, --solid")
    kind = given[0]
    m: dict = {"kind": kind, "units": a.units, "approx": bool(a.approx)}
    if kind == "arrow":
        m["at"] = parse_nums(a.arrow, 2, "arrow")
    else:
        m["rect"] = parse_nums(getattr(a, kind), 4, kind)
    if kind in ("box", "arrow"):
        m.update(n=next_n(spec), level=a.level, label=a.label or "")
    if a.why:
        m["why"] = a.why
    spec["marks"].append(m)
    save_spec(sp, spec)
    print(f"{kind} added to {sp}" + (f" as mark {m['n']}" if "n" in m else ""))
    warn_offscreen(sp, spec, m)
    return 0


def cmd_show(a) -> int:
    sp, spec = load_spec(a.spec)
    b = spec["banner"]
    print(f"{sp}\nsource: {spec['source']} ({spec['image']['width']}x{spec['image']['height']})"
          f"\noutput: {spec.get('output')}\nbanner: [{b.get('status')}] {b.get('title')}")
    for f in b.get("findings", []):
        print(f"  expected: {f.get('expected')}\n  actual:   {f.get('actual')}")
    for i, m in enumerate(spec["marks"], 1):
        x, y, w, h = to_image_rect(spec, m)
        what = m.get("label") or m.get("why") or ""
        print(f"{i:>3}. {m['kind']:<5} #{m.get('n', '-')} {m.get('level', '')} at {x:.0f},{y:.0f} {w:.0f}x{h:.0f}"
              f"{' (approx)' if m.get('approx') else ''} {what}")
    return 0


def cmd_remove(a) -> int:
    sp, spec = load_spec(a.spec)
    if not 1 <= a.index <= len(spec["marks"]):
        die(f"no mark at position {a.index} (see: show)")
    m = spec["marks"].pop(a.index - 1)
    save_spec(sp, spec)
    print(f"removed {m['kind']} {m.get('label') or m.get('why') or ''} from {sp}")
    return 0


# --------------------------------------------------------------------------- #
# draw

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401
        pass


class Renderer:
    """One temporary local server and one playwright-cli session for many draws."""

    def __enter__(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="qa-mark-"))
        handler = functools.partial(Quiet, directory=str(self.tmp))
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.opened = False
        self.count = 0
        return self

    def __exit__(self, *exc):
        if self.opened:
            try:
                pw(DRAW_SESSION, "close", cwd=str(self.tmp))
            except RuntimeError:
                pass
        self.httpd.shutdown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def render(self, spec_file: Path, spec: dict, out: Path) -> tuple[int, int]:
        src = source_of(spec_file, spec)
        if not src.exists():
            raise RuntimeError(f"source screenshot not found: {src}")
        w, h = png_size(src)
        spec["image"].update(width=w, height=h)
        self.count += 1
        d = self.tmp / str(self.count)
        d.mkdir()
        shutil.copyfile(src, d / "source.png")
        (d / "index.html").write_text(TEMPLATE.read_text().replace("/*__DATA__*/", page_data(spec_file, spec)))
        url = f"{self.base}/{self.count}/index.html"
        cwd = str(self.tmp)
        if not self.opened:
            try:
                pw(DRAW_SESSION, "close", cwd=cwd)  # a stale session from an earlier run
            except RuntimeError:
                pass
            pw(DRAW_SESSION, "open", url, cwd=cwd)
            self.opened = True
        else:
            pw(DRAW_SESSION, "goto", url, cwd=cwd)
        pw(DRAW_SESSION, "resize", str(w), "600", cwd=cwd)
        out.parent.mkdir(parents=True, exist_ok=True)
        pw(DRAW_SESSION, "screenshot", "--full-page", f"--filename={out}", cwd=cwd)
        if not out.exists():
            raise RuntimeError(f"playwright-cli did not write {out}")
        return png_size(out)


def page_data(spec_file: Path, spec: dict) -> str:
    iw = spec["image"]["width"]
    marks, approx = [], False
    css_scales = [iw / (m.get("frame") or {}).get("vw", iw) for m in spec["marks"] if m.get("units") == "css"]
    k = round(css_scales[0], 3) if css_scales else max(1.0, round(iw / 1600, 2))
    n_auto = 0
    for m in spec["marks"]:
        x, y, w, h = to_image_rect(spec, m)
        d = {"kind": m["kind"], "level": m.get("level", "fail"), "label": m.get("label", ""),
             "x": round(x, 1), "y": round(y, 1), "w": round(w, 1), "h": round(h, 1),
             "approx": bool(m.get("approx"))}
        if m["kind"] in ("box", "arrow"):
            n_auto += 1
            d["n"] = m.get("n", n_auto)
            approx = approx or d["approx"]
        marks.append(d)
    blurred = sum(1 for m in spec["marks"] if m["kind"] in ("blur", "solid"))
    foot = [f"Marked copy of {Path(spec['source']).name} - the original screenshot is unchanged."]
    if approx:
        foot.append("Dashed boxes were placed by eye and are approximate.")
    if blurred:
        foot.append(f"{blurred} area(s) blurred for privacy.")
    data = {"W": iw, "H": spec["image"]["height"], "k": k, "banner": spec.get("banner") or {},
            "marks": marks, "foot": " ".join(foot)}
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def draw_all(items: list[tuple[Path, dict, Path]]) -> int:
    bad = 0
    with Renderer() as r:
        for sp, spec, out in items:
            try:
                ow, oh = r.render(sp, spec, out)
            except RuntimeError as e:
                print(f"FAILED {sp}: {e}")
                bad += 1
                continue
            spec["drawn"] = dt.datetime.now().isoformat(timespec="seconds")
            save_spec(sp, spec)
            boxes = sum(1 for m in spec["marks"] if m["kind"] in ("box", "arrow"))
            print(f"marked: {out} ({ow}x{oh}, {boxes} mark(s))")
    return 1 if bad else 0


def cmd_draw(a) -> int:
    items = []
    for s in a.spec:
        sp, spec = load_spec(s)
        out = Path(a.out).resolve() if a.out and len(a.spec) == 1 else output_of(sp, spec)
        items.append((sp, spec, out))
    return draw_all(items)


# --------------------------------------------------------------------------- #
# batch / check

def sources_under(path: Path) -> tuple[list[Path], list[Path]]:
    """(record files, results files) under PATH."""
    if path.is_file():
        data = json.loads(path.read_text())
        return ([path], []) if "checks" in data or "caseId" in data else ([], [path])
    records = sorted(path.rglob("result.json"))
    results = sorted(p for p in path.rglob("results-*.json"))
    return records, results


def cmd_batch(a) -> int:
    path = Path(a.path)
    if not path.exists():
        die(f"not found: {path}")
    records, results = sources_under(path)
    specs, skipped = [], []
    for f in records:
        m, s = specs_from_record(f, None, a.force)
        specs += m
        skipped += s
    for f in results:
        m, s = specs_from_results(f, None, a.force)
        specs += m
        skipped += s
    todo, need = [], []
    for sp in dict.fromkeys(specs):
        _, spec = load_spec(sp)
        has_marks = any(m["kind"] in ("box", "arrow") for m in spec["marks"])
        if has_marks or a.banner_only:
            todo.append((sp, spec, output_of(sp, spec)))
        else:
            need.append(sp)
    rc = draw_all(todo) if todo else 0
    for sp in need:
        print(f"needs a mark: {sp} (locate on the open page, or add --box ... --approx)")
    for s in skipped:
        print(f"skipped: {s}")
    print(f"batch: {len(todo)} drawn, {len(need)} need a mark, {len(skipped)} skipped")
    return rc


def cmd_check(a) -> int:
    path = Path(a.path)
    if not path.exists():
        die(f"not found: {path}")
    spec_files = [path] if path.name.endswith(".marks.json") else sorted(path.rglob("*.marks.json"))
    problems = warns = 0
    seen = set()
    for sp in spec_files:
        spec = json.loads(sp.read_text())
        src, out = source_of(sp, spec), output_of(sp, spec)
        seen.add(src)
        tag = str(sp)
        if not src.exists():
            print(f"MISSING SOURCE  {tag}: {src.name} is gone")
            problems += 1
            continue
        if not any(m["kind"] in ("box", "arrow") for m in spec["marks"]):
            print(f"NO MARKS        {tag}")
            warns += 1
        if not out.exists():
            print(f"NOT DRAWN       {tag}")
            problems += 1
        elif out.stat().st_mtime < max(src.stat().st_mtime, sp.stat().st_mtime) - 1:
            print(f"OUT OF DATE     {tag}: re-run draw")
            problems += 1
        n_approx = sum(1 for m in spec["marks"] if m.get("approx"))
        if n_approx:
            print(f"APPROXIMATE     {tag}: {n_approx} mark(s) placed by eye")
            warns += 1
    if path.is_dir():
        records, results = sources_under(path)
        for f in records:
            r = json.loads(f.read_text())
            for e in r.get("checks", []) + r.get("steps", []):
                p = resolve_evidence(e["screenshot"], f.parent) if e.get("status") == "FAIL" and e.get("screenshot") else None
                if p and p not in seen:
                    print(f"UNMARKED        {p} ({r.get('caseId')} #{e.get('n')})")
                    warns += 1
                    seen.add(p)
        for f in results:
            r = json.loads(f.read_text())
            for it in r.get("items", []):
                bad = it.get("type") == "issue" or it.get("status") in ITEM_LEVEL
                for ev in it.get("evidence", []) if bad else []:
                    p = resolve_evidence(ev, f.parent)
                    if p and p.suffix.lower() in IMG_EXT and not is_derived(p) and p not in seen:
                        print(f"UNMARKED        {p} ({r.get('key')} {it.get('id')})")
                        warns += 1
                        seen.add(p)
                        break
    print(f"check: {len(spec_files)} spec(s), {problems} problem(s), {warns} warning(s)")
    return 1 if problems else 0


# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    n = sub.add_parser("new", help="spec for a screenshot with your own Expected / Actual")
    n.add_argument("png")
    n.add_argument("--title")
    n.add_argument("--label", help="what was checked (shown above Expected)")
    n.add_argument("--expected")
    n.add_argument("--actual")
    n.add_argument("--status", choices=LEVELS, default="fail")
    n.add_argument("--force", action="store_true", help="replace an existing spec")
    n.set_defaults(fn=cmd_new)

    fr = sub.add_parser("from-record", help="specs from a qa_record.py case")
    fr.add_argument("case", help="case folder, its result.json, or the case id")
    fr.add_argument("--check", type=int, help="only this step/check number")
    fr.add_argument("--force", action="store_true")
    fr.set_defaults(fn=cmd_from_record)

    fs = sub.add_parser("from-results", help="specs from a qa-loop results file")
    fs.add_argument("file")
    fs.add_argument("--item", help="only this item id (AC2, I1, R1)")
    fs.add_argument("--force", action="store_true")
    fs.set_defaults(fn=cmd_from_results)

    lo = sub.add_parser("locate", help="exact box of an element on the open page")
    lo.add_argument("-s", "--session", default="qa")
    lo.add_argument("target", help="snapshot ref (e42) or a unique selector")
    lo.add_argument("--spec", help="spec (or its PNG) to add the mark to")
    lo.add_argument("--label")
    lo.add_argument("--level", choices=LEVELS, default="fail")
    lo.add_argument("--scroll", action="store_true", help="scroll the element into view first")
    lo.add_argument("--shoot", help="take a fresh screenshot to this path after locating")
    lo.set_defaults(fn=cmd_locate)

    rd = sub.add_parser("redact", help="blur personal data / secrets visible on the open page")
    rd.add_argument("-s", "--session", default="qa")
    rd.add_argument("--spec", required=True)
    rd.add_argument("--pattern", action="append", help="extra regex to blur (repeatable)")
    rd.set_defaults(fn=cmd_redact)

    ad = sub.add_parser("add", help="add a mark by coordinates")
    ad.add_argument("spec")
    ad.add_argument("--box", metavar="X,Y,W,H")
    ad.add_argument("--arrow", metavar="X,Y")
    ad.add_argument("--blur", metavar="X,Y,W,H")
    ad.add_argument("--solid", metavar="X,Y,W,H")
    ad.add_argument("--label")
    ad.add_argument("--level", choices=LEVELS, default="fail")
    ad.add_argument("--units", choices=("px", "css"), default="px")
    ad.add_argument("--approx", action="store_true", help="placed by eye: drawn dashed")
    ad.add_argument("--why", help="reason for a blur/solid box")
    ad.set_defaults(fn=cmd_add)

    sh = sub.add_parser("show", help="print a spec's banner and marks")
    sh.add_argument("spec")
    sh.set_defaults(fn=cmd_show)

    rm = sub.add_parser("remove", help="remove a mark by its position in show")
    rm.add_argument("spec")
    rm.add_argument("index", type=int)
    rm.set_defaults(fn=cmd_remove)

    dr = sub.add_parser("draw", help="draw the marked copy")
    dr.add_argument("spec", nargs="+")
    dr.add_argument("--out")
    dr.set_defaults(fn=cmd_draw)

    ba = sub.add_parser("batch", help="specs and marked copies for every failure under a path")
    ba.add_argument("path")
    ba.add_argument("--banner-only", action="store_true", help="also draw specs without marks (banner only)")
    ba.add_argument("--force", action="store_true", help="recreate specs (drops their marks)")
    ba.set_defaults(fn=cmd_batch)

    ck = sub.add_parser("check", help="read-only status of marked copies under a path")
    ck.add_argument("path")
    ck.set_defaults(fn=cmd_check)

    a = ap.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
