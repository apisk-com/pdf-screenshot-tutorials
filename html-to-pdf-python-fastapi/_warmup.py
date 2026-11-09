# TEMPORARY prototype: render once in the fork server.
from weasyprint import HTML
HTML(string="<p>warm</p>").write_pdf()
