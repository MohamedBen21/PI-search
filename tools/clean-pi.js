const fs = require('fs');
const [,, input, output = 'data/pi.txt'] = process.argv;
if (!input) { console.error('usage: node tools/clean-pi.js <input.txt> [data/pi.txt]'); process.exit(1); }

const out = fs.createWriteStream(output);
let first = true, total = 0;
fs.createReadStream(input, { highWaterMark: 16 * 1024 * 1024 })
  .on('data', (chunk) => {
    let n = 0;
    const buf = Buffer.allocUnsafe(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (c >= 48 && c <= 57) {
        if (first) { first = false; continue; }     
        buf[n++] = c;
      }
    }
    total += n;
    out.write(buf.subarray(0, n));
  })
  .on('end', () => out.end(() => {
    console.log(`Done: ${total.toLocaleString('en-US')} digits written to ${output}`);
    const fd = fs.openSync(output, 'r'); const b = Buffer.alloc(30); fs.readSync(fd, b, 0, 30, 0);
    console.log('Starts with:', b.toString('latin1'), '(should be 141592653589793...)');
  }))
  .on('error', (e) => { console.error(e.message); process.exit(1); });
