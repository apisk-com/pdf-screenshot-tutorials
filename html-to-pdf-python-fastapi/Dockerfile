FROM python:3.12-slim-trixie

# Pango and HarfBuzz for WeasyPrint, and one fallback font family.
# No Ghostscript: WeasyPrint 69 and earlier can pass EPS images to it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 libharfbuzz0b fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

# Do not render as root.
RUN useradd --create-home pdf
USER pdf
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
