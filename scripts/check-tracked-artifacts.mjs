import { execSync } from 'node:child_process';

const FORBIDDEN_PATTERNS = [
  /\.new$/,
  /\.temp$/,
  /\.backup$/,
  /\.bak$/,
  /\.orig$/,
  /^node_modules_old\//,
  /^env\.local\.temp$/,
  /^\.env_temp$/,
  /^\.env_clean$/,
];

const trackedFiles = execSync('git ls-files', { encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean);

const violations = trackedFiles.filter((file) =>
  FORBIDDEN_PATTERNS.some((pattern) => pattern.test(file))
);

if (violations.length > 0) {
  console.error(
    `Found ${violations.length} tracked artifact(s) that should not be in the repository:`
  );
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
} else {
  console.log('No forbidden artifacts found in tracked files.');
  process.exit(0);
}
