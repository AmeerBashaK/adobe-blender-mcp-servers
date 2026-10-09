var doc = findDoc(ARGS.document);
var n = doc.name;
if (ARGS.save) doc.close(SaveOptions.SAVECHANGES);
else doc.close(SaveOptions.DONOTSAVECHANGES);
return { closed: n, saved: !!ARGS.save };
