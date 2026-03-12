/**
 * Cache Clearing Script
 * Clears build artifacts and cache files for clean deployments
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('🧹 Clearing cache and build artifacts...')

// Directories to clean
const cleanDirs = [
  'dist',
  '.vite',
  'node_modules/.vite',
  'node_modules/.cache'
]

// Files to clean
const cleanFiles = [
  'dist/**/*',
  '.vite/**/*',
  'node_modules/.vite/**/*',
  'node_modules/.cache/**/*'
]

let cleanedItems = 0
let cleanedSize = 0

// Function to get directory size
function getDirectorySize(dirPath) {
  let size = 0
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const file of files) {
      const filePath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        size += getDirectorySize(filePath)
      } else {
        size += fs.statSync(filePath).size
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  return size
}

// Function to remove directory recursively
function removeDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const size = getDirectorySize(dirPath)
      fs.rmSync(dirPath, { recursive: true, force: true })
      cleanedItems++
      cleanedSize += size
      console.log(`   🗑️  Removed: ${dirPath} (${formatBytes(size)})`)
    }
  } catch (error) {
    console.warn(`   ⚠️  Failed to remove: ${dirPath} - ${error.message}`)
  }
}

// Function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Clean directories
console.log('📁 Cleaning directories...')
cleanDirs.forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir)
  removeDirectory(fullPath)
})

// Clean specific files
console.log('📄 Cleaning files...')
cleanFiles.forEach(pattern => {
  // Simple glob implementation for common patterns
  const basePath = path.join(__dirname, '..')
  const parts = pattern.split('/**/*')
  if (parts.length === 2) {
    const dirPath = path.join(basePath, parts[0])
    try {
      if (fs.existsSync(dirPath)) {
        removeDirectory(dirPath)
      }
    } catch (error) {
      // Ignore errors for file cleaning
    }
  }
})

// Clean package manager caches
console.log('📦 Cleaning package manager caches...')
const packageLockPath = path.join(__dirname, '..', 'package-lock.json')
const yarnLockPath = path.join(__dirname, '..', 'yarn.lock')
const pnpmLockPath = path.join(__dirname, '..', 'pnpm-lock.yaml')

if (fs.existsSync(packageLockPath)) {
  try {
    // This would clear npm cache in a real deployment
    console.log('   📦 Would clear npm cache (run: npm cache clean --force)')
  } catch (error) {
    console.warn('   ⚠️  Failed to clear npm cache')
  }
}

console.log('')
console.log('✅ Cache clearing completed!')
console.log(`   Items cleaned: ${cleanedItems}`)
console.log(`   Space freed: ${formatBytes(cleanedSize)}`)
console.log('')
console.log('💡 Next steps:')
console.log('   1. Run: npm install')
console.log('   2. Run: npm run build:cache-bust')
console.log('   3. Deploy the updated dist/ directory')
console.log('')
console.log('🔄 For production deployments, also consider:')
console.log('   - Clearing CDN cache if using one')
console.log('   - Updating service worker version')
console.log('   - Notifying users of the update')
