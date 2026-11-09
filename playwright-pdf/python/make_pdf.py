"""Render an HTML file to PDF with the Playwright sync API.

Usage: python make_pdf.py <input.html> <output.pdf> [print|screen]
"""

import sys
from pathlib import Path

from playwright.sync_api import Browser, sync_playwright

TEXT_STYLE = "font: 9px Arial, sans-serif; width: 100%; margin: 0 14mm; color: #52606d;"

PDF_OPTIONS = {
    "format": "A4",
    "margin": {"top": "20mm", "right": "14mm", "bottom": "18mm", "left": "14mm"},
    "print_background": True,
    "display_header_footer": True,
    "header_template": f'<div style="{TEXT_STYLE}"><span class="title"></span></div>',
    "footer_template": (
        f'<div style="{TEXT_STYLE} text-align: right;">'
        'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
    ),
    "outline": True,
    "tagged": True,
}


def html_to_pdf(browser: Browser, html: str, media: str = "print") -> bytes:
    context = browser.new_context()
    try:
        page = context.new_page()
        page.set_default_timeout(15_000)
        page.emulate_media(media=media)
        page.set_content(html, wait_until="load")
        page.evaluate("document.fonts.ready.then(() => true)")
        return page.pdf(**PDF_OPTIONS)
    finally:
        context.close()


def main() -> None:
    args = sys.argv[1:]
    source = Path(args[0] if len(args) > 0 else "../report.html")
    target = Path(args[1] if len(args) > 1 else "out/report.pdf")
    media = args[2] if len(args) > 2 else "print"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            pdf = html_to_pdf(browser, source.read_text(encoding="utf-8"), media)
        finally:
            browser.close()

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(pdf)
    print(f"Wrote {target} ({len(pdf) // 1024} KB, {media} media)")


if __name__ == "__main__":
    main()
