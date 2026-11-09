"""Render an HTML file to PDF with WeasyPrint.

Usage: python render_weasyprint.py <input.html> <output.pdf> [extra.css]
"""
import sys
from pathlib import Path

from weasyprint import HTML
from weasyprint.urls import URLFetcher


def add_css(html, css):
    """Put a stylesheet at the end of <head>, after the page CSS."""
    if not css:
        return html
    return html.replace('</head>', f'<style>\n{css}\n</style>\n</head>', 1)


def render_pdf(html):
    """Return the PDF bytes for an HTML string."""
    # The documents need no files and no network: allow data: URLs only.
    fetcher = URLFetcher(allowed_protocols={'data'})
    return HTML(string=html, url_fetcher=fetcher).write_pdf()


if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        sys.exit('Usage: python render_weasyprint.py <input.html> <output.pdf> [extra.css]')
    css = Path(sys.argv[3]).read_text(encoding='utf-8') if len(sys.argv) == 4 else ''
    html = add_css(Path(sys.argv[1]).read_text(encoding='utf-8'), css)
    pdf = render_pdf(html)
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(pdf)
    print(f'Wrote {output} with WeasyPrint ({len(pdf)} bytes)')
