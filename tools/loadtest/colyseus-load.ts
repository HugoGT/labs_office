/**
 * Colyseus load test (#274): N clients join the office room and each walks a
 * small circle, one `move` every --interval ms (the client's real cadence is
 * MOVE_INTERVAL_MS while walking). The server exposes no event loop metric,
 * so the measure is what a person feels: the time from sending a `move`
 * until the room's state brings that same position back (patch rate, event
 * loop lag and network together).
 *
 * --local starts an isolated server (`server/src/main.ts`) with local auth
 * and N generated accounts, no database and no LiveKit, and samples its CPU.
 * It never touches the deployed office: local auth is refused next to
 * Firebase, and the deployed compose never sets it (AGENTS.md).
 *
 *   node tools/loadtest/colyseus-load.ts --local --clients 60 --duration 5m
 *   node tools/loadtest/colyseus-load.ts --endpoint ws://host:2600 --clients 60   # LOADTEST_PASSWORD
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { OFFICE_ROOM_NAME } from '../../src/game/officeProtocol.ts';
import { loadTestUsers, localAuthUsersEnv, orbitPoint, summarize, type LoadTestUser, type Summary } from './loadStats.ts';

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    port: { type: 'string', default: '2600' },
    endpoint: { type: 'string' },
    clients: { type: 'string', default: '60' },
    duration: { type: 'string', default: '5m' },
    interval: { type: 'string', default: '200' },
    'per-second': { type: 'string', default: '5' },
    'no-auth': { type: 'boolean', default: false },
  },
});

const CLIENTS = Number(args.clients);
const INTERVAL_MS = Number(args.interval);
const PER_SECOND = Number(args['per-second']);
const DURATION_MS = durationMs(args.duration!);
const REPORT_EVERY_MS = 10_000;
/** A `move` the room refused (not walkable) never echoes; past this it is counted lost. */
const ECHO_GIVE_UP_MS = 5_000;
const ORBIT_RADIUS = 12;
const ORBIT_STEPS = 8;

function durationMs(raw: string): number {
  const match = /^(\d+)(s|m)$/.exec(raw);
  if (!match) throw new Error(`--duration takes 90s or 5m, got ${raw}`);
  return Number(match[1]) * (match[2] === 'm' ? 60_000 : 1_000);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Isolated server ---------------------------------------------------------------------------

/** Only what the server needs: no Firebase, database, LiveKit or storage from the caller's env. */
async function startLocalServer(users: readonly LoadTestUser[], port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['server/src/main.ts'], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(port),
      LOCAL_AUTH_USERS: localAuthUsersEnv(users),
      LOCAL_AUTH_SECRET: randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // The server must not outlive the test, also on Ctrl+C or a `timeout`
  // that lands while it is still starting.
  process.on('exit', () => child.kill());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(130));
  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`server exited with ${code}`)));
    child.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('escuchando')) resolve();
    });
  });
  child.stdout!.resume();
  return child;
}

/** CPU of a Linux process since the last call, in % of one core, and its RSS in MB. */
function cpuSampler(pid: number): () => { cpu: number; rssMb: number } {
  const ticksPerSecond = 100; // CLK_TCK on Linux x86-64
  const read = () => {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
    return Number(fields[11]) + Number(fields[12]); // utime + stime
  };
  let lastTicks = read();
  let lastAt = performance.now();
  return () => {
    const ticks = read();
    const now = performance.now();
    const cpu = ((ticks - lastTicks) / ticksPerSecond / ((now - lastAt) / 1000)) * 100;
    lastTicks = ticks;
    lastAt = now;
    const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return { cpu: Math.round(cpu), rssMb: Math.round(Number(rss?.[1] ?? 0) / 1024) };
  };
}

// --- Clients -----------------------------------------------------------------------------------

