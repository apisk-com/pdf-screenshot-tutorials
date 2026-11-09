"""POST /pdf: HTML in, PDF out. Uses the Playwright async API."""

import asyncio
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from playwright.async_api import Browser, async_playwright
from pydantic import BaseModel, Field

from make_pdf import PDF_OPTIONS

MAX_BODY_BYTES = 2_000_000
RENDER_TIMEOUT_SECONDS = 30
render_slots = asyncio.Semaphore(4)  # at most 4 renders at the same time


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One browser for the whole process, started once.
    async with async_playwright() as p:
        app.state.browser = await p.chromium.launch()
        yield
        await app.state.browser.close()


app = FastAPI(lifespan=lifespan)


class PdfRequest(BaseModel):
    html: str = Field(min_length=1, max_length=MAX_BODY_BYTES)
    media: Literal["print", "screen"] = "print"
    format: Literal["A4", "Letter", "Legal"] = "A4"
    landscape: bool = False


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    # A reverse proxy limit is still necessary for requests without Content-Length.
    length = request.headers.get("content-length", "0")
    if not length.isdigit() or int(length) > MAX_BODY_BYTES:
        return JSONResponse({"detail": "Request body is too large"}, status_code=413)
    return await call_next(request)


async def render(browser: Browser, body: PdfRequest) -> bytes:
    context = await browser.new_context()
    try:
        # Block every network request: the HTML cannot load remote files
        # or reach hosts in your private network.
        await context.route("**/*", lambda route: route.abort())
        page = await context.new_page()
        page.set_default_timeout(15_000)
        await page.emulate_media(media=body.media)
        await page.set_content(body.html, wait_until="load")
        await page.evaluate("document.fonts.ready.then(() => true)")
        options = {**PDF_OPTIONS, "format": body.format, "landscape": body.landscape}
        return await page.pdf(**options)
    finally:
        await context.close()


@app.post("/pdf")
async def create_pdf(body: PdfRequest, request: Request) -> Response:
    async with render_slots:
        try:
            pdf = await asyncio.wait_for(
                render(request.app.state.browser, body), RENDER_TIMEOUT_SECONDS
            )
        except TimeoutError:
            raise HTTPException(status_code=504, detail="Rendering took too long")
    return Response(pdf, media_type="application/pdf")
