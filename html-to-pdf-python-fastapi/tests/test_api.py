"""API tests: real requests, real PDFs."""

import io
import json
import multiprocessing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app import main, render

EXAMPLE = json.loads((Path(__file__).parents[1] / "examples" / "invoice.json").read_text())


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as test_client:  # runs the lifespan
        yield test_client


def read_pdf(response):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    return PdfReader(io.BytesIO(response.content))


def font_names(reader):
    return {str(font.get_object()["/BaseFont"])
            for page in reader.pages for font in page["/Resources"]["/Font"].values()}


def test_invoice_pdf(client):
    response = client.post("/invoices/pdf", json=EXAMPLE)
    reader = read_pdf(response)
    assert len(reader.pages) == 2
    box = reader.pages[0].mediabox
    assert (round(float(box.width)), round(float(box.height))) == (595, 842)  # A4
    page_1, page_2 = (page.extract_text() for page in reader.pages)
    assert "Harbor & Pine Co." in page_1
    assert "Page 1 of 2" in page_1
    assert "Invoice 2026-0412" in page_2  # the running header from string-set
    assert "20,863.90 EUR" in page_2
    assert any("Plex" in name for name in font_names(reader))  # the web font loaded
    assert response.headers["content-disposition"] == 'inline; filename="invoice-2026-0412.pdf"'
    assert response.headers["server-timing"].startswith("render;dur=")


def test_template_escapes_html_in_the_data(client):
    data = {**EXAMPLE, "customer": {"name": "<b>Mallory</b> & Sons"}}
    html = main.invoice_html(main.Invoice.model_validate(data))
    assert "&lt;b&gt;Mallory&lt;/b&gt; &amp; Sons" in html
    page_1 = read_pdf(client.post("/invoices/pdf", json=data)).pages[0].extract_text()
    assert "<b>Mallory</b> & Sons" in page_1


@pytest.mark.parametrize("change", [
    {"currency": "BTC"},
    {"number": "../2026-0412"},
    {"issued": "15/12/2026"},
    {"items": []},
    {"items": [{"description": "Work", "quantity": 1, "unit_price": "-5"}]},
    {"items": [{"description": "Work", "quantity": 1, "unit_price": "1.005"}]},
    {"items": [{"description": "Work", "quantity": 1, "unit_price": "1"}] * 301},
    {"discount": "10%"},
])
def test_bad_invoice_gets_422(client, change):
    assert client.post("/invoices/pdf", json={**EXAMPLE, **change}).status_code == 422


def test_html_can_use_the_static_files(client):
    html = '<link rel="stylesheet" href="invoice.css"><h1>Report <span class="number">R-7</span></h1>'
    reader = read_pdf(client.post("/pdf", json={"html": html}))
    assert any("Plex" in name for name in font_names(reader))


def test_body_over_the_limit_gets_413(client):
    response = client.post("/pdf", json={"html": "x" * (main.MAX_BODY_BYTES + 1)})
    assert response.status_code == 413


def test_body_without_content_length_gets_413(client):
    def chunks():
        yield b'{"html": "'
        for _ in range(main.MAX_BODY_BYTES // 10_000 + 1):
            yield b"x" * 10_000
        yield b'"}'

    response = client.post("/pdf", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_slow_render_gets_504_and_the_process_ends(client, monkeypatch):
    monkeypatch.setattr(render, "RENDER_TIMEOUT_SECONDS", 0.01)
    assert client.post("/invoices/pdf", json=EXAMPLE).status_code == 504
    assert multiprocessing.active_children() == []


def test_too_many_pages_gets_422(client, monkeypatch):
    monkeypatch.setattr(render, "MAX_PAGES", 1)
    response = client.post("/invoices/pdf", json=EXAMPLE)
    assert response.status_code == 422
    assert response.json() == {"detail": "The PDF has 2 pages. The limit is 1."}


def test_render_out_of_memory_gets_500_and_the_service_continues(client, monkeypatch):
    monkeypatch.setattr(render, "RENDER_MEMORY_MB", 64)
    assert client.post("/invoices/pdf", json=EXAMPLE).status_code == 500
    monkeypatch.undo()
    read_pdf(client.post("/invoices/pdf", json=EXAMPLE))


def test_no_free_render_slot_gets_503(client, monkeypatch):
    monkeypatch.setattr(main, "QUEUE_TIMEOUT_SECONDS", 0.1)
    slots = client.app.state.render_slots
    borrowers = [object() for _ in range(int(slots.total_tokens))]
    for borrower in borrowers:  # take every slot
        client.portal.call(slots.acquire_on_behalf_of, borrower)
    try:
        response = client.post("/pdf", json={"html": "<p>Hi</p>"})
    finally:
        for borrower in borrowers:
            client.portal.call(slots.release_on_behalf_of, borrower)
    assert response.status_code == 503
    assert response.headers["retry-after"] == "5"
