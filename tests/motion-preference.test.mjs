import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const component = fs.readFileSync(path.join(root, 'components', 'MotionPreference.tsx'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'app', 'layout.tsx'), 'utf8');

test('motion is forced on by default so a reduced-motion policy cannot freeze the canvas', () => {
  assert.match(component, /sanmao-motion-preference/);
  assert.match(component, /window\.localStorage\.getItem\(STORAGE_KEY\) === 'off' \? 'off' : 'on'/);
  assert.match(component, /document\.documentElement\.dataset\.motion = value/);
  assert.match(layout, /dataset\.motion = motion === 'off' \? 'off' : 'on'/);
});

test('the reduced-motion compatibility notice is removed', () => {
  assert.doesNotMatch(component, /motion-compat-notice/);
  assert.match(component, /return null;/);
  assert.equal(fs.existsSync(path.join(root, 'app', 'motion.css')), false);
  assert.doesNotMatch(layout, /import '\.\/motion\.css';/);
});

test('every prefers-reduced-motion rule stays behind the data-motion guard', () => {
  const files = fs.readdirSync(path.join(root, 'app')).filter((name) => name.endsWith('.css'));
  assert.ok(files.length >= 8, 'app stylesheets should be scanned');
  const unguarded = [];
  for (const name of files) {
    const css = fs.readFileSync(path.join(root, 'app', name), 'utf8');
    const media = /@media[^{]*prefers-reduced-motion[^{]*\{/g;
    let match;
    while ((match = media.exec(css))) {
      let depth = 0;
      let end = -1;
      for (let index = match.index + match[0].length - 1; index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        else if (css[index] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = index;
            break;
          }
        }
      }
      const block = css.slice(match.index, end + 1);
      if (!block.includes('data-motion')) unguarded.push(`${name}:${css.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(unguarded, [], 'reduce-motion rules must be prefixed with html:not([data-motion="on"])');
});
