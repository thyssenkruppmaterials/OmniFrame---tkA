import { lstatSync } from 'node:fs'

/** Prettier rejects explicitly passed symlink paths — skip them in pre-commit. */
function filterSymlinks(files) {
  return files.filter((file) => {
    try {
      return !lstatSync(file).isSymbolicLink()
    } catch {
      return false
    }
  })
}

export default {
  '*.{ts,tsx}': ['eslint --fix --no-warn-ignored', 'prettier --write'],
  '*.md': (files) => {
    const writable = filterSymlinks(files)
    return writable.length > 0 ? [`prettier --write ${writable.map((f) => JSON.stringify(f)).join(' ')}`] : []
  },
}
