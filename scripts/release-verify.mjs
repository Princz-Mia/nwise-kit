// Checks that the repository is in a state that may be released. It changes
// nothing and publishes nothing.
//
//   npm run release:verify                 check the manifest, changelog and tree
//   npm run release:verify -- --tag v1.2.3 also check the tag against the version
//
// A prerelease version (one with a hyphen, such as 0.1.0-alpha.1) belongs
// to the "next" channel; any other version belongs to "latest". In GitHub
// Actions the channel is written to the step outputs.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('package.json'));
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

const problems = [];
function check(ok, message) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) {
    problems.push(message);
  }
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** "git+https://github.com/Owner/repo.git" and "git@github.com:Owner/repo" both become "owner/repo". */
function repositorySlug(url) {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url ?? '');
  return match === null ? undefined : `${match[1]}/${match[2]}`.toLowerCase();
}

const version = String(manifest.version);
const channel = version.includes('-') ? 'next' : 'latest';

check(SEMVER.test(version), `version "${version}" is a semantic version`);
check(version !== '0.0.0', 'the version is not the 0.0.0 placeholder');
check(manifest.private !== true, 'the package is not marked private');
check(
  manifest.license === 'MIT' && existsSync(new URL('../LICENSE', import.meta.url)),
  'the MIT licence is declared and LICENSE exists',
);
check(
  !/YOUR_OWNER|YOUR_SCOPE|TESTED_VITEST_RANGE|TODO|FIXME/.test(JSON.stringify(manifest)),
  'the manifest has no placeholders',
);
check(typeof manifest.engines?.node === 'string', 'the supported Node.js range is declared');
check(
  manifest.peerDependencies?.vitest !== undefined &&
    manifest.peerDependenciesMeta?.vitest?.optional === true,
  'Vitest is an optional peer dependency',
);
check(
  Object.keys(manifest.dependencies ?? {}).length === 0,
  'there are no runtime dependencies to audit',
);
const hooks = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
];
check(
  hooks.every((hook) => manifest.scripts?.[hook] === undefined),
  'no lifecycle script runs on install, pack or publish',
);
check(
  manifest.publishConfig?.access === 'public' &&
    (manifest.publishConfig.tag === undefined || manifest.publishConfig.tag === channel),
  `publishConfig is public and agrees with the "${channel}" channel`,
);

const origin = repositorySlug(git('remote', 'get-url', 'origin'));
check(
  origin !== undefined && repositorySlug(manifest.repository?.url) === origin,
  'the repository URL matches the git remote, as provenance requires',
);

const changelog = read('CHANGELOG.md');
const heading = new RegExp(
  `^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`,
  'm',
);
check(heading.test(changelog), `CHANGELOG.md has a dated "## [${version}] - YYYY-MM-DD" section`);

for (const file of ['README.md', 'package-lock.json']) {
  check(existsSync(new URL(`../${file}`, import.meta.url)), `${file} exists`);
}
check(git('status', '--porcelain') === '', 'the working tree is clean');

const tagIndex = process.argv.indexOf('--tag');
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1];
  check(tag === `v${version}`, `the tag "${String(tag)}" is "v${version}"`);
}

if (problems.length > 0) {
  console.error(
    `\nrelease:verify: ${String(problems.length)} problem(s); nothing may be released yet.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `\nrelease:verify: ${manifest.name}@${version} may be released to the "${channel}" channel.`,
  );
  if (process.env['GITHUB_OUTPUT'] !== undefined) {
    appendFileSync(process.env['GITHUB_OUTPUT'], `channel=${channel}\nversion=${version}\n`);
  }
}
