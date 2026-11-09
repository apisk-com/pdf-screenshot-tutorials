import io
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

from app import MAX_BODY_BYTES, app
from make_pdf import html_to_pdf

REPORT = (Path(__file__).parents[2] / "report.html").read_text(encoding="utf-8")


def read_pdf(data: bytes) -> PdfReader:
    assert data.startswith(b"%PDF-")
    return PdfReader(io.BytesIO(data))


def page_size(reader: PdfReader) -> tuple[int, int]:
    box = reader.pages[0].mediabox
    return round(float(box.width)), round(float(box.height))


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture
def local_server():
    """A local HTTP server that records every path it receives."""
    hits = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(self.path)
            self.send_response(404)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}", hits
    server.shutdown()


def test_sync_api_renders_report(browser):
    reader = read_pdf(html_to_pdf(browser, REPORT))
    assert len(reader.pages) == 3
    assert page_size(reader) == (596, 843)  # A4 in points
    assert reader.outline[0]["/Title"] == "Monthly usage report"
    assert "/StructTreeRoot" in reader.trailer["/Root"]  # tagged PDF


def test_outline_needs_tagged(browser):
    page = browser.new_page()
    page.set_content(REPORT)
    assert PdfReader(io.BytesIO(page.pdf(outline=True))).outline == []
    assert len(PdfReader(io.BytesIO(page.pdf(outline=True, tagged=True))).outline) > 0
    page.close()


def test_html_without_route_blocking_loads_local_urls(browser, local_server):
    base, hits = local_server
    html_to_pdf(browser, f'<img src="{base}/from-script.png">')
    assert hits == ["/from-script.png"]


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:  # runs the lifespan: starts the browser
        yield test_client


def test_endpoint_returns_pdf(client):
    response = client.post("/pdf", json={"html": REPORT, "format": "Letter", "landscape": True})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert page_size(read_pdf(response.content)) == (792, 612)


@pytest.mark.parametrize(
    "body",
    [{"html": ""}, {"html": "<p>Hi</p>", "media": "tv"}, {"html": "<p>Hi</p>", "format": "A7"}],
)
def test_endpoint_rejects_bad_input(client, body):
    assert client.post("/pdf", json=body).status_code == 422


def test_endpoint_rejects_large_body(client):
    response = client.post("/pdf", json={"html": "x" * (MAX_BODY_BYTES + 1)})
    assert response.status_code == 413


def test_endpoint_blocks_network_requests(client, local_server):
    base, hits = local_server
    response = client.post("/pdf", json={"html": f'<img src="{base}/from-endpoint.png">'})
    assert response.status_code == 200
    assert hits == []
