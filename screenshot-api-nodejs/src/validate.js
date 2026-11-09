// Turns the query string of GET /screenshot into screenshot options.

const FORMATS = ['png', 'jpeg', 'webp'];

// An error that the API returns to the client with status 400.
export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

export function parseScreenshotRequest(query) {
  const format = query.format ?? 'png';
  if (!FORMATS.includes(format)) {
    throw badRequest('"format" must be png, jpeg or webp.');
  }
  if (format === 'png' && query.quality !== undefined) {
    throw badRequest('"quality" works only with jpeg and webp.');
  }

  return {
    url: parseUrl(query.url),
    width: parseNumber(query.width, 'width', { min: 320, max: 1920, fallback: 1280, integer: true }),
    height: parseNumber(query.height, 'height', { min: 240, max: 1920, fallback: 800, integer: true }),
    scale: parseNumber(query.scale, 'scale', { min: 0.25, max: 3, fallback: 1 }),
    format,
    quality: format === 'png'
      ? undefined
      : parseNumber(query.quality, 'quality', { min: 1, max: 100, fallback: 80, integer: true }),
    fullPage: parseBoolean(query.fullPage, 'fullPage'),
    store: parseBoolean(query.store, 'store'),
  };
}

function parseUrl(value) {
  if (typeof value !== 'string' || value === '') {
    throw badRequest('"url" is required.');
  }
  if (value.length > 2048) {
    throw badRequest('"url" is longer than 2048 characters.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('"url" must be an absolute URL.');
  }
  // This blocks file:, data:, javascript: and chrome: URLs. It is NOT protection against SSRF.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('"url" must start with http:// or https://.');
  }
  return url.href;
}

function parseNumber(value, name, { min, max, fallback, integer = false }) {
  if (value === undefined) return fallback;
  const number = Number(value);
  // A repeated parameter (?width=1&width=2) arrives as an array: reject it too.
  const valid = typeof value === 'string' && value.trim() !== '' && Number.isFinite(number)
    && (!integer || Number.isInteger(number)) && number >= min && number <= max;
  if (!valid) {
    throw badRequest(`"${name}" must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
  }
  return number;
}

function parseBoolean(value, name) {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw badRequest(`"${name}" must be true or false.`);
}
