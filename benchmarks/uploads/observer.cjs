// Runs in a separate helper container sharing only the target PID namespace.
// Its own RSS is excluded. No code is injected into the application.
const fs = require('node:fs');
const interval = Number(process.argv[1] || 100);
const service = process.argv[2];
let disk = null;
function sampleDisk() {
  const started = Date.now();
  const pending = ['/proc/1/root/tmp'];
  let logical = 0, allocated = 0, count = 0, complete = true;
  while (pending.length && count < 10000) {
    const path = pending.pop();
    try {
      const stat = fs.lstatSync(path);
      count++;
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(path)) pending.push(path + '/' + name);
      } else if (stat.isFile()) {
        logical += stat.size;
        allocated += stat.blocks * 512;
      }
    } catch (e) {
      if (e.code !== 'ENOENT') complete = false;
    }
  }
  disk = {timestamp_ms: started, read_ms: Date.now() - started,
    logical_bytes: logical, allocated_bytes: allocated, complete: complete && !pending.length};
}
function sample() {
  const started = Date.now();
  const processes = [];
  let complete = true;
  for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    if (Number(pid) === process.pid) continue;
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
      const name = status.match(/^Name:\s+(.+)/m)?.[1];
      if (match) processes.push({pid: Number(pid), name, rss_bytes: Number(match[1]) * 1024});
    } catch (e) {
      // A short-lived ffprobe may exit while /proc is being read.
      if (e.code !== 'ENOENT' && e.code !== 'ESRCH') complete = false;
    }
  }
  const row = {service, timestamp_ms: started, read_ms: Date.now() - started,
    complete, rss_bytes: processes.reduce((n, p) => n + p.rss_bytes, 0), processes};
  row.tmp_disk = disk;
  // Best effort supplementary cgroup v1/v2 data from the target mount namespace.
  try {
    const root = '/proc/1/root/sys/fs/cgroup/';
    if (fs.existsSync(root + 'memory.current')) {
      row.cgroup_version = 2;
      row.cgroup_bytes = Number(fs.readFileSync(root + 'memory.current', 'utf8').trim());
      row.memory_stat = fs.readFileSync(root + 'memory.stat', 'utf8');
      row.cpu_stat = fs.readFileSync(root + 'cpu.stat', 'utf8');
      row.io_stat = fs.readFileSync(root + 'io.stat', 'utf8');
      row.memory_events = fs.readFileSync(root + 'memory.events', 'utf8');
    } else {
      row.cgroup_version = 1;
      const memberships = fs.readFileSync('/proc/1/cgroup', 'utf8').trim().split('\n').map(x => x.split(':'));
      const memberPath = (controller) => memberships.find(x => x[1].split(',').includes(controller))?.[2];
      const read = (controller, name) => {
        const group = memberPath(controller);
        if (group === undefined) throw new Error('Missing cgroup controller: ' + controller);
        // Docker Desktop v1 exposes /docker/<target-id> under each controller mount.
        const full = root + controller + group + '/' + name;
        if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
        // A namespaced mount may already be rooted at the target cgroup.
        return fs.readFileSync(root + controller + '/' + name, 'utf8');
      };
      row.cgroup_bytes = Number(read('memory', 'memory.usage_in_bytes').trim());
      row.memory_stat = read('memory', 'memory.stat');
      row.cpu_stat = read('cpu', 'cpu.stat');
      row.cpu_usage_ns = Number(read('cpuacct', 'cpuacct.usage').trim());
      row.io_stat = read('blkio', 'blkio.throttle.io_service_bytes');
      row.memory_events = read('memory', 'memory.failcnt');
    }
  } catch (e) { row.cgroup_error = e.code; }
  console.log(JSON.stringify(row));
}
sample();
setInterval(sample, interval);
sampleDisk();
setInterval(sampleDisk, 1000);
