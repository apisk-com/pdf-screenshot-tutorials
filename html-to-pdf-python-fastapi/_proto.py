# TEMPORARY prototype measurements for the design. Not part of the tutorial.
import json, statistics, sys, time
from pathlib import Path

mode = sys.argv[1]
from app import render
if mode == "warm":
    render._context.set_forkserver_preload(["app.render", "_warmup"])
import _proto_child
from app.main import Invoice, invoice_html

html = invoice_html(Invoice.model_validate(json.loads(Path("examples/invoice.json").read_text())))
base = str(render.STATIC_DIR)

def ms(x): return f"{x*1000:.0f} ms"

if mode == "inproc":
    from weasyprint import HTML
    print("after import", _proto_child.status())
    t = time.perf_counter(); HTML(string=html, base_url=base, url_fetcher=render.SafeURLFetcher()).write_pdf()
    print("in-process first render", ms(time.perf_counter() - t))
    ts = []
    for _ in range(10):
        t = time.perf_counter(); HTML(string=html, base_url=base, url_fetcher=render.SafeURLFetcher()).write_pdf(); ts.append(time.perf_counter() - t)
    print("in-process warm median", ms(statistics.median(ts)), "min", ms(min(ts)))
    print("after warm", _proto_child.status())
else:
    t = time.perf_counter(); render.render_pdf("<p>x</p>"); print(mode, "first call (starts fork server)", ms(time.perf_counter() - t))
    rs, tot = [], []
    for _ in range(10):
        t = time.perf_counter(); r = render.render_pdf(html); tot.append(time.perf_counter() - t); rs.append(r.seconds)
    print(mode, "child render median", ms(statistics.median(rs)), "total median", ms(statistics.median(tot)), "peak MB", r.peak_memory_mb)
    recv, send = render._context.Pipe(duplex=False)
    p = render._context.Process(target=_proto_child.child, args=(send, html, base)); p.start(); send.close()
    print(mode, "child /proc status before/after:", recv.recv()); p.join()
