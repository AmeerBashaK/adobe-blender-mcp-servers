var f = new File(ARGS.path);
if (!f.exists) throw new Error('File not found: ' + ARGS.path);
var io = new ImportOptions(f);
if (ARGS.sequence) io.sequence = true;
var item = app.project.importFile(io);
if (ARGS.name) item.name = ARGS.name;
var out = { id: item.id, name: item.name, typeName: item.typeName, width: item.width, height: item.height, duration: item.duration };
if (ARGS.add_to_comp !== undefined && ARGS.add_to_comp !== null) {
    out.layer = describeLayer(findComp(ARGS.add_to_comp).layers.add(item));
}
return out;