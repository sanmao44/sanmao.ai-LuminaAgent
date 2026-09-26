import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const content = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('app/page.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function elementProps(className) {
  const matches = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node) && node.properties.some((property) =>
      ts.isPropertyAssignment(property)
      && property.name.getText(source) === 'className'
      && ts.isStringLiteral(property.initializer)
      && property.initializer.text === className)) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, `Expected one ${className} element`);
  return matches[0];
}

function containingChildren(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isPropertyAssignment(parent) && parent.name.getText(source) === 'children') return parent;
  }
  assert.fail('Element must belong to a children property');
}

test('main page has balanced element calls and no syntax errors', () => {
  const diagnostics = source.parseDiagnostics.map((diagnostic) => {
    const position = source.getLineAndCharacterOfPosition(diagnostic.start);
    return `${position.line + 1}:${position.character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
  });
  assert.deepEqual(diagnostics, []);
});

test('MCP details sit below the composer footer, outside the send controls', () => {
  const composer = elementProps('agent-composer');
  const dock = elementProps('agent-mcp-detail-dock');
  const dockChildren = containingChildren(dock);
  assert.ok(dockChildren.parent === composer, 'MCP details must be a direct child of the composer');
  const footer = composer.properties.find((property) =>
    ts.isPropertyAssignment(property) && property.name.getText(source) === 'children')
    ?.initializer;
  assert.ok(footer && ts.isArrayLiteralExpression(footer));
  const footerElement = footer.elements.find((element) =>
    ts.isCallExpression(element) && element.arguments.some((argument) =>
      ts.isObjectLiteralExpression(argument) && argument.properties.some((property) =>
        ts.isPropertyAssignment(property) && property.name.getText(source) === 'className'
        && ts.isStringLiteral(property.initializer) && property.initializer.text === 'composer-footer')));
  assert.ok(footerElement, 'Composer footer must remain present');
  assert.ok(footerElement.end < dock.pos, 'MCP details must follow the footer');
});

test('GitHub MCP 安装追问会把最近仓库地址带进本轮请求', () => {
  assert.match(content, /isGithubMcpInstallFollowUp\(requestContent\)/);
  assert.match(content, /extractGithubRepositoryUrl\(githubInstallRepo\.content\)/);
  assert.match(content, /本轮安装目标仓库/);
});
