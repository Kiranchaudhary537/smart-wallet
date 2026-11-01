import { existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
const localTools = resolve('.tools/bin');
const env = { ...process.env, PATH: existsSync(`${localTools}/cargo-build-sbf`) ? `${localTools}${delimiter}${process.env.PATH}` : process.env.PATH };
const version = spawnSync('cargo-build-sbf', ['--version'], { env, encoding: 'utf8' });
const major = Number(version.stdout?.match(/(?:cargo-build-sbf|solana-cargo-build-sbf)\s+(\d+)/)?.[1]);
if (!major || major < 4) {
  console.error('cargo-build-sbf 4.x is required for platform-tools v1.54. Run npm run tools:setup.');
  process.exit(1);
}
const result = spawnSync('cargo', ['build-sbf', '--manifest-path', 'programs/smart_wallet/Cargo.toml', '--tools-version', 'v1.54'], { env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
