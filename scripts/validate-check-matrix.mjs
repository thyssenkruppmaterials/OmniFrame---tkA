#!/usr/bin/env node
/**
 * Validates that required-check-matrix.md CI job names match ci.yml job definitions.
 * Detects drift between documentation and actual workflow.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')

const ciYml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
const matrixMd = readFileSync(join(ROOT, 'docs/quality/required-check-matrix.md'), 'utf8')

const yamlJobSection = ciYml.split(/^jobs:\s*$/m)[1] || ''
const yamlJobRegex = /^  ([\w][\w-]*):\s*$/gm
const ciJobs = new Set()
let match
while ((match = yamlJobRegex.exec(yamlJobSection)) !== null) {
  ciJobs.add(match[1])
}

const matrixTableSection = matrixMd.split('## CI Jobs')[1]?.split('##')[0] || ''
const mdJobRegex = /\|\s*`([\w-]+)`\s*\|/g
const matrixJobs = new Set()
while ((match = mdJobRegex.exec(matrixTableSection)) !== null) {
  matrixJobs.add(match[1])
}

let exitCode = 0

for (const job of matrixJobs) {
  if (!ciJobs.has(job)) {
    console.error(`DRIFT: Matrix references job "${job}" but ci.yml does not define it`)
    exitCode = 1
  }
}

for (const job of ciJobs) {
  if (!matrixJobs.has(job)) {
    console.warn(`NOTE: ci.yml defines job "${job}" not documented in matrix`)
  }
}

if (exitCode === 0) {
  console.log(`✅ Matrix validation passed: ${matrixJobs.size} documented jobs match ci.yml definitions`)
} else {
  console.error('❌ Matrix drift detected — update docs/quality/required-check-matrix.md')
}

process.exit(exitCode)
