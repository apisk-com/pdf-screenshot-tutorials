"""A Django view that gets an invoice PDF from the PDF service.

Add the service address to settings.py, for example:
PDF_SERVICE_URL = "http://pdf:8000"
"""

import json
import urllib.error
import urllib.request
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse, JsonResponse

EXAMPLE = Path(__file__).parents[1] / "examples" / "invoice.json"


def invoice_data(number):
    """Return the invoice in the format of the API. Replace with a database query."""
    data = json.loads(EXAMPLE.read_text())
    return {**data, "number": number}


def invoice_pdf(request, number):
    request_to_service = urllib.request.Request(
        f"{settings.PDF_SERVICE_URL}/invoices/pdf",
        data=json.dumps(invoice_data(number)).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request_to_service, timeout=30) as response:
            pdf = response.read()
    except urllib.error.HTTPError as error:
        return JsonResponse({"error": f"The PDF service returned {error.code}."}, status=502)
    except (urllib.error.URLError, TimeoutError):
        return JsonResponse({"error": "The PDF service is not available."}, status=502)
    return HttpResponse(
        pdf,
        content_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice-{number}.pdf"'},
    )
