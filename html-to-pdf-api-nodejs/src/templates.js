import { readFileSync } from 'node:fs';
import Handlebars from 'handlebars';

// A separate Handlebars instance: helpers added here do not leak to other code.
const handlebars = Handlebars.create();

function load(name) {
  const file = new URL(`../templates/${name}.hbs`, import.meta.url);
  // strict: a missing field stops the render instead of leaving a blank in the PDF.
  return handlebars.compile(readFileSync(file, 'utf8'), { strict: true });
}

// The templates are files in this repo. Never compile a template from a request.
export const templates = {
  invoice: load('invoice'),
};
