import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

// The static build keeps module URLs stable and emits no TypeScript or source maps.
export async function emitBrowserModule(source: string, output: string) {
  const result = ts.transpileModule(await readFile(source, 'utf8'), {
    fileName: source,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      rewriteRelativeImportExtensions: true,
    },
  });
  await writeFile(output, result.outputText);
}
