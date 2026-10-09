var bin = ARGS.bin ? findItem(ARGS.bin) : (requireProject(), app.project.rootItem);
if (bin.type !== ProjectItemType.BIN && bin.type !== ProjectItemType.ROOT) throw new Error('Not a bin: ' + ARGS.bin);
return itemTree(bin, ARGS.depth !== undefined ? ARGS.depth : 3, 500);
