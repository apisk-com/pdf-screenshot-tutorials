"""The Django view calls the running service over HTTP."""

import socket
import subprocess
import sys
import time
import urllib.request

import django
import pytest
from django.conf import settings
from django.test import RequestFactory


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def service_url():
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)])
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(f"{url}/health", timeout=1).close()
            break
        except OSError:
            time.sleep(0.2)
    yield url
    server.terminate()
    server.wait(timeout=10)


@pytest.fixture(scope="module")
def view(service_url):
    settings.configure(PDF_SERVICE_URL=service_url)
    django.setup()
    from django_example.views import invoice_pdf
    return invoice_pdf


def test_view_returns_the_pdf(view):
    response = view(RequestFactory().get("/invoices/2026-0413.pdf"), "2026-0413")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"] == 'attachment; filename="invoice-2026-0413.pdf"'
    assert response.content.startswith(b"%PDF-")


def test_view_returns_502_when_the_service_rejects_the_data(view):
    response = view(RequestFactory().get("/invoices/x.pdf"), "bad/number")
    assert response.status_code == 502
