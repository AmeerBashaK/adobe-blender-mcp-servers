var doc = findDoc(ARGS.document);
if (ARGS.path) {
    var f = new File(ARGS.path);
    if (f.parent && !f.parent.exists) f.parent.create();
    var o = new PhotoshopSaveOptions();
    o.layers = true;
    doc.saveAs(f, o, false, Extension.LOWERCASE);
} else {
    try { doc.fullName; } catch (e) { throw new Error('Document has never been saved; pass "path" (e.g. D:/work/poster.psd).'); }
    doc.save();
}
return { saved: doc.fullName.fsName };
