import { templates } from './templates.js';

const FORMATS = ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'];
// A number and a unit that Puppeteer understands, for example "15mm" or "0.5in".
const LENGTH = /^\d{1,3}(\.\d{1,2})?(mm|cm|in|px)$/;
const DEFAULT_MARGIN = '15mm';

// An error that the API returns to the client with status 400.
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Turns a request body into a render job: { html } or { url }, plus PDF options.
export function parsePdfRequest(body) {
  if (!isObject(body)) {
    throw badRequest('Send a JSON object with the header Content-Type: application/json.');
  }
  const sources = ['html', 'url', 'template'].filter((key) => body[key] !== undefined);
  if (sources.length !== 1) {
    throw badRequest('Send exactly one of "html", "url" or "template".');
  }
  const options = parseOptions(body.options ?? {});

  if (body.url !== undefined) {
    return { url: parseUrl(body.url), options };
  }
  if (body.template !== undefined) {
    return { html: renderTemplate(body.template, body.data ?? {}), options };
  }
  if (typeof body.html !== 'string' || body.html.trim() === '') {
    throw badRequest('"html" must be a string that is not empty.');
  }
  return { html: body.html, options };
}

function parseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('"url" must be an absolute URL.');
  }
  // This blocks file:, data: and other schemes. It is NOT protection against SSRF.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('"url" must start with http:// or https://.');
  }
  return url.href;
}

function renderTemplate(name, data) {
  if (typeof name !== 'string' || !Object.hasOwn(templates, name)) {
    throw badRequest(`"template" must be one of: ${Object.keys(templates).join(', ')}.`);
  }
  if (!isObject(data)) {
    throw badRequest('"data" must be a JSON object.');
  }
  try {
    return templates[name](data);
  } catch (error) {
    throw badRequest(`"data" does not match the template: ${error.message}`);
  }
}

// Copy only the options that we allow. Never pass request JSON to page.pdf():
// options such as "path" (write a file on the server) must stay out of reach.
function parseOptions(options) {
  if (!isObject(options)) {
    throw badRequest('"options" must be a JSON object.');
  }
  const {
    format = 'A4',
    landscape = false,
    printBackground = true,
    preferCSSPageSize = false,
    margin = {},
    ...unknown
  } = options;

  const unknownNames = Object.keys(unknown);
  if (unknownNames.length > 0) {
    throw badRequest(`Unknown option "${unknownNames[0]}".`);
  }
  if (!FORMATS.includes(format)) {
    throw badRequest(`"format" must be one of: ${FORMATS.join(', ')}.`);
  }
  for (const [name, value] of Object.entries({ landscape, printBackground, preferCSSPageSize })) {
    if (typeof value !== 'boolean') {
      throw badRequest(`"${name}" must be true or false.`);
    }
  }
  return { format, landscape, printBackground, preferCSSPageSize, margin: parseMargin(margin) };
}

function parseMargin(margin) {
  if (!isObject(margin)) {
    throw badRequest('"margin" must be a JSON object.');
  }
  const result = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const value = margin[side] ?? DEFAULT_MARGIN;
    if (typeof value !== 'string' || !LENGTH.test(value)) {
      throw badRequest(`"margin.${side}" must be a length such as "15mm" or "0.5in".`);
    }
    result[side] = value;
  }
  return result;
}