async function signIn(http: string, user: LoadTestUser): Promise<string> {
  const response = await fetch(`${http}/auth/local/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(user),
  });
  if (!response.ok) throw new Error(`sign-in ${user.email}: ${response.status}`);
  return ((await response.json()) as { token: string }).token;
}

interface PlayerLike {
  x: number;
  y: number;
  positionRevision?: number;
}

const stats = { joined: 0, joinFailed: 0, left: 0, sent: 0, lost: 0 };
let windowEchoes: number[] = [];
const allEchoes: number[] = [];
const joinTimes: number[] = [];
const rooms: Room[] = [];
/** Set before the clients leave on purpose, so only real drops count. */
let ending = false;

async function runClient(endpoint: string, http: string, user: LoadTestUser | null, index: number, until: number): Promise<void> {
  const joinStart = performance.now();
  let room: Room;
  try {
    const token = user ? await signIn(http, user) : undefined;
    room = await new Client(endpoint).joinOrCreate(OFFICE_ROOM_NAME, { name: `Carga ${index + 1}`, status: 'g', token });
  } catch (error) {
    stats.joinFailed++;
    console.error(`client ${index + 1}: join failed`, error instanceof Error ? error.message : error);
    return;
  }
  joinTimes.push(Math.round(performance.now() - joinStart));
  stats.joined++;
  rooms.push(room);
  room.onLeave(() => {
    if (!ending) stats.left++;
  });

  const pending = new Map<string, number>();
  let own: PlayerLike | null = null;
  let center: { x: number; y: number } | null = null;
  const $ = getStateCallbacks(room) as unknown as (target: unknown) => {
    players: { onAdd(cb: (player: PlayerLike, sessionId: string) => void): void };
    onChange(cb: () => void): void;
  };
  $(room.state).players.onAdd((player, sessionId) => {
    if (sessionId !== room.sessionId) return;
    own = player;
    center ??= { x: Math.round(player.x), y: Math.round(player.y) };
    $(player).onChange(() => {
      const sentAt = pending.get(`${player.x},${player.y}`);
      if (sentAt === undefined) return;
      const latency = Math.round(performance.now() - sentAt);
      windowEchoes.push(latency);
      allEchoes.push(latency);
      pending.delete(`${player.x},${player.y}`);
    });
  });

  let step = 0;
  while (performance.now() < until && room.connection.isOpen) {
    await sleep(INTERVAL_MS);
    if (!own || !center) continue;
    const now = performance.now();
    for (const [key, sentAt] of pending) {
      if (now - sentAt > ECHO_GIVE_UP_MS) {
        pending.delete(key);
        stats.lost++;
      }
    }
    const point = orbitPoint(center, ORBIT_RADIUS, ++step, ORBIT_STEPS);
    pending.set(`${point.x},${point.y}`, now);
    room.send('move', { ...point, facing: 'down', positionRevision: (own as PlayerLike).positionRevision ?? 0 });
    stats.sent++;
  }
}

function formatSummary(label: string, summary: Summary): string {
  return `${label} n=${summary.count} p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms max=${summary.max}ms`;
}

// --- Main --------------------------------------------------------------------------------------

const password = process.env.LOADTEST_PASSWORD ?? randomBytes(12).toString('hex');
const users = args['no-auth'] ? null : loadTestUsers(CLIENTS, password);
let server: ChildProcess | null = null;
let endpoint = args.endpoint;
if (args.local) {
  if (!users) throw new Error('--local always uses local auth');
  server = await startLocalServer(users, Number(args.port));
  endpoint = `ws://127.0.0.1:${args.port}`;
}
if (!endpoint) throw new Error('pass --local or --endpoint ws(s)://host:port');
const http = endpoint.replace(/^ws/, 'http');
const sampleServer = server?.pid ? cpuSampler(server.pid) : null;

console.log(`${CLIENTS} clients, a move every ${INTERVAL_MS} ms, ${PER_SECOND} joins/s, ${args.duration} against ${endpoint}`);
const startedAt = performance.now();
const until = startedAt + DURATION_MS;
const cpuSamples: number[] = [];
const reporter = setInterval(() => {
  const server = sampleServer?.();
  if (server) cpuSamples.push(server.cpu);
  const elapsed = Math.round((performance.now() - startedAt) / 1000);
  const serverText = server ? ` | server cpu=${server.cpu}% rss=${server.rssMb}MB` : '';
  console.log(`[${elapsed}s] joined=${stats.joined} left=${stats.left} sent=${stats.sent} lost=${stats.lost} | ${formatSummary('echo', summarize(windowEchoes))}${serverText}`);
  windowEchoes = [];
}, REPORT_EVERY_MS);

const clients: Promise<void>[] = [];
for (let index = 0; index < CLIENTS; index++) {
  clients.push(runClient(endpoint, http, users?.[index] ?? null, index, until));
  await sleep(1000 / PER_SECOND);
}
await Promise.all(clients);
clearInterval(reporter);
ending = true;
await Promise.all(rooms.map((room) => room.leave().catch(() => undefined)));
server?.kill();

console.log('\nSummary');
console.log(`  joined ${stats.joined}/${CLIENTS}, join failures ${stats.joinFailed}, dropped before the end ${stats.left}`);
console.log(`  ${formatSummary('join', summarize(joinTimes))}`);
console.log(`  ${formatSummary('move echo', summarize(allEchoes))}`);
console.log(`  moves sent ${stats.sent}, never echoed ${stats.lost} (refused or lost)`);
if (cpuSamples.length > 0) {
  const cpu = summarize(cpuSamples);
  console.log(`  server cpu per 10s window (% of one core): p50 ${cpu.p50}%, max ${cpu.max}%`);
}
