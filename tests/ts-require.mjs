import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Windows 上 fileURLToPath 之外的 pathname 可能形如 "/C:/x"，path.isAbsolute 会误判并拼出畸形路径。
function normalizePath(target) {
  if (process.platform === 'win32' && /^[/\\][A-Za-z]:[/\\]/.test(target)) return target.slice(1);
  return target;
}

/**
 * 让“按 CommonJS 方式实例化 TS 模块”的测试也能解析项目内的相对 TS 依赖。
 * 返回值可直接当成 require 传给 new Function('require', ...)。
 */
export function createTsRequire(baseDir) {
  // Windows 上来自 fileURLToPath 之外的路径可能带前导斜杠，先归一化再解析依赖。
  const base = path.resolve(normalizePath(baseDir));
  const nodeRequire = createRequire(path.join(base, 'noop.cjs'));
  const cache = new Map();

  /**
   * 项目里用 tsconfig 的 `@/lib/...` 指项目内的模块，和 lib/ 的目录结构一一对应。
   * 装载器只认相对路径时，被实例化的模块一旦引入带别名的依赖（store.ts 引 approval.ts 就是），
   * 测试会崩在 MODULE_NOT_FOUND，而且报出来的是别名，看不出真正原因。
   */
  const aliasFile = (specifier) => (specifier.startsWith('@/lib/')
    ? `${path.join(base, normalizePath(specifier.slice('@/lib/'.length)))}.ts`
    : null);

  const load = (id) => {
    const normalized = normalizePath(id);
    const aliased = aliasFile(normalized);
    if (!aliased && !normalized.startsWith('.') && !path.isAbsolute(normalized)) return nodeRequire(id);
    const resolved = aliased || (path.isAbsolute(normalized) ? normalized : path.resolve(base, normalized));
    const file = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
    if (cache.has(file)) return cache.get(file).exports;
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;
    const module = { exports: {} };
    cache.set(file, module);
    const localRequire = (next) => {
      const normalizedNext = normalizePath(next);
      if (aliasFile(normalizedNext)) return load(normalizedNext);
      return normalizedNext.startsWith('.') || path.isAbsolute(normalizedNext)
        ? load(path.resolve(path.dirname(file), normalizedNext))
        : nodeRequire(normalizedNext);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
  };

  return load;
}
