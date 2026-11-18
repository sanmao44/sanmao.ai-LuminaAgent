import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { isSvgImageBytes } = createTsRequire(process.cwd())('./lib/svg-image');

test('identifies UTF-8 SVG roots with BOM, XML declaration and comments', () => {
  assert.equal(isSvgImageBytes(Buffer.from('\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated -->\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')), true);
  assert.equal(isSvgImageBytes(Buffer.from('<html><svg/></html>')), false);
  assert.equal(isSvgImageBytes(Buffer.from('<svg-model/>')), false);
});

test('rejects external XML entities and executable SVG elements or handlers', () => {
  const unsafe = [
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg>&x;</svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><?xml-stylesheet href="https://remote.example/style.css"?></svg>',
  ];
  for (const value of unsafe) assert.equal(isSvgImageBytes(Buffer.from(value)), false, value);
});
