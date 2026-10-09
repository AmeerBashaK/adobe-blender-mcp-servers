var o = { app: 'Photoshop ' + app.version, documents: [] };
for (var i = 0; i < app.documents.length; i++) o.documents.push(app.documents[i].name);
if (!app.documents.length) { o.active = null; return o; }
var d = findDoc(ARGS.document);
o.active = describeDoc(d, ARGS.layers !== false);
return o;
