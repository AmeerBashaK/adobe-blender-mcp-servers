var doc = findDoc(ARGS.document);
if (ARGS.path) {
    var f = new File(ARGS.path);
    if (f.parent && !f.parent.exists) f.parent.create();
    var ext = ARGS.path.substr(ARGS.path.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'pdf') {
        var o = new PDFSaveOptions();
        o.preserveEditability = ARGS.editable !== false;
        doc.saveAs(f, o);
    } else if (ext === 'ai') {
        doc.saveAs(f, new IllustratorSaveOptions());
    } else throw new Error('save_document writes .ai or .pdf; use export_document for png/jpg/svg');
} else {
    try { doc.fullName.fsName; } catch (e) { throw new Error('Document has never been saved; pass "path" (e.g. D:/work/logo.ai).'); }
    doc.save();
}
return { saved: doc.fullName.fsName };
