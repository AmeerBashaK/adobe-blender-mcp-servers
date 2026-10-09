var f = new File(ARGS.path);
if (!f.exists) throw new Error('File not found: ' + ARGS.path);
var d = app.open(f);
return describeDoc(d, true);
