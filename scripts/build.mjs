import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const nuxtCli = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url))
const child = spawn(process.execPath, [nuxtCli, 'build'], { stdio: ['inherit', 'pipe', 'pipe'] })
let output = ''

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    output += chunk
    ;(stream === child.stdout ? process.stdout : process.stderr).write(chunk)
  })
}

child.on('error', (error) => {
  console.error(`Nuxt build could not start: ${error.message}`)
  process.exitCode = 1
})

child.on('close', (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1
    return
  }

  const diagnostics = output.match(/\bWARN\b|\bWARNING\b|\[PLUGIN_TIMINGS\]|\[vite\]\s*warning:|\bERROR\b/g)
  if (diagnostics) {
    console.error(`\nBuild completed with diagnostics (${diagnostics.length}); resolve them before accepting the build.`)
    process.exitCode = 1
    return
  }

  console.log('\nBuild completed without warnings or errors.')
})
