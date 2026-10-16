import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'services/api/src')
const manifestPath = join(process.cwd(), 'services/api/package.json')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

function externalImports(filePath: string): string[] {
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true)
  const imports = new Set<string>()

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.add(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') &&
      node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
    ) {
      imports.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return [...imports].filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
}

describe('API runtime dependency manifest', () => {
  it('declares every external API source import as a production dependency', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const missing = new Set<string>()

    for (const filePath of sourceFiles(sourceRoot)) {
      for (const specifier of externalImports(filePath)) {
        const segments = specifier.split('/')
        const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
        if (!manifest.dependencies?.[packageName]) {
          missing.add(`${relative(process.cwd(), filePath)} imports ${packageName}`)
        }
      }
    }

    expect([...missing]).toEqual([])
  })
})
