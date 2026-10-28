// Rewrites testTimings.json from a Vitest JSON report: `pnpm test:timings`.
import { readFileSync, writeFileSync } from 'node:fs';
import { timingsFromReport, type VitestJsonReport } from './testShards.ts';

const [reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error('usage: node tools/ci/updateTestTimings.ts <vitest-json-report>');

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as VitestJsonReport;
const timings = timingsFromReport(report, process.cwd());
const target = new URL('./testTimings.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(timings, null, 2)}\n`);
console.log(`${Object.keys(timings).length} file timings written to tools/ci/testTimings.json`);
