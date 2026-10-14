// Before every run: put the local demo data back as seeded (scripts/seed_demo.py --reset),
// so earlier runs, the smoke script or manual clicking never change what the tests see.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './demo.js'

export const PYTHON = [
  path.join(REPO_ROOT, '.venv', 'bin', 'python'),
  path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe'),
].find((candidate) => fs.existsSync(candidate)) ?? 'python'

export default function globalSetup() {
  try {
    // The script prints only counts and e-mail addresses, never a password.
    const out = execFileSync(PYTHON, [path.join('scripts', 'seed_demo.py'), '--reset'],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    console.log(out.split('\n').find((line) => line.startsWith('Seeded demo')) ?? 'Demo data reset.')
  } catch (error) {
    throw new Error(`Re-seeding the demo failed: ${(error.stderr || error.message).trim()}`, { cause: error })
  }
}
