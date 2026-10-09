var doc = findDoc(ARGS.document);
var path = ARGS.path;
var fmt = (ARGS.format || path.substr(path.lastIndexOf('.') + 1)).toLowerCase();
var f = new File(path);
if (f.parent && !f.parent.exists) f.parent.create();
var opts;
if (fmt === 'png') opts = new PNGSaveOptions();
else if (fmt === 'jpg' || fmt === 'jpeg') {
    opts = new JPEGSaveOptions();
    opts.quality = ARGS.quality !== undefined ? Math.round(ARGS.quality / 100 * 12) : 10;
    opts.embedColorProfile = true;
} else if (fmt === 'psd') {
    opts = new PhotoshopSaveOptions();
    opts.layers = true;
} else if (fmt === 'tif' || fmt === 'tiff') opts = new TiffSaveOptions();
else throw new Error('Unsupported format: ' + fmt + ' (png, jpg, psd, tif)');
var target = doc;
var dup = null;
if (fmt === 'jpg' || fmt === 'jpeg') {
    dup = doc.duplicate('mcp_export', true);
    if (dup.bitsPerChannel !== BitsPerChannelType.EIGHT) dup.bitsPerChannel = BitsPerChannelType.EIGHT;
    target = dup;
}
try {
    target.saveAs(f, opts, true, Extension.LOWERCASE);
} finally {
    if (dup) { dup.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = doc; }
}
return { exported: f.fsName, format: fmt };
