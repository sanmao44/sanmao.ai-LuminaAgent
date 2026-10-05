import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTsRequire } from './ts-require.mjs';

const AdminLogin = createTsRequire(new URL('../components', import.meta.url).pathname)('./AdminLogin').default;
const Icon = ({ name, size }) => createElement('i', { 'data-icon': name, 'data-size': size });

test('admin login keeps password and submit callbacks at the page boundary', () => {
  const markup = renderToStaticMarkup(createElement(AdminLogin, {
    password: 'secret',
    busy: false,
    Icon,
    onPasswordChange: () => {},
    onSubmit: () => {},
  }));
  assert.match(markup, /class="admin-login-page"/);
  assert.match(markup, /class="admin-login surface"/);
  assert.match(markup, /data-icon="model"/);
  assert.match(markup, /value="secret"/);
  assert.match(markup, />进入管理<\/button>/);
});

test('admin login disables an empty or busy submission', () => {
  const emptyMarkup = renderToStaticMarkup(createElement(AdminLogin, {
    password: '',
    busy: false,
    Icon,
    onPasswordChange: () => {},
    onSubmit: () => {},
  }));
  const busyMarkup = renderToStaticMarkup(createElement(AdminLogin, {
    password: 'secret',
    busy: true,
    Icon,
    onPasswordChange: () => {},
    onSubmit: () => {},
  }));
  assert.match(emptyMarkup, /disabled=""/);
  assert.match(busyMarkup, /disabled=""/);
  assert.match(busyMarkup, />验证中…<\/button>/);
});
