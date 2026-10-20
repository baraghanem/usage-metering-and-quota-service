const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
const destDir = path.join(__dirname, '..', 'dist', 'db', 'migrations');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log(`Copied SQL migrations to ${destDir}`);
}
