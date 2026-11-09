# TEMPORARY prototype helpers.
from pathlib import Path


def status():
    keys = ("VmPeak", "VmSize", "VmHWM", "VmRSS", "Threads")
    lines = Path("/proc/self/status").read_text().splitlines()
    return {l.split(":")[0]: l.split(":")[1].strip() for l in lines if l.startswith(keys)}


def child(conn, html, base_url):
    from weasyprint import HTML
    from app.render import SafeURLFetcher
    before = status()
    HTML(string=html, base_url=base_url, url_fetcher=SafeURLFetcher()).write_pdf()
    conn.send((before, status()))
    conn.close()
