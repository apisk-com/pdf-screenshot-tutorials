"""Render an HTML file to PDF with WeasyPrint.

Usage: python render_weasyprint.py document/invoice.html out/weasyprint.pdf
"""
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

from weasyprint import HTML
from weasyprint.urls import URLFetcher


class FolderFetcher(URLFetcher):
    """Load files from one folder only, like wkhtmltopdf --allow <folder>."""

    def __init__(self, folder):
        # file: and data: URLs only, so the render makes no network requests.
        super().__init__(allowed_protocols={'file', 'data'}, timeout=5)
        self.folder = Path(folder).resolve()

    def fetch(self, url, headers=None):
        if url.startswith('file:'):
            path = Path(unquote(urlsplit(url).path)).resolve()
            if not path.is_relative_to(self.folder):
                raise ValueError(f'Blocked file outside {self.folder}: {path}')
        return super().fetch(url, headers)


def render_pdf(input_path, media_type='print'):
    """Return the PDF bytes for an HTML file."""
    input_path = Path(input_path).resolve()
    html = HTML(
        filename=input_path,
        url_fetcher=FolderFetcher(input_path.parent),
        media_type=media_type,  # 'print' is the same as --print-media-type
    )
    return html.write_pdf()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Usage: python render_weasyprint.py <input.html> <output.pdf>')
    pdf = render_pdf(sys.argv[1])
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(pdf)
    print(f'Wrote {output} ({len(pdf)} bytes)')
