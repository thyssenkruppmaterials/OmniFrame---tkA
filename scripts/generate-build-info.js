/**
 * Build Info Generation Script
 * Generates version and build information for cache busting
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get package version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const version = packageJson.version

// Generate build info
const buildInfo = {
  version: version,
  buildTime: new Date().toISOString(),
  buildId: Date.now().toString(36) + Math.random().toString(36).substr(2),
  cacheBust: Math.random().toString(36).substr(2, 9),
  environment: process.env.NODE_ENV || 'development'
}

// Write to dist directory
const distDir = path.join(__dirname, '..', 'dist')
const buildInfoPath = path.join(distDir, 'build-info.json')

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

// Write build info
fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2))

console.log('✅ Build info generated:')
console.log(`   Version: ${buildInfo.version}`)
console.log(`   Build ID: ${buildInfo.buildId}`)
console.log(`   Cache Bust: ${buildInfo.cacheBust}`)
console.log(`   File: ${buildInfoPath}`)

// Also update the service worker cache ID in the built files
const swPath = path.join(distDir, 'sw.js')
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8')
  swContent = swContent.replace(/cacheId: '[^']*'/, `cacheId: 'onebox-ai-v${buildInfo.buildId}'`)
  fs.writeFileSync(swPath, swContent)
  console.log('✅ Service worker cache ID updated')
}
