var doc = findDoc(ARGS.document);
var max = ARGS.max_size || 1024;
var path = __MCP_WORKDIR + '/preview_' + new Date().getTime() + '.png';
var dup = doc.duplicate('mcp_preview', true);
try {
    app.activeDocument = dup;
    if (dup.mode !== DocumentMode.RGB) dup.changeMode(ChangeMode.RGB);
    if (dup.bitsPerChannel !== BitsPerChannelType.EIGHT) dup.bitsPerChannel = BitsPerChannelType.EIGHT;
    dup.flatten();
    var W = px(dup.width), H = px(dup.height);
    var s = Math.min(1, max / Math.max(W, H));
    if (s < 1) dup.resizeImage(UnitValue(Math.round(W * s), 'px'), UnitValue(Math.round(H * s), 'px'), null, ResampleMethod.BICUBIC);
    var o = new PNGSaveOptions();
    dup.saveAs(new File(path), o, true, Extension.LOWERCASE);
} finally {
    dup.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
}
return { __image: path, document: doc.name, width: px(doc.width), height: px(doc.height) };
