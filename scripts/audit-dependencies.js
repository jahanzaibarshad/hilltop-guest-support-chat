import { spawnSync } from 'node:child_process';

// One reviewed, unpatched advisory in Jest configuration tooling only.
// Never permit it in the production dependency tree; reject every other advisory.
const exception = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';
function audit(options = []) {
  if (!process.env.npm_execpath) throw new Error('Run this check with npm run security:check.');
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, 'audit', '--json', ...options],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
    },
  );
  if (result.error || ![0, 1].includes(result.status))
    throw new Error('Dependency audit could not complete.');
  const report = JSON.parse(result.stdout);
  if (report.error || !report.metadata || !report.vulnerabilities)
    throw new Error('Invalid dependency audit response.');
  return report;
}
try {
  const production = audit(['--omit=dev']);
  if (Object.keys(production.vulnerabilities).length)
    throw new Error('Production dependency advisory detected.');
  console.log('PASS: production dependencies have zero reported advisories.');
  const complete = audit();
  const advisories = Object.values(complete.vulnerabilities).flatMap((value) =>
    value.via.filter((via) => typeof via === 'object'),
  );
  const unexpected = advisories.filter(
    (advisory) =>
      !(advisory.url === exception && advisory.name === 'deepmerge' && advisory.severity === 'low'),
  );
  const unresolved = Object.values(complete.vulnerabilities).some((value) =>
    value.via.some((via) => typeof via === 'string' && !complete.vulnerabilities[via]),
  );
  if (
    unexpected.length ||
    unresolved ||
    (Object.keys(complete.vulnerabilities).length && !advisories.length)
  )
    throw new Error('Unreviewed development dependency advisory detected.');
  console.log(
    advisories.length
      ? 'PASS with documented exception: unpatched low-severity GHSA-gcqx-w48m-w2h4 in Jest tooling only; see docs/SECURITY.md.'
      : 'PASS: development dependencies have zero reported advisories.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
