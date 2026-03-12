import { readFileSync } from 'node:fs';

const FORBIDDEN_VAR = 'VITE_SUPABASE_SERVICE_ROLE_KEY';
const ENV_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.test.local',
];

let found = false;

if (process.env[FORBIDDEN_VAR]) {
  console.error(
    `::error::${FORBIDDEN_VAR} is defined in the current environment. ` +
      'This secret must never be exposed to the client bundle.'
  );
  found = true;
}

for (const file of ENV_FILES) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }

  const match = content
    .split('\n')
    .find(
      (line) =>
        line.startsWith(`${FORBIDDEN_VAR}=`) &&
        line.slice(FORBIDDEN_VAR.length + 1).trim() !== ''
    );

  if (match) {
    console.error(
      `::error::${FORBIDDEN_VAR} is set to a non-empty value in ${file}. ` +
        'This secret must never be exposed to the client bundle.'
    );
    found = true;
  }
}

if (found) {
  process.exit(1);
}

console.log(`✅ ${FORBIDDEN_VAR} not found in environment or env files.`);
process.exit(0);
