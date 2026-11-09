"""HTML to PDF API with FastAPI, Jinja2 and WeasyPrint."""

import logging
import os
from contextlib import asynccontextmanager
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Annotated, Literal

import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from pydantic import BaseModel, ConfigDict, Field

from app.render import RenderError, render_pdf

MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", "1000000"))
# Renders at the same time. Each render is a process that uses one CPU core.
RENDER_SLOTS = int(os.environ.get("RENDER_SLOTS", str(os.cpu_count() or 2)))
# How long a request waits for a free render slot before it gets 503.
QUEUE_TIMEOUT_SECONDS = float(os.environ.get("QUEUE_TIMEOUT_SECONDS", "10"))

log = logging.getLogger("uvicorn.error")


def money(value: Decimal, currency: str) -> str:
    return f"{value.quantize(Decimal('0.01'), ROUND_HALF_UP):,.2f} {currency}"


# The templates are files in this repo. Never load a template from a request.
templates = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=True,  # the Jinja2 default is False
    undefined=StrictUndefined,  # a missing value is an error, not an empty string
)
templates.filters["money"] = money

Text = Annotated[str, Field(min_length=1, max_length=200)]


class Party(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Text
    address: list[Text] = Field(default=[], max_length=6)


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(min_length=1, max_length=500)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    unit_price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class Invoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: str = Field(pattern=r"^[A-Za-z0-9-]{1,30}$")
    issued: date
    due: date
    currency: Literal["EUR", "USD", "GBP"]
    seller: Party
    customer: Party
    items: list[Item] = Field(min_length=1, max_length=300)
    note: str = Field(default="", max_length=1000)


class HtmlDocument(BaseModel):
    html: str = Field(min_length=1)


def invoice_html(invoice: Invoice) -> str:
    total = sum(item.quantity * item.unit_price for item in invoice.items)
    return templates.get_template("invoice.html").render(invoice=invoice, total=total)


class LimitBodySize:
    """Send 413 when the body is too large, also without a Content-Length header."""

    def __init__(self, app, max_bytes):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        received = 0

        async def receive_with_limit():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > self.max_bytes:
                raise HTTPException(413, "The request body is too large.")
            return message

        await self.app(scope, receive_with_limit, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.render_slots = anyio.CapacityLimiter(RENDER_SLOTS)
    # The first render starts the fork server, which imports WeasyPrint.
    await anyio.to_thread.run_sync(render_pdf, "<p>Start</p>")
    yield


app = FastAPI(title="HTML to PDF API", lifespan=lifespan)
app.add_middleware(LimitBodySize, max_bytes=MAX_BODY_BYTES)


async def pdf_response(request: Request, html: str, filename: str) -> Response:
    slots = request.app.state.render_slots
    try:
        with anyio.fail_after(QUEUE_TIMEOUT_SECONDS):
            await slots.acquire()
    except TimeoutError:
        raise HTTPException(503, "All render slots are busy.", {"Retry-After": "5"}) from None
    try:
        # render_pdf() blocks, so it runs in a worker thread. The event loop
        # stays free for other requests.
        result = await anyio.to_thread.run_sync(render_pdf, html)
    except RenderError as error:
        raise HTTPException(error.status, str(error)) from None
    finally:
        slots.release()

    if result.blocked:
        log.warning("Blocked %d URLs, first: %s", len(result.blocked), result.blocked[0])
    log.info("PDF: %d pages, %.0f ms, %.0f MB", result.pages, result.seconds * 1000, result.peak_memory_mb)
    return Response(
        result.pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Server-Timing": f"render;dur={result.seconds * 1000:.0f}",
        },
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/invoices/pdf")
async def invoice_pdf(invoice: Invoice, request: Request) -> Response:
    return await pdf_response(request, invoice_html(invoice), f"invoice-{invoice.number}.pdf")


@app.post("/pdf")
async def html_pdf(document: HtmlDocument, request: Request) -> Response:
    return await pdf_response(request, document.html, "document.pdf")
