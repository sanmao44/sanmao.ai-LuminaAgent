import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/mcp/browser-editors.ts', import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {browserEditorHints, BROWSER_EDITOR_PROBE} = await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

test('probe traverses nested shadow roots, returns verified targets without reading user values', () => {
  const editor = {localName:'div',tagName:'DIV',id:'editor',isContentEditable:true,parentElement:null,getClientRects:()=>[{}],getAttribute:()=>null};
  Object.defineProperty(editor,'value',{get(){throw new Error('must not read values')}});
  const shadow = {querySelectorAll:s=>s==='div#editor'?[editor]:s==='*'?[editor]:[editor]};
  const host = {localName:'custom-editor',id:'host',shadowRoot:shadow,parentElement:null,getClientRects:()=>[{}]};
  shadow.host=host;
  const doc = {querySelectorAll:s=>s==='*'?[host]:[]};
  const probe = new Function('document','CSS','getComputedStyle','location','return ('+BROWSER_EDITOR_PROBE+')()');
  const result = probe(doc,{escape:v=>v},()=>({visibility:'visible'}),{href:'https://example.test/'});
  assert.equal(result.sanmaoEditors[0].target,'custom-editor#host div#editor');
  assert.equal(result.sanmaoEditors[0].shadowHost,'custom-editor');
  assert.equal('value' in result.sanmaoEditors[0],false);
});

test('hints only accept bounded probe output; no scripts or field values are included',()=>{
  assert.equal(browserEditorHints('### Result []'),'');
  assert.equal(browserEditorHints('### Result not-json'),'');
  assert.equal(browserEditorHints('### Result {"sanmaoEditors":[]}'),'');
  const hint = browserEditorHints('### Result '+JSON.stringify({sanmaoEditors:[{target:'custom-editor div#editor',tag:'div',contenteditable:true,label:'评论',shadowHost:'custom-editor',value:'secret'}]})+'\n### Ran Playwright code\nsecret');
  assert.match(hint,/custom-editor div#editor/);
  assert.doesNotMatch(hint,/secret/);
});
