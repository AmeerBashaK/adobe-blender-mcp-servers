var o = { app: 'Illustrator ' + app.version, documents: [] };
for (var i = 0; i < app.documents.length; i++) o.documents.push(app.documents[i].name);
if (!app.documents.length) { o.active = null; return o; }
o.active = describeDoc(findDoc(ARGS.document), ARGS.items !== false);
return o;
