"""Render HTML to PDF with WeasyPrint, one child process for each render.

The parent can kill a child process that runs too long, and a memory limit
stops a child that uses too much memory. The URL fetcher loads only data:
URLs and the files in the static folder.
"""

import multiprocessing
import os
import resource
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

from weasyprint import HTML
from weasyprint.urls import URLFetcher

STATIC_DIR = (Path(__file__).parent / "static").resolve()

# Limits for one render. Change them with environment variables.
RENDER_TIMEOUT_SECONDS = float(os.environ.get("RENDER_TIMEOUT_SECONDS", "20"))
RENDER_MEMORY_MB = int(os.environ.get("RENDER_MEMORY_MB", "1024"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "50"))


class BlockedURLError(ValueError):
    """The fetcher did not allow this URL."""


class SafeURLFetcher(URLFetcher):
    """Load data: URLs and files inside one folder. Block all other URLs.

    WeasyPrint calls fetch() for each image, stylesheet, @import, font,
    SVG image and attachment, and (since version 68) for each redirect.
    """

    def __init__(self, folder=STATIC_DIR):
        super().__init__(allowed_protocols={"data", "file"}, allow_redirects=False, timeout=5)
        self.folder = Path(folder).resolve()
        self.blocked = []

    def fetch(self, url, headers=None):
        if url.startswith("data:") or self._in_folder(url):
            return super().fetch(url, headers)
        self.blocked.append(url[:200])
        raise BlockedURLError(f"URL not allowed: {url[:200]}")

    def _in_folder(self, url):
        if not url.startswith("file:"):
            return False
        # resolve() removes "..", and follows links to their real place.
        path = Path(unquote(urlsplit(url).path)).resolve()
        return path.is_relative_to(self.folder) and path.is_file()


@dataclass
class RenderResult:
    pdf: bytes
    pages: int
    seconds: float  # time of the render in the child process
    peak_memory_mb: float  # peak resident memory of the child process
    blocked: list[str]  # URLs that the fetcher did not load


class RenderError(Exception):
    """The render failed. The status is the HTTP status for the API."""

    def __init__(self, message, status=500):
        super().__init__(message)
        self.status = status


def _render_in_child(conn, html, base_url, memory_mb, max_pages):
    """Run in the child process and send one tuple to the parent."""
    try:
        if memory_mb:
            limit = memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
        start = time.perf_counter()
        fetcher = SafeURLFetcher()
        document = HTML(string=html, base_url=base_url, url_fetcher=fetcher).render()
        pages = len(document.pages)
        if pages > max_pages:
            conn.send(("error", 422, f"The PDF has {pages} pages. The limit is {max_pages}."))
            return
        pdf = document.write_pdf()
        seconds = time.perf_counter() - start
        peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # KiB on Linux
        conn.send(("ok", pdf, pages, seconds, peak_mb, fetcher.blocked))
    except MemoryError:
        conn.send(("error", 500, "The render needs more memory than RENDER_MEMORY_MB."))
    except Exception as error:
        conn.send(("error", 500, f"{type(error).__name__}: {error}"))
    finally:
        conn.close()


# The fork server imports this module, and WeasyPrint with it, one time.
# Each render process is a copy of the fork server, so it starts fast.
_context = multiprocessing.get_context("forkserver")
_context.set_forkserver_preload([__name__])


def render_pdf(html, base_url=STATIC_DIR):
    """Render HTML to PDF in a new process. Block until the PDF is ready."""
    timeout = RENDER_TIMEOUT_SECONDS
    receiver, sender = _context.Pipe(duplex=False)
    process = _context.Process(
        target=_render_in_child,
        args=(sender, html, str(base_url), RENDER_MEMORY_MB, MAX_PAGES),
        daemon=True,
    )
    process.start()
    sender.close()  # the child has its own copy
    try:
        if not receiver.poll(timeout):
            raise RenderError(f"The render took longer than {timeout:g} seconds.", 504)
        try:
            result = receiver.recv()
        except EOFError:
            raise RenderError("The render process stopped without a result.") from None
    finally:
        receiver.close()
        process.kill()  # no effect if the process ended already
        process.join()
    if result[0] == "error":
        raise RenderError(result[2], result[1])
    _, pdf, pages, seconds, peak_mb, blocked = result
    return RenderResult(pdf, pages, seconds, peak_mb, blocked)
