"""Render each test document with WeasyPrint, without and with its fix,
and compare the pages with cases/cases.json."""
import io
import json
import re
from pathlib import Path

import pytest
from pypdf import PdfReader

from render_weasyprint import add_css, render_pdf

ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((ROOT / 'cases' / 'cases.json').read_text(encoding='utf-8'))


def observe(pdf, keys):
    """For each key: the pages with that text, or the page orientations."""
    pages = PdfReader(io.BytesIO(pdf)).pages
    texts = [re.sub(r'\s+', ' ', page.extract_text()) for page in pages]
    result = {}
    for key in keys:
        if key == 'orientation':
            result[key] = ['landscape' if p.mediabox.width > p.mediabox.height else 'portrait' for p in pages]
        else:
            result[key] = [i + 1 for i, text in enumerate(texts) if key in text]
    return result


@pytest.mark.parametrize('case', CASES, ids=[c['id'] for c in CASES])
def test_case(case):
    html = (ROOT / case['file']).read_text(encoding='utf-8')
    expected = case['weasyprint']
    observed = {'without': observe(render_pdf(html), expected['without'])}
    if 'with' in expected:
        fix = (ROOT / case['fixFile']).read_text(encoding='utf-8') if 'fixFile' in case else case['fix']
        observed['with'] = observe(render_pdf(add_css(html, fix)), expected['with'])
    assert observed == expected
