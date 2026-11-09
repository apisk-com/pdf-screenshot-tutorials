"""Measure the render of one document: time and peak memory.

Usage: python bench.py [runs]
"""

import json
import statistics
import sys
import time
from pathlib import Path

from app.main import Invoice, invoice_html
from app.render import render_pdf


def measure(html, runs):
    totals, renders, memory = [], [], []
    for _ in range(runs):
        start = time.perf_counter()
        result = render_pdf(html)
        totals.append(time.perf_counter() - start)
        renders.append(result.seconds)
        memory.append(result.peak_memory_mb)
    return result, statistics.median(renders), statistics.median(totals), max(memory)


def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    data = json.loads((Path(__file__).parent / "examples" / "invoice.json").read_text())
    documents = [("Empty page", "<p>Hi</p>"), ("Invoice", invoice_html(Invoice.model_validate(data)))]
    render_pdf("<p>Start</p>")  # start the fork server
    for name, html in documents:
        result, render_s, total_s, peak_mb = measure(html, runs)
        print(f"{name}: {result.pages} pages, {len(result.pdf):,} bytes, median of {runs} runs")
        print(f"  render in the child process: {render_s * 1000:.0f} ms")
        print(f"  render_pdf() call, with process start: {total_s * 1000:.0f} ms")
        print(f"  peak memory of the child process: {peak_mb:.0f} MB")


# Each render process imports the main module. Without this check, it runs main() again.
if __name__ == "__main__":
    main()
