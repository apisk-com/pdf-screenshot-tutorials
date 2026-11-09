"""Each test checks one row of the wkhtmltopdf to WeasyPrint mapping table."""
import io
import re
import subprocess
import tempfile
from pathlib import Path

import pytest
from pypdf import PdfReader
from weasyprint import CSS, HTML

from render_weasyprint import FolderFetcher, render_pdf

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / 'test' / 'fixtures'
MM = 72 / 25.4  # points in one millimetre


def save_temp(pdf):
    file = Path(tempfile.mkdtemp()) / 'test.pdf'
    file.write_bytes(pdf)
    return str(file)


def text(pdf):
    return subprocess.run(['pdftotext', '-layout', save_temp(pdf), '-'],
                          capture_output=True, text=True, check=True).stdout


def fonts(pdf):
    return subprocess.run(['pdffonts', save_temp(pdf)],
                          capture_output=True, text=True, check=True).stdout


def word_box(pdf, word):
    """Position in points of the first matching word on page 1."""
    xml = subprocess.run(['pdftotext', '-bbox', '-f', '1', '-l', '1', save_temp(pdf), '-'],
                         capture_output=True, text=True, check=True).stdout
    match = re.search(rf'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">{word}<', xml)
    return dict(zip(['x_min', 'y_min', 'x_max', 'y_max'], map(float, match.groups())))


def pixel(pdf, x, y):
    """RGB color of one pixel on page 1 at 72 dpi (1 pixel = 1 point)."""
    ppm = subprocess.run(['pdftoppm', '-r', '72', '-f', '1', '-l', '1', '-singlefile', save_temp(pdf)],
                         capture_output=True, check=True).stdout
    header = ppm.split(b'\n', 3)  # P6, width height, maxval, data
    width = int(header[1].split()[0])
    data = header[3]
    i = (width * y + x) * 3
    return tuple(data[i:i + 3])


def reader(pdf):
    return PdfReader(io.BytesIO(pdf))


def render_fixture(name, css=None, **options):
    html = HTML(filename=FIXTURES / name, url_fetcher=FolderFetcher(FIXTURES))
    stylesheets = [CSS(string=css)] if css else None
    return html.write_pdf(stylesheets=stylesheets, **options)


def test_invoice_renders_as_a4_with_page_numbers_and_header():
    pdf = render_pdf(ROOT / 'document' / 'invoice.html')
    assert pdf.startswith(b'%PDF-')
    pages = reader(pdf).pages
    count = len(pages)
    assert count >= 2
    assert round(float(pages[0].mediabox.width)) == 595
    assert round(float(pages[0].mediabox.height)) == 842
    content = text(pdf)
    assert f'Page 1 of {count}' in content
    assert f'Page {count} of {count}' in content
    assert len(re.findall(r'^\s*Lumen Data Ltd\s*$', content, re.M)) == count
    assert 'Pay online' not in content  # print media hides the button
    assert 'Inter' in fonts(pdf)  # the local web font loaded


def test_default_page_is_a4_with_75px_margins():
    pdf = render_fixture('plain.html')
    page = reader(pdf).pages[0]
    assert round(float(page.mediabox.width)) == 595
    assert abs(word_box(pdf, 'TOPLEFT')['x_min'] - 75 * 0.75) < 2  # 75px = 56.25pt


def test_landscape_with_css_page_size():
    pdf = render_fixture('plain.html', css='@page { size: A4 landscape }')
    page = reader(pdf).pages[0]
    assert float(page.mediabox.width) > float(page.mediabox.height)


def test_margins_with_css_page_margin():
    pdf = render_fixture('plain.html', css='@page { margin: 20mm 15mm }')
    box = word_box(pdf, 'TOPLEFT')
    assert abs(box['x_min'] - 15 * MM) < 2
    assert 20 * MM < box['y_min'] < 20 * MM + 20


def test_footer_with_page_counters_in_a_margin_box():
    css = '@page { @bottom-center { content: counter(page) "/" counter(pages) } }'
    pdf = render_fixture('long.html', css=css)
    count = len(reader(pdf).pages)
    assert count >= 2
    content = text(pdf)
    assert re.search(rf'\b1/{count}\b', content)
    assert re.search(rf'\b{count}/{count}\b', content)


def test_html_header_with_a_running_element():
    css = ('header { position: running(pageHeader) }'
           '@page { @top-left { content: element(pageHeader) } }')
    blocks = ''.join(f'<p style="height: 20mm">Block {n}</p>' for n in range(20))
    html = HTML(string=f'<header><b>Lumen</b> Data Ltd</header>{blocks}', base_url=str(FIXTURES),
                url_fetcher=FolderFetcher(FIXTURES))
    pdf = html.write_pdf(stylesheets=[CSS(string=css)])
    count = len(reader(pdf).pages)
    assert count >= 2
    assert text(pdf).count('Lumen Data Ltd') == count


def test_print_media_is_the_default_and_screen_is_an_option():
    print_text = text(render_fixture('plain.html'))
    assert 'PRINTTEXT' in print_text and 'SCREENTEXT' not in print_text
    html = HTML(filename=FIXTURES / 'plain.html', media_type='screen', url_fetcher=FolderFetcher(FIXTURES))
    screen_text = text(html.write_pdf())
    assert 'SCREENTEXT' in screen_text and 'PRINTTEXT' not in screen_text


def test_backgrounds_print_by_default():
    pdf = render_fixture('plain.html')
    assert pixel(pdf, 100, 150) == (200, 0, 0)


def test_zoom_also_scales_the_page_size():
    pdf = render_fixture('plain.html', zoom=1.25)
    page = reader(pdf).pages[0]
    assert round(float(page.mediabox.width)) == round(595.28 * 1.25)


def test_javascript_does_not_run():
    content = text(render_fixture('delayed.html'))
    assert 'LOADING' in content
    assert 'CHARTREADY' not in content


def test_folder_fetcher_allows_files_in_the_folder_only():
    fetcher = FolderFetcher(ROOT / 'document')
    fetcher.fetch((ROOT / 'document' / 'page.css').as_uri()).close()
    with pytest.raises(ValueError, match='outside'):
        fetcher.fetch('file:///etc/hostname')
    with pytest.raises(ValueError, match='disallowed protocol'):
        fetcher.fetch('http://169.254.169.254/latest/meta-data/')
    # The WOFF2 font of this fixture is outside its folder: blocked, so a fallback font is used.
    assert 'Inter' not in fonts(render_fixture('outside-font.html'))
    # With the repo folder allowed, the same WOFF2 font loads.
    html = HTML(filename=FIXTURES / 'outside-font.html', url_fetcher=FolderFetcher(ROOT))
    assert 'Inter' in fonts(html.write_pdf())


def test_headings_become_bookmarks():
    outline = reader(render_fixture('plain.html')).outline
    assert outline[0].title == 'Heading one'


def test_flex_and_grid_items_share_one_line_and_margin_boxes_print():
    pdf = render_fixture('modern-css.html')
    assert word_box(pdf, 'FLEXA')['y_min'] == word_box(pdf, 'FLEXC')['y_min']
    assert word_box(pdf, 'GRIDA')['y_min'] == word_box(pdf, 'GRIDC')['y_min']
    assert 'MARGINBOXTEXT' in text(pdf)
