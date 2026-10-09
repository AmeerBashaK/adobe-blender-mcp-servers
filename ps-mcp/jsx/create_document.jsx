var bg = ARGS.background || 'white';
var fill;
if (bg === 'transparent') fill = DocumentFill.TRANSPARENT;
else if (bg === 'white') fill = DocumentFill.WHITE;
else {
    app.backgroundColor = toColor(bg === 'black' ? '#000000' : bg);
    fill = DocumentFill.BACKGROUNDCOLOR;
}
var d = app.documents.add(ARGS.width || 1080, ARGS.height || 1080, ARGS.resolution || 72, ARGS.name || 'Untitled', NewDocumentMode.RGB, fill);
return describeDoc(d, true);
