const fs=require("fs");
for (const f of process.argv.slice(2)) {
  const n=fs.readFileSync(f,"utf8");
  console.log("==",f, n.length);
  for (const l of n.split("\n")) {
    if (/^(렌|현)\s*:/.test(l)) console.log("  PC-LINE:", l.slice(0,400));
  }
}
