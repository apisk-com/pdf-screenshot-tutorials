"""Proof that the URL fetcher blocks remote URLs and local files."""

import io
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import pytest
from pypdf import PdfReader
from weasyprint import HTML
from weasyprint.urls import URLFetcher

from app.render import STATIC_DIR, BlockedURLError, SafeURLFetcher, render_pdf

# One request for each kind of resource that WeasyPrint loads.
PATHS = {"/link.css", "/import.css", "/font.woff2", "/background.png", "/img.png",
         "/svg-image.png", "/attachment.txt"}


def html_with_resources(base):
    return f"""
    <link rel="stylesheet" href="{base}/link.css">
    <link rel="attachment" href="{base}/attachment.txt">
    <style>
      @import url("{base}/import.css");
      @font-face {{ font-family: Remote; src: url("{base}/font.woff2"); }}
      p {{ font-family: Remote; background: url("{base}/background.png"); }}
    </style>
    <p>Text</p>
    <img src="{base}/img.png">
    <svg width="20" height="20"><image href="{base}/svg-image.png" width="20" height="20"/></svg>
    """


@pytest.fixture
def server():
    """A web server on 127.0.0.1, like a service in your private network."""
    hits = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(self.path)
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/after-redirect")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"internal data")

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}", hits
    httpd.shutdown()
    httpd.server_close()


def test_default_fetcher_loads_every_url(server):
    base, hits = server
    HTML(string=html_with_resources(base)).write_pdf()
    assert set(hits) == PATHS


def test_safe_fetcher_blocks_every_url(server):
    base, hits = server
    result = render_pdf(html_with_resources(base))
    assert hits == []
    assert {urlsplit(url).path for url in result.blocked} == PATHS


def test_default_fetcher_attaches_a_server_file_to_the_pdf():
    pdf = HTML(string='<link rel="attachment" href="file:///etc/passwd"><p>Hi</p>').write_pdf()
    attachments = PdfReader(io.BytesIO(pdf)).attachments
    assert any(b"root:" in data for files in attachments.values() for data in files)


def test_safe_fetcher_attaches_nothing():
    result = render_pdf('<link rel="attachment" href="file:///etc/passwd"><p>Hi</p>')
    assert PdfReader(io.BytesIO(result.pdf)).attachments == {}
    assert result.blocked == ["file:///etc/passwd"]


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "file:///dev/urandom",
    STATIC_DIR.as_uri() + "/../render.py",
    STATIC_DIR.as_uri() + "/fonts",
    "http://169.254.169.254/latest/meta-data/",
    "https://example.com/logo.png",
    "ftp://example.com/logo.png",
])
def test_fetcher_blocks(url):
    with pytest.raises(BlockedURLError):
        SafeURLFetcher().fetch(url)


def test_fetcher_blocks_a_link_that_points_out_of_the_folder(tmp_path):
    (tmp_path / "logo.png").symlink_to("/etc/passwd")
    with pytest.raises(BlockedURLError):
        SafeURLFetcher(folder=tmp_path).fetch((tmp_path / "logo.png").as_uri())


def test_fetcher_loads_static_files_and_data_urls():
    fetcher = SafeURLFetcher()
    response = fetcher.fetch((STATIC_DIR / "invoice.css").as_uri())
    assert b"@page" in response.read()
    response.close()
    response = fetcher.fetch("data:text/plain,hello")
    assert response.read() == b"hello"
    response.close()
    assert fetcher.blocked == []


def test_redirects_go_through_fetch(server):
    """Since WeasyPrint 68, fetch() also gets the target of each redirect."""
    base, hits = server
    seen = []

    class RecordingFetcher(URLFetcher):
        def fetch(self, url, headers=None):
            seen.append(url)
            return super().fetch(url, headers)

    RecordingFetcher().fetch(f"{base}/redirect").close()
    assert seen == [f"{base}/redirect", f"{base}/after-redirect"]
    assert hits == ["/redirect", "/after-redirect"]
